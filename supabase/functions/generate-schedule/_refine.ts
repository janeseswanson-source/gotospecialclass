// Phase 1 — background refinement orchestrator.
//
// The inline request path must stay under the edge ~2s CPU ceiling, so it returns
// a fast, valid schedule. This module is the HEAVY refinement that runs OUT of
// the request path (a background job / separate invocation): it takes a persisted
// schedule and pushes its soft quality further with SA + LNS, then returns an
// improved schedule ONLY if it is strictly better AND provably legal.
//
// SAFETY (non-negotiable): the candidate is re-validated against the actual SSOT
// (_shared/constraints.ts::violations) over the full block set. The refinement is
// ACCEPTED only when it has zero SSOT violations, no new error-severity warnings,
// and a quality % no lower than the input. Otherwise the original is returned
// untouched. This makes refinement trustworthy even if the reconstructed
// occupancy is imperfect — a bad rebuild is simply discarded.
//
// Determinism: seed derived from the generation id; same inputs + seed ⇒ same
// result. SA/LNS budgets are deterministic iteration/round counts.

import {
  computeWarnings,
  strategyFailed,
  timeToMinutes,
  type Block,
  type Specialist,
  type StrategyResult,
  schoolRotationsStartMin,
} from "./index.ts";
import { scoreSchedule, type ScoreableInput, type ScoreBreakdown } from "./_scoring.ts";
import { OccupancyTracker } from "./_occupancy.ts";
import { runSimulatedAnnealing } from "./_annealing.ts";
import { runLNS, recreate, directedRepair, type RepairContext } from "./_lns.ts";
import { computeQualityConfidence, type QualityConfidence } from "./_confidence.ts";
import { buildPerturbationBaseline, countMovedBlocks, perturbationAdjust, DEFAULT_PERTURBATION_WEIGHT } from "./_perturbation.ts";
import { mulberry32, deriveSeed, type Rng } from "./_random.ts";
import { qualityPercent } from "../_shared/scoring-rubric.ts";
import { reorderGradeRuns } from "./_adjacency.ts";
import { buildConstraintContext, violations, type ConstraintBlock } from "../_shared/constraints.ts";

export interface RefineTeacher {
  id: string;
  grade?: string | null;
  am_pm_preference?: string | null;
  day_preference?: string | null;
  weekly_planning_minutes?: number | null;
}

export interface RefineContext {
  specialists: Specialist[];
  teachers: RefineTeacher[];
  grades: string[];
  school: any;
  recessConfigs: any[];
}

export interface RefineOptions {
  /** Deterministic SA iteration budget for the background pass. */
  saMaxIterations?: number;
  /** Deterministic LNS round budget for the background pass. */
  lnsRounds?: number;
  /** Seed source (usually the generation id). */
  seedKey?: string;
  weightOverrides?: Partial<Record<keyof ScoreBreakdown, number>>;
  /** Phase 2 (minimal-perturbation replan): a committed baseline schedule. When
   *  present, SA/LNS prefer keeping blocks in their baseline slots, so the
   *  re-solve changes as little as possible. This is an INTERNAL objective —
   *  never part of the public quality-% rubric. */
  perturbationBaseline?: Block[];
  /** Penalty per moved block (optimizer-score units) when a baseline is set. */
  perturbationWeight?: number;
}

export interface RefineResult {
  improved: boolean;
  /** The improved blocks if accepted, else the original blocks unchanged. */
  blocks: Block[];
  /** Optimizer total of the returned schedule (higher = better). */
  score: number;
  scoreBreakdown: Record<string, number>;
  qualityPercent: number;
  previousQualityPercent: number;
  /** SSOT hard-violation count of the returned blocks (always 0 when accepted). */
  hardViolations: number;
  confidence: QualityConfidence;
  saIterations: number;
  saImprovement: number;
  lnsRounds: number;
  lnsAccepted: number;
  lnsImprovement: number;
  /** Teaching blocks in the result that differ from the perturbation baseline
   *  (0 when no baseline was supplied). Lower = more stable re-solve. */
  movedFromBaseline: number;
}

const NON_TEACHING_GRADES = new Set(["Lunch", "Planning", "Makeup"]);

/** A block is a grade-range lock (PLC/Admin) when it owns a grade's time with no
 *  specialist — exactly what the generator pre-seeds into its OccupancyTracker. */
