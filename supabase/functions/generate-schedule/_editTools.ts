// Engine-powered editing tool cores (edit-with-ai v2). PURE — no I/O, no LLM.
//
// These are the deterministic brains behind the chat editor's tools and the
// QualityPanel's one-click fixes:
//   enumerateFreeSlots — legal open slots via the SSOT (kills blind guessing)
//   previewOps         — SSOT violations + warnings delta + quality % delta for a
//                        proposed op batch, BEFORE anything is applied
//   conflictFixOptions — the deterministic conflict cascade in PREVIEW mode,
//                        returning ranked legal options as proposable ops
//   improveQualityScoped — a short deterministic directed-repair/rebalance pass,
//                        perturbation-anchored to the current blocks, returning
//                        the move set AS proposed ops with a measured delta
//   qualityReport      — score_breakdown in scoreSummary language + warnings
//
// Ops use the SAME shapes apply-schedule-edits accepts (move/swap/delete/insert),
// so a tool's proposal batch flows through the existing propose→confirm→apply
// gate unchanged. Every candidate is validated against the SSOT
// (_shared/constraints.ts) — the LLM never invents placements.

import {
  DAYS,
  timeToMinutes,
  minutesToTime,
  schoolCanonicalStep,
  getEndMinForDay,
  getRecessWindowsForDay,
  buildTimeSlotsForGrade,
  computeWarnings,
  canSpecialistTeachGradeOnDay,
  specClassDuration,
  type Block,
  type Specialist,
  type Teacher,
  type Warning,
} from "./index.ts";
import { scoreSchedule, type ScoreableInput, type ScoreBreakdown } from "./_scoring.ts";
import { OccupancyTracker } from "./_occupancy.ts";
import { directedRepair, declusterOnce, type RepairContext } from "./_lns.ts";
import { detectConflicts, resolveConflict, type Conflict, type ConflictContext } from "./_conflict.ts";
import { buildPerturbationBaseline, countMovedBlocks, DEFAULT_PERTURBATION_WEIGHT } from "./_perturbation.ts";
import { mulberry32, deriveSeed, type Rng } from "./_random.ts";
import { qualityPercent } from "../_shared/scoring-rubric.ts";
import {
  buildConstraintContext,
  violations as constraintViolations,
  describeViolation,
  type ConstraintBlock,
} from "../_shared/constraints.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

/** A persisted (or in-flight) schedule block row, as the chat editor sees it. */
export interface EditBlock {
  id: string;
  generation_id: string;
  day_of_week: string;
  start_time: string; // HH:MM:SS
  end_time: string;
  subject: string;
  specialist_id: string | null;
  teacher_id: string | null;
  grade: string | null;
  room: string | null;
  week_label: string | null;
}

/** Same op shapes apply-schedule-edits accepts — proposals flow through the
 *  existing propose→confirm→apply gate unchanged. */
export type EditOp =
  | { kind: "move"; label: string; block_id: string; day_of_week: string; start_time: string; end_time: string }
  | { kind: "swap"; label: string; a_id: string; a_day: string; a_start: string; a_end: string; b_id: string; b_day: string; b_start: string; b_end: string }
  | { kind: "delete"; label: string; block_id: string }
  | { kind: "insert"; label: string; day_of_week: string; start_time: string; end_time: string; subject: string; specialist_id: string | null; teacher_id: string | null; grade: string | null; room: string | null; week_label: string | null };

export interface EditToolContext {
  school: any;
  recessConfigs: any[];
  specialists: Specialist[];
  teachers: Array<Teacher | { id: string; name: string; grade: string; room?: string | null; am_pm_preference?: string | null; day_preference?: string | null; weekly_planning_minutes?: number | null }>;
  grades: string[];
}

const NON_TEACHING = new Set(["Lunch", "Planning", "Makeup"]);
const hhmmss = (t: string) => (t.length === 5 ? `${t}:00` : t);
const hm = (t: string) => t.slice(0, 5);

function toConstraint(b: EditBlock): ConstraintBlock {
  return {
    id: b.id, day_of_week: b.day_of_week, start_time: b.start_time, end_time: b.end_time,
    specialist_id: b.specialist_id, teacher_id: b.teacher_id, grade: b.grade, week_label: b.week_label, subject: b.subject,
  };
}

