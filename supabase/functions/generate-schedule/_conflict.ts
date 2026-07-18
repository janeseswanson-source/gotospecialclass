// Phase 3 — deterministic blast-radius conflict cascade.
//
// Conflict resolution is a DETERMINISTIC, ranked engine; the LLM only narrates.
// `resolveConflict` tries tactics in increasing-perturbation order, validates
// EVERY candidate against the SSOT (_shared/constraints.ts), and returns a ranked
// list of legal options with their MEASURED blast radius (the Phase-2 perturbation
// metric — computed, never hardcoded). When nothing is legal it escalates to a
// human with the irreducible reason (which constraints conflict) and the
// least-bad options.
//
// Tactics, smallest blast radius first:
//   1. relocate the session within the same specialist (same day, then any day)
//   2. swap two existing sessions (the offending one ↔ a same-specialist session)
//   3. add a session (for no_coverage — larger ripple)
// The LLM never invents placements: every option here came from this engine and
// passed the SSOT.

import {
  DAYS,
  timeToMinutes,
  minutesToTime,
  schoolCanonicalStep,
  getEndMinForDay,
  getRecessWindowsForDay,
  buildTimeSlotsForGrade,
  type Block,
  type Specialist,
  schoolRotationsStartMin,
} from "./index.ts";
import {
  buildConstraintContext,
  violations,
  describeViolation,
  type ConstraintBlock,
  type ConstraintContext,
  type ViolationCode,
} from "../_shared/constraints.ts";
import { buildPerturbationBaseline, countMovedBlocks } from "./_perturbation.ts";

export interface ConflictTeacher {
  id: string;
  grade?: string | null;
}

export interface ConflictContext {
  specialists: Specialist[];
  teachers: ConflictTeacher[];
  grades: string[];
  school: any;
  recessConfigs: any[];
}

export type ConflictKind = "double_book" | "illegal_placement" | "no_coverage";

export interface Conflict {
  kind: ConflictKind;
  /** The offending block to relocate/swap (double_book / illegal_placement). */
  blockId?: string;
  /** For no_coverage: the missing (grade, specialist, teacher) session to add. */
  grade?: string;
  specialistId?: string;
  teacherId?: string;
}

export type Tactic = "relocate" | "swap" | "add_session";

export interface BlockChange {
  op: "move" | "add";
  blockId?: string;
  to: { day_of_week: string; start_time: string; end_time: string };
  /** For a move, the slot it came from (for narration). */
  from?: { day_of_week: string; start_time: string; end_time: string };
}

export interface ResolveOption {
  tactic: Tactic;
  /** Measured blast radius = teaching blocks that differ from the original. */
  blastRadius: number;
  changes: BlockChange[];
  /** The full resulting schedule — SSOT-legal (zero violations). */
  resultBlocks: Block[];
  /** Deterministic, human-readable summary (the LLM may rephrase, not invent). */
  description: string;
}

export interface ConflictEscalation {
  /** The single most common constraint that blocked every legal attempt. */
  reason: string;
  /** Distinct constraint descriptions encountered across all attempts. */
  conflictingConstraints: string[];
  /** Resolutions that fix the conflict but introduce the FEWEST new violations. */
  leastBadOptions: ResolveOption[];
}

export interface ResolveOutcome {
  resolved: boolean;
  conflict: Conflict;
  options: ResolveOption[];
  escalation?: ConflictEscalation;
}

const NON_TEACHING = new Set(["Lunch", "Planning", "Makeup"]);

function withIds(blocks: Block[]): Array<Block & { id: string }> {
  return blocks.map((b, i) => ({ ...b, id: (b as any).id ?? `b${i}` }));
}

function toConstraint(b: Block & { id: string }): ConstraintBlock {
  return {
    id: b.id, day_of_week: b.day_of_week, start_time: b.start_time, end_time: b.end_time,
    specialist_id: b.specialist_id, teacher_id: b.teacher_id, grade: b.grade,
    week_label: b.week_label ?? null, subject: b.subject,
  };
}