function isGradeLock(b: Block): boolean {
  return (b.specialist_id == null || b.specialist_id === "") && !!b.grade;
}

/** Count hard placement violations of the teaching blocks via the SSOT validator.
 *  Synthetic ids are assigned so the validator's self-skip works on
 *  not-yet-persisted blocks (mirrors how it runs on persisted rows). */
function countHardViolations(blocks: Block[], school: any, recessConfigs: any[]): number {
  const all: ConstraintBlock[] = blocks.map((b, i) => ({ ...(b as unknown as ConstraintBlock), id: (b as any).id ?? `r${i}` }));
  const ctx = buildConstraintContext(school, recessConfigs, all);
  let count = 0;
  for (const b of all) {
    const isTeaching = !!b.specialist_id && !!b.grade && !NON_TEACHING_GRADES.has(b.grade) && b.subject !== "Specialist Lunch";
    if (!isTeaching) continue;
    count += violations(b, all, ctx).length;
  }
  return count;
}

/** Reconstruct the pre-seed occupancy (admin/PLC grade-range locks + PLC teacher
 *  slots) from persisted blocks, so SA/LNS route teaching blocks around them.
 *  Specialist/teacher bookings of the non-mutable blocks are re-added by
 *  buildOccupancyFromBlocks during SA/LNS (those rows carry a specialist_id). */
function buildBaseOccupancy(blocks: Block[], teachers: RefineTeacher[]): OccupancyTracker {
  const occ = new OccupancyTracker();
  for (const b of blocks) {
    if (!isGradeLock(b)) continue;
    const s = timeToMinutes(b.start_time);
    const e = timeToMinutes(b.end_time);
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    occ.bookGradeRange(b.day_of_week, b.grade, s, e);
    for (const t of teachers) {
      if (t.grade === b.grade) occ.book(b.day_of_week, s, e, `__plc_${t.id}`, t.id);
    }
  }
  return occ;
}

function buildScoringInput(ctx: RefineContext): ScoreableInput {
  return {
    school: {
      start_time: ctx.school.start_time,
      end_time: ctx.school.end_time,
      early_release_day: ctx.school.early_release_day,
      early_release_end_time: ctx.school.early_release_end_time,
      keep_grades_together: ctx.school.keep_grades_together ?? true,
      rotation_wheel_grades: ctx.school.rotation_wheel_grades ?? null,
      contractual_minutes_extracted: ctx.school.contractual_minutes_extracted ?? null,
    },
    specialists: ctx.specialists.map((s) => ({ id: s.id, subject: s.subject, working_days: s.working_days, teacher_accompanies: (s as { teacher_accompanies?: boolean | null }).teacher_accompanies ?? false })),
    teachers: ctx.teachers.map((t) => ({ id: t.id, am_pm_preference: t.am_pm_preference ?? null, day_preference: t.day_preference ?? null, weekly_planning_minutes: t.weekly_planning_minutes ?? null })),
    grades: ctx.grades,
  };
}

/**
 * Push a persisted schedule's soft quality further with SA + LNS, returning the
 * improved schedule only if it is strictly better AND legal. Pure + deterministic.
 */