function scoringInputOf(ctx: EditToolContext): ScoreableInput {
  return {
    school: {
      start_time: ctx.school?.start_time, end_time: ctx.school?.end_time,
      early_release_day: ctx.school?.early_release_day, early_release_end_time: ctx.school?.early_release_end_time,
      keep_grades_together: ctx.school?.keep_grades_together ?? true,
      contractual_minutes_extracted: ctx.school?.contractual_minutes_extracted ?? null,
    },
    specialists: ctx.specialists.map((s) => ({ id: s.id, subject: s.subject, working_days: s.working_days })),
    teachers: ctx.teachers.map((t: any) => ({ id: t.id, am_pm_preference: t.am_pm_preference ?? null, day_preference: t.day_preference ?? null, weekly_planning_minutes: t.weekly_planning_minutes ?? null })),
    grades: ctx.grades,
  };
}

/** Warnings + weighted breakdown + public quality % for a block list. */
export function scoreBlocks(blocks: EditBlock[], ctx: EditToolContext): {
  warnings: Warning[]; breakdown: Record<string, number>; percent: number; total: number;
} {
  const asBlocks = blocks as unknown as Block[];
  const warnings = computeWarnings(asBlocks, ctx.specialists, ctx.grades, ctx.teachers as unknown as Teacher[]);
  const scored = scoreSchedule({ blocks: asBlocks, warnings, preferenceViolations: [] }, scoringInputOf(ctx));
  const breakdown = scored.breakdown as unknown as Record<string, number>;
  return { warnings, breakdown, percent: qualityPercent(breakdown), total: scored.total };
}

// ─── find_free_slots ─────────────────────────────────────────────────────────

export interface FreeSlotQuery {
  specialist_id?: string | null;
  teacher_id?: string | null;
  grade?: string | null;
  day?: string | null;
  /** Session length in minutes; defaults to the specialist's own class length,
   *  else the school default. */
  duration?: number | null;
}

export interface FreeSlot { day: string; start_time: string; end_time: string }

/** Legal open slots for a hypothetical session, validated via the SSOT with the
 *  FULL live block list — so "free" here means "apply would accept it". Capped. */
export function enumerateFreeSlots(query: FreeSlotQuery, blocks: EditBlock[], ctx: EditToolContext, cap = 30): FreeSlot[] {
  const spec = query.specialist_id ? ctx.specialists.find((s) => s.id === query.specialist_id) ?? null : null;
  const teacher = query.teacher_id ? (ctx.teachers as any[]).find((t) => t.id === query.teacher_id) ?? null : null;
  const grade = query.grade ?? teacher?.grade ?? null;
  const defaultDur = (ctx.school?.class_duration && ctx.school.class_duration > 0) ? ctx.school.class_duration : 45;
  const duration = (query.duration && query.duration > 0)
    ? query.duration
    : spec ? specClassDuration(spec, defaultDur) : defaultDur;

  const constraintCtx = buildConstraintContext(ctx.school, ctx.recessConfigs, blocks.map(toConstraint));
  const all = blocks.map(toConstraint);
  const startMin = timeToMinutes(ctx.school?.start_time ?? "08:00");
  const passing = ctx.school?.passing_time ?? 5;
  const setup = ctx.school?.setup_time ?? 15;
  const gtc = (ctx.school?.grade_time_config as Record<string, { passingTime?: number; resetTime?: number }>) ?? {};
  const step = schoolCanonicalStep(ctx.school ?? {});

  const days = query.day && DAYS.includes(query.day) ? [query.day] : DAYS;
  const out: FreeSlot[] = [];
  for (const day of days) {
    if (spec && !(spec.working_days ?? DAYS).includes(day)) continue;
    if (spec && grade && !canSpecialistTeachGradeOnDay(spec, grade, day)) continue;
    const endMin = getEndMinForDay(day, ctx.school ?? {});
    const recess = getRecessWindowsForDay(day, ctx.school ?? {}, ctx.recessConfigs, grade);
    for (const sl of buildTimeSlotsForGrade(grade ?? "?", duration, startMin, endMin, passing, setup, gtc, recess, step)) {
      const cand: ConstraintBlock = {
        id: "__free_probe", day_of_week: day,
        start_time: hhmmss(minutesToTime(sl.start)), end_time: hhmmss(minutesToTime(sl.start + duration)),
        specialist_id: spec?.id ?? null, teacher_id: teacher?.id ?? null, grade, week_label: null,
      };
      if (constraintViolations(cand, all, constraintCtx).length === 0) {
        out.push({ day, start_time: cand.start_time, end_time: cand.end_time });
        if (out.length >= cap) return out;
      }
    }
  }
  return out;
}