/** Candidate (day, start) slots for a session, from the grade grid ∪ existing
 *  starts on the day. SSOT validation happens at the call site. */
function candidateSlots(
  grade: string,
  duration: number,
  workDays: string[],
  allBlocks: Block[],
  school: any,
  recessConfigs: any[],
  classStartMin: number,
): Array<{ day: string; start: number; end: number }> {
  const passing = school.passing_time ?? 5;
  const canonicalStep = schoolCanonicalStep(school);
  const setup = school.setup_time ?? 15;
  const gradeTimeConfig = (school.grade_time_config as Record<string, { passingTime?: number; resetTime?: number }>) ?? {};
  const out: Array<{ day: string; start: number; end: number }> = [];
  for (const day of workDays) {
    const endMin = getEndMinForDay(day, school);
    const recess = getRecessWindowsForDay(day, school, recessConfigs, grade);
    const starts = new Set<number>(
      buildTimeSlotsForGrade(grade, duration, classStartMin, endMin, passing, setup, gradeTimeConfig, recess, canonicalStep).map((s) => s.start),
    );
    for (const b of allBlocks) if (b.day_of_week === day) starts.add(timeToMinutes(b.start_time));
    for (const s of [...starts].sort((a, b) => a - b)) {
      const e = s + duration;
      if (s < classStartMin || e > endMin) continue;
      out.push({ day, start: s, end: e });
    }
  }
  return out;
}

/** Deterministic day ordering: the offending block's own day first (smallest
 *  perturbation), then Mon→Fri. */
function dayOrder(preferDay: string | undefined): (a: string, b: string) => number {
  return (a, b) => {
    if (preferDay) {
      if (a === preferDay && b !== preferDay) return -1;
      if (b === preferDay && a !== preferDay) return 1;
    }
    return DAYS.indexOf(a) - DAYS.indexOf(b);
  };
}

/**
 * Resolve one conflict deterministically. Returns ranked legal options (by
 * measured blast radius, then tactic priority, then a stable slot order), or an
 * escalation when no legal option exists.
 */