export function refineSchedule(blocks: Block[], ctx: RefineContext, opts?: RefineOptions): RefineResult {
  const { specialists, grades, school, recessConfigs, teachers } = ctx;
  const saMaxIterations = opts?.saMaxIterations ?? 1500;
  const lnsRounds = opts?.lnsRounds ?? 150;
  const seed = deriveSeed(0x9e3779b9, opts?.seedKey ?? "refine");
  const weightOverrides = opts?.weightOverrides;

  const scoringInput = buildScoringInput(ctx);
  const baseOccupancy = buildBaseOccupancy(blocks, teachers);
  const preferenceViolations = [] as StrategyResult["preferenceViolations"];

  // Phase 2: minimal-perturbation objective (only when a baseline is supplied).
  const perturbBaseline = opts?.perturbationBaseline
    ? buildPerturbationBaseline(opts.perturbationBaseline)
    : null;
  const objectiveAdjust = perturbBaseline
    ? perturbationAdjust(perturbBaseline, opts?.perturbationWeight ?? DEFAULT_PERTURBATION_WEIGHT)
    : undefined;
  const adjustOf = (bs: Block[]) => (objectiveAdjust ? objectiveAdjust(bs) : 0);

  const original: StrategyResult = { blocks: blocks.slice(), preferenceViolations };
  const originalScored = scoreSchedule(
    { blocks: original.blocks, warnings: computeWarnings(original.blocks, specialists, grades), preferenceViolations },
    scoringInput,
    weightOverrides,
  );
  const previousQualityPercent = qualityPercent(originalScored.breakdown as unknown as Record<string, number>);

  // Pipeline: directed repair (greedy descent on assignment penalties) →
  // SA (timing polish) → LNS (escape local optima) → directed repair again
  // (clean up anything the stochastic passes disturbed). The directed repair is
  // the workhorse for class_repeats / clustering; SA+LNS handle timing/balance.
  const repairCtx: RepairContext = { scoringInput, specialists, grades, school, recessConfigs, baseOccupancy, weightOverrides };
  const scoreTotal = (bs: Block[]): number =>
    scoreSchedule({ blocks: bs, warnings: computeWarnings(bs, specialists, grades), preferenceViolations }, scoringInput, weightOverrides).total;

  const repaired0 = directedRepair(original.blocks, repairCtx, mulberry32(deriveSeed(seed, "rep0")));
  const sa = runSimulatedAnnealing(
    { blocks: repaired0, preferenceViolations }, scoreTotal(repaired0), scoringInput, specialists, grades, school, recessConfigs,
    baseOccupancy, mulberry32(deriveSeed(seed, "sa")), weightOverrides, { maxIterations: saMaxIterations, objectiveAdjust },
  );
  const afterSA: StrategyResult = { blocks: sa.blocks, preferenceViolations: sa.preferenceViolations };
  const lns = runLNS(
    afterSA, sa.score, scoringInput, specialists, grades, school, recessConfigs,
    baseOccupancy, mulberry32(deriveSeed(seed, "lns")), weightOverrides, { rounds: lnsRounds, objectiveAdjust },
  );
  // Non-teaching reservations (lunch/planning/meeting/PLUS/admin) constrain
  // the adjacency pass but never move.
  const nonTeaching = blocks.filter((b) => !isTeachingBlock(b));
  // Grade-adjacency as the LAST transform, inside the accept gate: refine can
  // never persist a scrambled layout, and re-refines re-apply adjacency.
  const candidateBlocks = reorderGradeRuns(
    directedRepair(lns.blocks, repairCtx, mulberry32(deriveSeed(seed, "rep1"))) as never,
    { school, recessConfigs, teachers, fixedContext: nonTeaching as never },
  ).blocks as unknown as Block[];
  const candWarnings = computeWarnings(candidateBlocks, specialists, grades);
  const candScored = scoreSchedule(
    { blocks: candidateBlocks, warnings: candWarnings, preferenceViolations },
    scoringInput,
    weightOverrides,
  );
  const candQuality = qualityPercent(candScored.breakdown as unknown as Record<string, number>);
  const candViolations = countHardViolations(candidateBlocks, school, recessConfigs);

  // ACCEPT only if legal, no new errors, quality did not drop, AND the combined
  // objective (quality − perturbation penalty) strictly improved. Without a
  // baseline the adjust is 0, so this reduces to "pure quality strictly improved"
  // (legacy gate). With a baseline, a minimal-perturbation candidate of equal
  // quality but fewer moved blocks is accepted. The SSOT re-validation is the
  // trust anchor — a bad rebuild is discarded here.
  const candCombined = candScored.total + adjustOf(candidateBlocks);
  const originalCombined = originalScored.total + adjustOf(original.blocks);
  const accept =
    candViolations === 0 &&
    !strategyFailed(candWarnings) &&
    candQuality >= previousQualityPercent &&
    candCombined > originalCombined;

  const finalBlocks = accept ? candidateBlocks : original.blocks;
  const finalScored = accept ? candScored : originalScored;
  const finalQuality = accept ? candQuality : previousQualityPercent;
  const finalViolations = accept ? candViolations : countHardViolations(original.blocks, school, recessConfigs);
  const movedFromBaseline = perturbBaseline ? countMovedBlocks(finalBlocks, perturbBaseline) : 0;

  const confidence = computeQualityConfidence({
    breakdown: finalScored.breakdown as unknown as Record<string, number>,
    specialists,
    gradeCount: grades.length,
    school,
    refinement: { rounds: lns.rounds, lastImprovementRound: lns.lastImprovementRound },
  });

  return {
    improved: accept,
    blocks: finalBlocks,
    score: finalScored.total,
    scoreBreakdown: finalScored.breakdown as unknown as Record<string, number>,
    qualityPercent: finalQuality,
    previousQualityPercent,
    hardViolations: finalViolations,
    confidence,
    saIterations: sa.iterations,
    saImprovement: sa.improvement,
    lnsRounds: lns.rounds,
    lnsAccepted: lns.accepted,
    lnsImprovement: lns.improvement,
    movedFromBaseline,
  };
}