// ─── preview_ops ─────────────────────────────────────────────────────────────

export interface OpPreview {
  label: string;
  ok: boolean;
  violations: string[];
}

export interface PreviewResult {
  ops: OpPreview[];
  all_legal: boolean;
  quality_before: number;
  quality_after: number;
  quality_delta: number;
  warnings_before: number;
  warnings_after: number;
  new_errors: number;
  /** The candidate block list with all LEGAL ops applied (illegal ones skipped). */
  candidateBlocks: EditBlock[];
}

/** Apply an op batch to a COPY of the blocks, mirroring apply-schedule-edits'
 *  sequential validate-then-apply semantics. Pure. */
export function applyOpsToBlocks(
  blocks: EditBlock[], ops: EditOp[], ctx: EditToolContext,
): { candidate: EditBlock[]; results: OpPreview[] } {
  const constraintCtx = buildConstraintContext(ctx.school, ctx.recessConfigs, blocks.map(toConstraint));
  let effective = blocks.map((b) => ({ ...b }));
  const results: OpPreview[] = [];
  const describe = (codes: ReturnType<typeof constraintViolations>) => codes.map(describeViolation);

  for (const op of ops) {
    const label = (op as any).label ?? op.kind;
    if (op.kind === "delete") {
      const exists = effective.some((e) => e.id === op.block_id);
      if (!exists) { results.push({ label, ok: false, violations: ["block no longer exists"] }); continue; }
      effective = effective.filter((e) => e.id !== op.block_id);
      results.push({ label, ok: true, violations: [] });
    } else if (op.kind === "move") {
      const cur = effective.find((e) => e.id === op.block_id);
      if (!cur) { results.push({ label, ok: false, violations: ["block no longer exists"] }); continue; }
      const cand: ConstraintBlock = { ...toConstraint(cur), day_of_week: op.day_of_week, start_time: hhmmss(op.start_time), end_time: hhmmss(op.end_time) };
      const vios = constraintViolations(cand, effective.map(toConstraint), constraintCtx);
      if (vios.length) { results.push({ label, ok: false, violations: describe(vios) }); continue; }
      cur.day_of_week = op.day_of_week; cur.start_time = hhmmss(op.start_time); cur.end_time = hhmmss(op.end_time);
      results.push({ label, ok: true, violations: [] });
    } else if (op.kind === "swap") {
      const a = effective.find((e) => e.id === op.a_id);
      const b = effective.find((e) => e.id === op.b_id);
      if (!a || !b) { results.push({ label, ok: false, violations: ["a block no longer exists"] }); continue; }
      const others = effective.filter((e) => e.id !== a.id && e.id !== b.id).map(toConstraint);
      const candA: ConstraintBlock = { ...toConstraint(a), day_of_week: op.a_day, start_time: hhmmss(op.a_start), end_time: hhmmss(op.a_end) };
      const candB: ConstraintBlock = { ...toConstraint(b), day_of_week: op.b_day, start_time: hhmmss(op.b_start), end_time: hhmmss(op.b_end) };
      const vios = [...constraintViolations(candA, [...others, candB], constraintCtx), ...constraintViolations(candB, [...others, candA], constraintCtx)];
      if (vios.length) { results.push({ label, ok: false, violations: describe(vios) }); continue; }
      a.day_of_week = op.a_day; a.start_time = hhmmss(op.a_start); a.end_time = hhmmss(op.a_end);
      b.day_of_week = op.b_day; b.start_time = hhmmss(op.b_start); b.end_time = hhmmss(op.b_end);
      results.push({ label, ok: true, violations: [] });
    } else if (op.kind === "insert") {
      const cand: ConstraintBlock = {
        day_of_week: op.day_of_week, start_time: hhmmss(op.start_time), end_time: hhmmss(op.end_time),
        specialist_id: op.specialist_id, teacher_id: op.teacher_id, grade: op.grade, week_label: op.week_label,
      };
      const vios = constraintViolations(cand, effective.map(toConstraint), constraintCtx);
      if (vios.length) { results.push({ label, ok: false, violations: describe(vios) }); continue; }
      effective.push({
        id: `tmp_ins_${effective.length}`, generation_id: blocks[0]?.generation_id ?? "",
        day_of_week: op.day_of_week, start_time: hhmmss(op.start_time), end_time: hhmmss(op.end_time),
        subject: op.subject, specialist_id: op.specialist_id, teacher_id: op.teacher_id,
        grade: op.grade, room: op.room, week_label: op.week_label,
      });
      results.push({ label, ok: true, violations: [] });
    }
  }
  return { candidate: effective, results };
}