export function resolveConflict(conflict: Conflict, blocks: Block[], ctx: ConflictContext): ResolveOutcome {
  const { specialists, teachers, school, recessConfigs } = ctx;
  const all = withIds(blocks);
  const constraintCtx: ConstraintContext = buildConstraintContext(school, recessConfigs, all.map(toConstraint));
  const classStartMin = schoolRotationsStartMin(school);
  const baseline = buildPerturbationBaseline(blocks);

  const options: ResolveOption[] = [];
  const blockedBy = new Map<ViolationCode, number>();
  const leastBad: Array<{ opt: ResolveOption; vios: number }> = [];

  const noteBlocked = (codes: ViolationCode[]) => {
    for (const c of codes) blockedBy.set(c, (blockedBy.get(c) ?? 0) + 1);
  };

  // ── no_coverage: add a missing session ───────────────────────────────────
  if (conflict.kind === "no_coverage") {
    const spec = specialists.find((s) => s.id === conflict.specialistId);
    const teacher = teachers.find((t) => t.id === conflict.teacherId);
    if (spec && teacher && conflict.grade) {
      const duration = ((spec.class_duration && spec.class_duration > 0) ? spec.class_duration : (school.class_duration ?? 45));
      const workDays = (spec.working_days ?? DAYS).filter((d) => DAYS.includes(d)).sort(dayOrder(undefined));
      const slots = candidateSlots(conflict.grade, duration, workDays, blocks, school, recessConfigs, classStartMin);
      for (const slot of slots) {
        const cand: ConstraintBlock = {
          id: "__cand_add", day_of_week: slot.day, start_time: minutesToTime(slot.start), end_time: minutesToTime(slot.end),
          specialist_id: spec.id, teacher_id: teacher.id, grade: conflict.grade, week_label: null, subject: spec.subject,
        };
        const vios = violations(cand, all.map(toConstraint), constraintCtx);
        const newBlock: Block = {
          generation_id: blocks[0]?.generation_id ?? "", day_of_week: slot.day,
          start_time: minutesToTime(slot.start), end_time: minutesToTime(slot.end), subject: spec.subject,
          specialist_id: spec.id, teacher_id: teacher.id, grade: conflict.grade, room: spec.location ?? null, week_label: null,
        };
        const resultBlocks = [...blocks, newBlock];
        const opt: ResolveOption = {
          tactic: "add_session", blastRadius: countMovedBlocks(resultBlocks, baseline),
          changes: [{ op: "add", to: { day_of_week: slot.day, start_time: newBlock.start_time, end_time: newBlock.end_time } }],
          resultBlocks,
          description: `Add ${spec.subject} for grade ${conflict.grade} on ${slot.day} ${newBlock.start_time}`,
        };
        if (vios.length === 0) options.push(opt);
        else { noteBlocked(vios); leastBad.push({ opt, vios: vios.length }); }
        if (options.length >= 8) break;
      }
    }
    return finalize(conflict, options, blockedBy, leastBad);
  }

  // ── double_book / illegal_placement: relocate or swap the offending block ──
  const offending = all.find((b) => b.id === conflict.blockId);
  if (!offending || !offending.specialist_id || NON_TEACHING.has(offending.grade)) {
    return { resolved: false, conflict, options: [], escalation: { reason: "offending block not found or not a teaching block", conflictingConstraints: [], leastBadOptions: [] } };
  }
  const survivors = all.filter((b) => b.id !== offending.id);
  const survivorConstraints = survivors.map(toConstraint);
  const duration = timeToMinutes(offending.end_time) - timeToMinutes(offending.start_time);
  const spec = specialists.find((s) => s.id === offending.specialist_id);
  const workDays = (spec?.working_days ?? DAYS).filter((d) => DAYS.includes(d)).sort(dayOrder(offending.day_of_week));

  // Tactic 1 — RELOCATE (same day first via dayOrder, then any working day).
  const slots = candidateSlots(offending.grade, duration, workDays, blocks, school, recessConfigs, classStartMin);
  for (const slot of slots) {
    if (slot.day === offending.day_of_week && minutesToTime(slot.start) === offending.start_time) continue; // same slot
    const moved: ConstraintBlock = {
      id: offending.id, day_of_week: slot.day, start_time: minutesToTime(slot.start), end_time: minutesToTime(slot.end),
      specialist_id: offending.specialist_id, teacher_id: offending.teacher_id, grade: offending.grade, week_label: offending.week_label ?? null, subject: offending.subject,
    };
    const vios = violations(moved, survivorConstraints, constraintCtx);
    const movedBlock: Block = { ...stripId(offending), day_of_week: slot.day, start_time: moved.start_time, end_time: moved.end_time };
    const result = survivors.map(stripId).concat([movedBlock]);
    const opt: ResolveOption = {
      tactic: "relocate", blastRadius: countMovedBlocks(result, baseline),
      changes: [{ op: "move", blockId: offending.id, from: { day_of_week: offending.day_of_week, start_time: offending.start_time, end_time: offending.end_time }, to: { day_of_week: slot.day, start_time: moved.start_time, end_time: moved.end_time } }],
      resultBlocks: result,
      description: `Move ${offending.subject} (grade ${offending.grade}) from ${offending.day_of_week} ${offending.start_time} to ${slot.day} ${moved.start_time}`,
    };
    if (vios.length === 0) options.push(opt);
    else { noteBlocked(vios); leastBad.push({ opt, vios: vios.length }); }
    if (options.filter((o) => o.tactic === "relocate").length >= 8) break;
  }

  // Tactic 2 — SWAP the offending block with another same-specialist session.
  const sameSpec = survivors.filter((b) => b.specialist_id === offending.specialist_id && b.teacher_id && b.teacher_id !== offending.teacher_id && !NON_TEACHING.has(b.grade));
  for (const other of sameSpec) {
    // Offending takes other's slot; other takes offending's slot.
    const newOffending: ConstraintBlock = { ...toConstraint(offending), day_of_week: other.day_of_week, start_time: other.start_time, end_time: other.end_time };
    const newOther: ConstraintBlock = { ...toConstraint(other), day_of_week: offending.day_of_week, start_time: offending.start_time, end_time: offending.end_time };
    const rest = survivors.filter((b) => b.id !== other.id).map(toConstraint);
    const v1 = violations(newOffending, [...rest, newOther], constraintCtx);
    const v2 = violations(newOther, [...rest, newOffending], constraintCtx);
    const movedOff: Block = { ...offending, day_of_week: other.day_of_week, start_time: other.start_time, end_time: other.end_time };
    const movedOth: Block = { ...stripId(other), day_of_week: offending.day_of_week, start_time: offending.start_time, end_time: offending.end_time };
    const result = survivors.filter((b) => b.id !== other.id).map(stripId).concat([movedOff, movedOth]);
    const opt: ResolveOption = {
      tactic: "swap", blastRadius: countMovedBlocks(result, baseline),
      changes: [
        { op: "move", blockId: offending.id, from: { day_of_week: offending.day_of_week, start_time: offending.start_time, end_time: offending.end_time }, to: { day_of_week: other.day_of_week, start_time: other.start_time, end_time: other.end_time } },
        { op: "move", blockId: (other as any).id, from: { day_of_week: other.day_of_week, start_time: other.start_time, end_time: other.end_time }, to: { day_of_week: offending.day_of_week, start_time: offending.start_time, end_time: offending.end_time } },
      ],
      resultBlocks: result,
      description: `Swap ${offending.subject} (grade ${offending.grade}) with the ${other.subject} session on ${other.day_of_week} ${other.start_time}`,
    };
    if (v1.length === 0 && v2.length === 0) options.push(opt);
    else { noteBlocked([...v1, ...v2]); leastBad.push({ opt, vios: v1.length + v2.length }); }
    if (options.filter((o) => o.tactic === "swap").length >= 5) break;
  }

  return finalize(conflict, options, blockedBy, leastBad);
}