// ─── Phase 2: minimal-perturbation replan ────────────────────────────────────

export interface ReplanResult {
  ok: boolean;
  /** Reason when ok=false (caller should fall back to a full regenerate). */
  reason?: string;
  blocks: Block[];
  /** Teaching blocks that differ from the committed baseline (the moved set). */
  movedFromBaseline: number;
  qualityPercent: number;
  scoreBreakdown: Record<string, number>;
  hardViolations: number;
}

function isTeachingBlock(b: Block): boolean {
  return !!b.specialist_id && !!b.teacher_id && !NON_TEACHING_GRADES.has(b.grade) && b.subject !== "Specialist Lunch";
}

/**
 * Minimal-perturbation replan. Given a committed baseline and the set of blocks
 * an input change invalidated (`isDisturbed`), keep every other block EXACTLY in
 * place and re-place only the disturbed sessions on legal slots under the NEW
 * constraints (`ctx`). The result changes as little as possible — only the
 * disturbed sessions (+ any ripple the recreate needed) move.
 *
 * Returns ok=false (so the caller can fall back to a full regenerate) if the
 * disturbed sessions cannot all be legally re-placed, or if the result is not
 * SSOT-legal. Deterministic given `opts.seedKey`.
 */
export function replanMinimal(
  baselineBlocks: Block[],
  isDisturbed: (b: Block) => boolean,
  ctx: RefineContext,
  opts?: { seedKey?: string; weightOverrides?: Partial<Record<keyof ScoreBreakdown, number>> },
): ReplanResult {
  const { specialists, grades, school, recessConfigs, teachers } = ctx;
  const seed = deriveSeed(0x9e3779b9, opts?.seedKey ?? "replan");
  const rng: Rng = mulberry32(seed);

  const survivors = baselineBlocks.filter((b) => !isDisturbed(b));
  const disturbed = baselineBlocks.filter((b) => isDisturbed(b) && isTeachingBlock(b));

  const empty = (reason: string): ReplanResult => ({
    ok: false, reason, blocks: baselineBlocks, movedFromBaseline: 0,
    qualityPercent: 0, scoreBreakdown: {}, hardViolations: 0,
  });
  if (disturbed.length === 0) return empty("no_disturbed_teaching_blocks");

  const baseOccupancy = buildBaseOccupancy(baselineBlocks, teachers);
  const classStartMin = schoolRotationsStartMin(school);
  const rebuilt = recreate(disturbed, survivors, specialists, baseOccupancy, school, recessConfigs, classStartMin, rng);
  if (!rebuilt) return empty("could_not_replace_disturbed_sessions");

  // SSOT + error gate. A bad re-placement is rejected so the caller falls back.
  const warnings = computeWarnings(rebuilt, specialists, grades);
  if (strategyFailed(warnings)) return empty("rebuild_has_errors");
  const hardViolations = countHardViolations(rebuilt, school, recessConfigs);
  if (hardViolations > 0) return empty("rebuild_has_ssot_violations");

  const scoringInput = buildScoringInput(ctx);
  const scored = scoreSchedule({ blocks: rebuilt, warnings, preferenceViolations: [] }, scoringInput, opts?.weightOverrides);
  const movedFromBaseline = countMovedBlocks(rebuilt, buildPerturbationBaseline(baselineBlocks));

  return {
    ok: true,
    blocks: rebuilt,
    movedFromBaseline,
    qualityPercent: qualityPercent(scored.breakdown as unknown as Record<string, number>),
    scoreBreakdown: scored.breakdown as unknown as Record<string, number>,
    hardViolations,
  };
}