/** SSOT violations + warnings delta + quality % delta for a proposed op set —
 *  what the chat model MUST check (and report) before finishing a proposal. */
export function previewOps(ops: EditOp[], blocks: EditBlock[], ctx: EditToolContext): PreviewResult {
  const before = scoreBlocks(blocks, ctx);
  const { candidate, results } = applyOpsToBlocks(blocks, ops, ctx);
  const after = scoreBlocks(candidate, ctx);
  const errCount = (w: Warning[]) => w.filter((x) => x.severity === "error").length;
  return {
    ops: results,
    all_legal: results.every((r) => r.ok),
    quality_before: before.percent,
    quality_after: after.percent,
    quality_delta: after.percent - before.percent,
    warnings_before: before.warnings.length,
    warnings_after: after.warnings.length,
    new_errors: Math.max(0, errCount(after.warnings) - errCount(before.warnings)),
    candidateBlocks: candidate,
  };
}

// ─── fix_conflicts (preview only) ────────────────────────────────────────────

export interface ConflictFixProposal {
  tactic: string;
  blast_radius: number;
  description: string;
  ops: EditOp[];
}

export interface ConflictFixResult {
  conflicts_found: number;
  target_block_id: string | null;
  options: ConflictFixProposal[];
  escalation: { reason: string; conflicting_constraints: string[] } | null;
}

/** The deterministic cascade in PREVIEW mode: ranked legal options with measured
 *  blast radius, expressed as proposable ops. NEVER applies anything. */
export function conflictFixOptions(blockId: string | undefined, blocks: EditBlock[], ctx: EditToolContext): ConflictFixResult {
  const conflictCtx: ConflictContext = {
    specialists: ctx.specialists,
    teachers: (ctx.teachers as any[]).map((t) => ({ id: t.id, grade: t.grade })),
    grades: ctx.grades, school: ctx.school, recessConfigs: ctx.recessConfigs,
  };
  const asBlocks = blocks as unknown as Block[];
  const found = detectConflicts(asBlocks, conflictCtx);
  let conflict: Conflict | null = null;
  if (blockId) {
    // _conflict assigns positional ids b{i}; map the real id to its position.
    const idx = blocks.findIndex((b) => b.id === blockId);
    if (idx >= 0) conflict = { kind: "double_book", blockId: `b${idx}` };
  } else {
    conflict = found[0] ?? null;
  }
  if (!conflict) return { conflicts_found: found.length, target_block_id: null, options: [], escalation: null };

  const posToReal = (pid?: string): string | null => {
    if (!pid) return null;
    const i = Number(pid.replace(/^b/, ""));
    return Number.isFinite(i) ? blocks[i]?.id ?? null : null;
  };
  const targetRealId = posToReal(conflict.blockId);
  const outcome = resolveConflict(conflict, asBlocks, conflictCtx);
  const byId = new Map(blocks.map((b) => [b.id, b]));

  const options: ConflictFixProposal[] = outcome.options.slice(0, 6).map((o) => ({
    tactic: o.tactic,
    blast_radius: o.blastRadius,
    description: o.description,
    ops: o.changes
      .filter((c) => c.op === "move" && c.blockId)
      .map((c) => {
        const realId = posToReal(c.blockId) ?? c.blockId!;
        const blk = byId.get(realId);
        const short = blk ? `${blk.subject}${blk.grade ? ` · Gr ${blk.grade}` : ""}` : "block";
        return {
          kind: "move" as const,
          label: `Move ${short}: ${c.from?.day_of_week ?? "?"} ${hm(c.from?.start_time ?? "")} → ${c.to.day_of_week} ${hm(c.to.start_time)}`,
          block_id: realId,
          day_of_week: c.to.day_of_week,
          start_time: hhmmss(c.to.start_time),
          end_time: hhmmss(c.to.end_time),
        };
      }),
  })).filter((o) => o.ops.length > 0);

  return {
    conflicts_found: found.length,
    target_block_id: targetRealId,
    options,
    escalation: outcome.escalation
      ? { reason: outcome.escalation.reason, conflicting_constraints: outcome.escalation.conflictingConstraints }
      : null,
  };
}