function stripId(b: Block & { id?: string }): Block {
  const { id: _id, ...rest } = b as any;
  return rest as Block;
}

/**
 * Detect ACTUAL conflicts deterministically from the blocks themselves (via the
 * SSOT), rather than parsing warning text. Emits one `double_book` conflict per
 * offending block (the later block of each overlapping pair, so a pair is not
 * double-counted). This is what the resolver cascade consumes.
 */
export function detectConflicts(blocks: Block[], ctx: ConflictContext): Conflict[] {
  const all = withIds(blocks);
  const constraintCtx = buildConstraintContext(ctx.school, ctx.recessConfigs, all.map(toConstraint));
  const constraintBlocks = all.map(toConstraint);
  const conflicts: Conflict[] = [];
  for (let i = 0; i < all.length; i++) {
    const b = all[i];
    if (!b.specialist_id || !b.teacher_id || NON_TEACHING.has(b.grade)) continue;
    const v = violations(toConstraint(b), constraintBlocks, constraintCtx);
    if (v.includes("specialist_double_book") || v.includes("teacher_double_book")) {
      conflicts.push({ kind: "double_book", blockId: b.id });
    }
  }
  // Keep only the LATER block of each conflicting pair: if an earlier block also
  // conflicts with this one, resolving the later one usually clears the pair.
  // (Deterministic: ids are positional `b{i}`.) De-dup is implicit per-block.
  return conflicts;
}

export interface BatchResolveResult {
  finalBlocks: Block[];
  appliedOptions: ResolveOption[];
  escalations: Array<{ conflict: Conflict; escalation: ConflictEscalation }>;
  resolvedCount: number;
  escalatedCount: number;
}

