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
} from "./index.ts";
import { scoreSchedule, type ScoreableInput, type ScoreBreakdown } from "./_scoring.ts";
import { OccupancyTracker } from "./_occupancy.ts";
import { runSimulatedAnnealing } from "./_annealing.ts";
import { runLNS } from "./_lns.ts";
import { computeQualityConfidence, type QualityConfidence } from "./_confidence.ts";
import { mulberry32, deriveSeed } from "./_random.ts";
import { qualityPercent } from "../_shared/scoring-rubric.ts";
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
      contractual_minutes_extracted: ctx.school.contractual_minutes_extracted ?? null,
    },
    specialists: ctx.specialists.map((s) => ({ id: s.id, subject: s.subject, working_days: s.working_days })),
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

  const original: StrategyResult = { blocks: blocks.slice(), preferenceViolations };
  const originalScored = scoreSchedule(
    { blocks: original.blocks, warnings: computeWarnings(original.blocks, specialists, grades), preferenceViolations },
    scoringInput,
    weightOverrides,
  );
  const previousQualityPercent = qualityPercent(originalScored.breakdown as unknown as Record<string, number>);

  // SA first (local polish), then LNS (escape local optima). Both deterministic.
  const sa = runSimulatedAnnealing(
    original, originalScored.total, scoringInput, specialists, grades, school, recessConfigs,
    baseOccupancy, mulberry32(deriveSeed(seed, "sa")), weightOverrides, { maxIterations: saMaxIterations },
  );
  const afterSA: StrategyResult = { blocks: sa.blocks, preferenceViolations: sa.preferenceViolations };
  const lns = runLNS(
    afterSA, sa.score, scoringInput, specialists, grades, school, recessConfigs,
    baseOccupancy, mulberry32(deriveSeed(seed, "lns")), weightOverrides, { rounds: lnsRounds },
  );

  const candidateBlocks = lns.blocks;
  const candWarnings = computeWarnings(candidateBlocks, specialists, grades);
  const candScored = scoreSchedule(
    { blocks: candidateBlocks, warnings: candWarnings, preferenceViolations },
    scoringInput,
    weightOverrides,
  );
  const candQuality = qualityPercent(candScored.breakdown as unknown as Record<string, number>);
  const candViolations = countHardViolations(candidateBlocks, school, recessConfigs);

  // ACCEPT only if legal, no new errors, and quality did not drop. The SSOT
  // re-validation is the trust anchor — a bad rebuild is discarded here.
  const accept =
    candViolations === 0 &&
    !strategyFailed(candWarnings) &&
    candQuality >= previousQualityPercent &&
    candScored.total > originalScored.total;

  const finalBlocks = accept ? candidateBlocks : original.blocks;
  const finalScored = accept ? candScored : originalScored;
  const finalQuality = accept ? candQuality : previousQualityPercent;
  const finalViolations = accept ? candViolations : countHardViolations(original.blocks, school, recessConfigs);

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
  };
}