// ─── improve_quality / rebalance_specialist ──────────────────────────────────

export interface ImproveResult {
  ops: EditOp[];
  quality_before: number;
  quality_after: number;
  quality_delta: number;
  moved_blocks: number;
  focus: string;
  note: string | null;
}

/** Grade-lock occupancy pre-seed (PLC/Admin rows), mirroring _refine. */
function buildBaseOccupancy(blocks: EditBlock[], teachers: EditToolContext["teachers"]): OccupancyTracker {
  const occ = new OccupancyTracker();
  for (const b of blocks) {
    if ((b.specialist_id ?? "") !== "" || !b.grade) continue;
    const s = timeToMinutes(b.start_time), e = timeToMinutes(b.end_time);
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    occ.bookGradeRange(b.day_of_week, b.grade, s, e);
    for (const t of teachers as any[]) if (t.grade === b.grade) occ.book(b.day_of_week, s, e, `__plc_${t.id}`, t.id);
  }
  return occ;
}

/** Big-Group combined members (same specialist+grade+identical slot, different
 *  teachers, same week) — never moved by any pass here. */
function combinedMemberIds(blocks: EditBlock[]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) {
    if (!b.specialist_id || !b.teacher_id) continue;
    for (const o of blocks) {
      if (o.id === b.id) continue;
      if (o.specialist_id === b.specialist_id && o.grade === b.grade && o.day_of_week === b.day_of_week &&
          o.start_time === b.start_time && o.end_time === b.end_time && o.teacher_id !== b.teacher_id &&
          (o.week_label ?? null) === (b.week_label ?? null)) { out.add(b.id); break; }
    }
  }
  return out;
}

/** One greedy day-load balancing pass for a specialist: move a block from their
 *  heaviest day to a legal slot on their lightest day, accepting only strict
 *  combined-objective improvements (score − perturbation penalty). */
function rebalanceOnce(
  specId: string, current: EditBlock[], ctx: EditToolContext,
  combined: Set<string>, accept: (cand: EditBlock[]) => boolean, rng: Rng,
): boolean {
  const spec = ctx.specialists.find((s) => s.id === specId);
  if (!spec) return false;
  const workDays = (spec.working_days ?? DAYS).filter((d) => DAYS.includes(d));
  const counts = new Map<string, number>(workDays.map((d) => [d, 0]));
  const mine = current.filter((b) =>
    b.specialist_id === specId && b.teacher_id && !NON_TEACHING.has(b.grade ?? "") && !combined.has(b.id));
  for (const b of mine) counts.set(b.day_of_week, (counts.get(b.day_of_week) ?? 0) + 1);
  if (counts.size < 2) return false;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [heavyDay, heavyN] = sorted[0];
  const lightDays = sorted.filter(([, n]) => n < heavyN - 1).map(([d]) => d);
  if (lightDays.length === 0) return false; // already balanced within ±1

  const constraintCtx = buildConstraintContext(ctx.school, ctx.recessConfigs, current.map(toConstraint));
  const startMin = timeToMinutes(ctx.school?.start_time ?? "08:00");
  const passing = ctx.school?.passing_time ?? 5;
  const setup = ctx.school?.setup_time ?? 15;
  const gtc = (ctx.school?.grade_time_config as Record<string, { passingTime?: number; resetTime?: number }>) ?? {};
  const step = schoolCanonicalStep(ctx.school ?? {});

  const movable = mine.filter((b) => b.day_of_week === heavyDay)
    .map((b, i) => ({ b, k: (rng() * 1e9) >>> 0, i }))
    .sort((a, z) => (a.k - z.k) || (a.i - z.i))
    .map((x) => x.b);

  for (const blk of movable) {
    const duration = timeToMinutes(blk.end_time) - timeToMinutes(blk.start_time);
    for (const day of lightDays) {
      if (blk.grade && !canSpecialistTeachGradeOnDay(spec, blk.grade, day)) continue;
      const endMin = getEndMinForDay(day, ctx.school ?? {});
      const recess = getRecessWindowsForDay(day, ctx.school ?? {}, ctx.recessConfigs, blk.grade);
      for (const sl of buildTimeSlotsForGrade(blk.grade ?? "?", duration, startMin, endMin, passing, setup, gtc, recess, step)) {
        const cand: ConstraintBlock = {
          ...toConstraint(blk), day_of_week: day,
          start_time: hhmmss(minutesToTime(sl.start)), end_time: hhmmss(minutesToTime(sl.start + duration)),
        };
        if (constraintViolations(cand, current.map(toConstraint), constraintCtx).length > 0) continue;
        const next = current.map((x) => x.id === blk.id
          ? { ...x, day_of_week: day, start_time: cand.start_time, end_time: cand.end_time }
          : x);
        if (accept(next)) return true;
      }
    }
  }
  return false;
}