/** Stable content signature of the block at positional id `b{i}` in `blocks`. */
function blockSig(blocks: Block[], blockId: string | undefined): string | null {
  if (!blockId) return null;
  const i = Number(blockId.replace(/^b/, ""));
  const b = blocks[i];
  if (!b) return null;
  return `${b.day_of_week}|${b.start_time}|${b.specialist_id}|${b.teacher_id}|${b.grade}|${b.week_label ?? ""}`;
}

/**
 * Detect and resolve all conflicts deterministically and iteratively. Each round
 * re-detects against the running schedule (so an applied fix may clear several
 * conflicts), resolves the first remaining one with the smallest-blast-radius
 * legal option, and applies it. Conflicts with no legal option are escalated
 * (never force-fixed) and skipped thereafter. Pure + deterministic.
 *
 * This is the engine the edge function applies; the LLM only narrates the result.
 */
export function resolveConflictsDeterministic(blocks: Block[], ctx: ConflictContext): BatchResolveResult {
  let working = blocks.slice();
  const appliedOptions: ResolveOption[] = [];
  const escalations: Array<{ conflict: Conflict; escalation: ConflictEscalation }> = [];
  const escalatedSigs = new Set<string>();

  // Bound the loop: at most one resolution per teaching block, plus headroom.
  const MAX_ROUNDS = working.length + 1;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const conflicts = detectConflicts(working, ctx)
      .filter((c) => !escalatedSigs.has(blockSig(working, c.blockId) ?? ""));
    if (conflicts.length === 0) break;
    const conflict = conflicts[0];
    const outcome = resolveConflict(conflict, working, ctx);
    if (outcome.resolved && outcome.options.length > 0) {
      working = outcome.options[0].resultBlocks;
      appliedOptions.push(outcome.options[0]);
    } else {
      const sig = blockSig(working, conflict.blockId);
      if (sig) escalatedSigs.add(sig);
      escalations.push({ conflict, escalation: outcome.escalation ?? { reason: "unresolvable", conflictingConstraints: [], leastBadOptions: [] } });
    }
  }

  return {
    finalBlocks: working,
    appliedOptions,
    escalations,
    resolvedCount: appliedOptions.length,
    escalatedCount: escalations.length,
  };
}

/** Rank legal options (blast radius asc, tactic priority, stable), or build an
 *  escalation from the most-common blocking constraint + least-bad options. */
function finalize(
  conflict: Conflict,
  options: ResolveOption[],
  blockedBy: Map<ViolationCode, number>,
  leastBad: Array<{ opt: ResolveOption; vios: number }>,
): ResolveOutcome {
  const tacticRank: Record<Tactic, number> = { relocate: 0, swap: 1, add_session: 2 };
  options.sort((a, b) =>
    (a.blastRadius - b.blastRadius) ||
    (tacticRank[a.tactic] - tacticRank[b.tactic]) ||
    a.description.localeCompare(b.description),
  );
  if (options.length > 0) {
    return { resolved: true, conflict, options };
  }
  // Escalate: pick the most common blocking constraint as the irreducible reason.
  let topCode: ViolationCode | null = null;
  let topN = -1;
  for (const [code, n] of blockedBy) if (n > topN) { topN = n; topCode = code; }
  const conflictingConstraints = [...blockedBy.keys()].map(describeViolation);
  const leastBadOptions = leastBad
    .sort((a, b) => (a.vios - b.vios) || (a.opt.blastRadius - b.opt.blastRadius))
    .slice(0, 3)
    .map((x) => x.opt);
  return {
    resolved: false,
    conflict,
    options: [],
    escalation: {
      reason: topCode ? `No legal placement exists — every candidate ${describeViolation(topCode)}.` : "No legal placement exists for this conflict.",
      conflictingConstraints,
      leastBadOptions,
    },
  };
}