/** Diff two block lists (by id) into apply-ready ops with before→after labels.
 *  Identity changes (specialist reassignment) become delete+insert pairs, since
 *  apply-schedule-edits' op vocabulary has no "reassign". */
export function diffToOps(before: EditBlock[], after: EditBlock[], ctx: EditToolContext): EditOp[] {
  const specName = (id: string | null) => (id ? ctx.specialists.find((s) => s.id === id)?.name ?? "?" : "—");
  const teachName = (id: string | null) => (id ? (ctx.teachers as any[]).find((t) => t.id === id)?.name ?? "?" : null);
  const short = (b: EditBlock) => {
    const t = teachName(b.teacher_id);
    return `${b.subject}${b.grade ? ` · Gr ${b.grade}` : ""}${t ? ` (${t})` : ""}`;
  };
  const beforeById = new Map(before.map((b) => [b.id, b]));
  const ops: EditOp[] = [];
  for (const a of after) {
    const b = beforeById.get(a.id);
    if (!b) continue; // engine passes never invent new ids except via reassign (handled below)
    const timeChanged = b.day_of_week !== a.day_of_week || b.start_time !== a.start_time || b.end_time !== a.end_time;
    const identityChanged = b.specialist_id !== a.specialist_id || b.subject !== a.subject;
    if (identityChanged) {
      ops.push({ kind: "delete", label: `Remove ${short(b)}: ${b.day_of_week} ${hm(b.start_time)}`, block_id: b.id });
      ops.push({
        kind: "insert",
        label: `Add ${short(a)} with ${specName(a.specialist_id)}: ${a.day_of_week} ${hm(a.start_time)}–${hm(a.end_time)}`,
        day_of_week: a.day_of_week, start_time: a.start_time, end_time: a.end_time, subject: a.subject,
        specialist_id: a.specialist_id, teacher_id: a.teacher_id, grade: a.grade, room: a.room, week_label: a.week_label,
      });
    } else if (timeChanged) {
      ops.push({
        kind: "move",
        label: `Move ${short(a)}: ${b.day_of_week} ${hm(b.start_time)} → ${a.day_of_week} ${hm(a.start_time)}`,
        block_id: a.id, day_of_week: a.day_of_week, start_time: a.start_time, end_time: a.end_time,
      });
    }
  }
  return ops;
}

/**
 * Short deterministic improvement pass, scoped by request and perturbation-
 * anchored to the CURRENT blocks (so it moves as little as possible):
 *  - focus "spec_dayload_stdev" or a specialist_id → day-load rebalancing
 *  - focus "class_repeats"/"subject_day_clustering"/none → directed repair
 * Accepts only strict combined-objective improvements. Returns the move set as
 * proposed ops + the measured quality delta. Never applies anything.
 */
export function improveQualityScoped(
  opts: { focus?: string | null; specialist_id?: string | null; seedKey?: string; maxRounds?: number },
  blocks: EditBlock[], ctx: EditToolContext,
): ImproveResult {
  const seed = deriveSeed(0x51ab27e1, opts.seedKey ?? "improve");
  const rng = mulberry32(seed);
  const focus = opts.focus ?? (opts.specialist_id ? "spec_dayload_stdev" : "auto");
  const maxRounds = Math.max(1, Math.min(opts.maxRounds ?? 12, 40));

  const baseline = buildPerturbationBaseline(blocks as unknown as Block[]);
  const before = scoreBlocks(blocks, ctx);
  const combinedOf = (bs: EditBlock[]) =>
    scoreBlocks(bs, ctx).total - DEFAULT_PERTURBATION_WEIGHT * countMovedBlocks(bs as unknown as Block[], baseline);

  let current = blocks.map((b) => ({ ...b }));
  let curCombined = combinedOf(current);
  const accept = (cand: EditBlock[]): boolean => {
    const s = scoreBlocks(cand, ctx);
    if (s.warnings.some((w) => w.severity === "error")) return false;
    const c = s.total - DEFAULT_PERTURBATION_WEIGHT * countMovedBlocks(cand as unknown as Block[], baseline);
    if (c > curCombined + 1e-9) { current = cand.map((x) => ({ ...x })); curCombined = c; return true; }
    return false;
  };

  const combined = combinedMemberIds(current);
  // Focus dispatch. A clustering-only focus runs ONLY the de-cluster operator —
  // full directedRepair also reassigns repeating classes (moves a whole class's
  // sessions), which a scoped "fix the clustering" request must not do.
  const wantsDecluster = focus === "subject_day_clustering";
  const wantsRepair = focus === "auto" || focus === "class_repeats";
  const wantsRebalance = focus === "auto" || focus === "spec_dayload_stdev" || !!opts.specialist_id;
  const baseOccupancy = buildBaseOccupancy(current, ctx.teachers);
  const classStartMin = timeToMinutes(ctx.school?.start_time ?? "08:00");

  if (wantsDecluster) {
    const rngD = mulberry32(deriveSeed(seed, "decluster"));
    for (let round = 0; round < maxRounds; round++) {
      const combinedSet = new Set(current.filter((b) => combined.has(b.id)) as unknown as Block[]);
      const moved = declusterOnce(
        current as unknown as Block[], combinedSet, baseOccupancy,
        ctx.school, ctx.recessConfigs, classStartMin, rngD,
        (cand) => accept(cand as unknown as EditBlock[]),
      );
      if (!moved) break;
    }
  }

  if (wantsRepair) {
    // Directed repair on a copy; adopt it only if the combined objective improved
    // (the perturbation anchor — repair alone optimizes pure score).
    const repairCtx: RepairContext = {
      scoringInput: scoringInputOf(ctx), specialists: ctx.specialists, grades: ctx.grades,
      school: ctx.school, recessConfigs: ctx.recessConfigs,
      baseOccupancy,
    };
    const repaired = directedRepair(current as unknown as Block[], repairCtx, mulberry32(deriveSeed(seed, "repair")), maxRounds) as unknown as EditBlock[];
    accept(repaired);
  }

  if (wantsRebalance) {
    // Day-load is a LOW-weight rubric term (−1 × avg stdev), so the flat
    // perturbation anchor would veto every rebalancing move. This path instead
    // gates on the metric itself: accept a move only if it strictly reduces the
    // day-load penalty, never lowers the quality %, and adds no errors — and the
    // round cap bounds total movement (the anchor's intent, expressed per-focus).
    let curDayload = Math.abs(scoreBlocks(current, ctx).breakdown["spec_dayload_stdev"] ?? 0);
    let curPercent = scoreBlocks(current, ctx).percent;
    const acceptRebalance = (cand: EditBlock[]): boolean => {
      const s = scoreBlocks(cand, ctx);
      if (s.warnings.some((w) => w.severity === "error")) return false;
      if (s.percent < curPercent) return false;
      const candDayload = Math.abs(s.breakdown["spec_dayload_stdev"] ?? 0);
      if (candDayload < curDayload - 1e-6) {
        current = cand.map((x) => ({ ...x }));
        curDayload = candDayload;
        curPercent = s.percent;
        curCombined = s.total - DEFAULT_PERTURBATION_WEIGHT * countMovedBlocks(cand as unknown as Block[], baseline);
        return true;
      }
      return false;
    };
    const targets = opts.specialist_id
      ? [opts.specialist_id]
      : ctx.specialists.map((s) => s.id);
    for (let round = 0; round < maxRounds; round++) {
      let moved = false;
      for (const sid of targets) {
        if (rebalanceOnce(sid, current, ctx, combined, acceptRebalance, rng)) moved = true;
      }
      if (!moved) break;
    }
  }

  const after = scoreBlocks(current, ctx);
  const ops = diffToOps(blocks, current, ctx);
  const movedBlocks = countMovedBlocks(current as unknown as Block[], baseline);
  return {
    ops,
    quality_before: before.percent,
    quality_after: after.percent,
    quality_delta: after.percent - before.percent,
    moved_blocks: movedBlocks,
    focus,
    note: ops.length === 0
      ? "No legal move improves this further — the schedule is at (or very near) its ceiling for this objective."
      : null,
  };
}

// ─── get_quality_report ──────────────────────────────────────────────────────

// Plain-language labels — mirrors src/lib/scoreSummary.ts (display only; the
// numbers still come from the shared rubric).
const PENALTY_LABELS: Array<{ key: string; weight: number; cost: (n: number) => string }> = [
  { key: "subject_gap", weight: 40, cost: (n) => `${n} grade–specialist pairing${n === 1 ? "" : "s"} never happen${n === 1 ? "s" : ""} this week` },
  { key: "subject_day_clustering", weight: 15, cost: (n) => `${n} subject${n === 1 ? "" : "s"} double up on the same day` },
  { key: "class_repeats", weight: 25, cost: (n) => `${n} class${n === 1 ? "" : "es"} see${n === 1 ? "s" : ""} the same specialist twice` },
  { key: "k_grade_after_780", weight: 20, cost: (n) => `${n} Kindergarten class${n === 1 ? "" : "es"} scheduled after 1:00pm` },
  { key: "cart_back_to_back", weight: 5, cost: (n) => `${n} cart move${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} back-to-back across rooms` },
  { key: "grade_cohesion", weight: 4, cost: (n) => `${n} grade-day${n === 1 ? "" : "s"} could be grouped better` },
  { key: "teacher_planning", weight: 0.05, cost: (n) => `about ${n} teacher planning minute${n === 1 ? "" : "s"} short` },
  { key: "contract_min", weight: 0.05, cost: (n) => `about ${n} contractual minute${n === 1 ? "" : "s"} short` },
  { key: "spec_dayload_stdev", weight: 1, cost: () => "Specialist day-loads are a little uneven" },
  { key: "warnings", weight: 50, cost: (n) => `${n} scheduling warning${n === 1 ? "" : "s"}` },
  { key: "errors", weight: 1000, cost: (n) => `${n} hard error${n === 1 ? "" : "s"} (double-booking or coverage)` },
];

export interface QualityIssue { key: string; label: string; magnitude: number }

export interface QualityReportResult {
  percent: number;
  breakdown: Record<string, number>;
  issues: QualityIssue[];
  warnings: Array<{ type: string; severity: string; message: string }>;
}

/** score_breakdown in scoreSummary language + current warnings — what the model
 *  reads to know WHAT is wrong before acting. */
export function qualityReport(blocks: EditBlock[], ctx: EditToolContext): QualityReportResult {
  const { warnings, breakdown, percent } = scoreBlocks(blocks, ctx);
  const issues: QualityIssue[] = [];
  for (const p of PENALTY_LABELS) {
    const v = breakdown[p.key];
    const mag = typeof v === "number" && Number.isFinite(v) ? Math.abs(v) : 0;
    if (mag <= (p.key === "spec_dayload_stdev" ? 0.5 : 0)) continue;
    const n = Math.max(1, Math.round(mag / p.weight));
    issues.push({ key: p.key, label: p.cost(n), magnitude: mag });
  }
  issues.sort((a, b) => b.magnitude - a.magnitude);
  return {
    percent, breakdown, issues,
    warnings: warnings.map((w) => ({ type: w.type, severity: w.severity, message: w.message })),
  };
}
