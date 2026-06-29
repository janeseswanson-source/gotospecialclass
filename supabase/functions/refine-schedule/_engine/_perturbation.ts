// Phase 2 — minimal-perturbation objective (stability).
//
// When an input changes mid-year (a specialist drops a day, a room closes), the
// re-solve should change the committed schedule as LITTLE as possible — admins
// have already built their week around it. This module is an INTERNAL
// optimization objective that penalizes each teaching block that differs from a
// committed baseline. The SA/LNS accept step folds it in so re-solves prefer
// minimal movement.
//
// IMPORTANT: this term is NOT part of the public quality-% rubric
// (_shared/scoring-rubric.ts / src/lib/scoringConstants.ts) and never touches the
// displayed quality number. It only biases the search's accept decisions. If
// stability is ever surfaced to users, it is a SEPARATE, clearly-labeled metric.

import { type Block } from "./index.ts";

const NON_TEACHING_GRADES = new Set(["Lunch", "Planning", "Makeup"]);

function isTeaching(b: Block): boolean {
  return !!b.specialist_id && !!b.teacher_id && !NON_TEACHING_GRADES.has(b.grade) && b.subject !== "Specialist Lunch";
}

/** Exact placement signature of a teaching session: the class (teacher) seeing a
 *  specialist for a grade in a specific slot/week. A block "matches the baseline"
 *  iff this exact signature is present in the baseline. */
export function sessionSignature(b: Block): string {
  return `${b.teacher_id}|${b.specialist_id}|${b.grade}|${b.day_of_week}|${b.start_time}|${b.end_time}|${b.week_label ?? ""}`;
}

/** Build the baseline signature multiset from a committed schedule. */
export function buildPerturbationBaseline(blocks: Block[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of blocks) {
    if (!isTeaching(b)) continue;
    const s = sessionSignature(b);
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return m;
}

/** Count teaching blocks whose exact placement differs from the baseline
 *  (moved, added, or rescheduled). Uses a consuming multiset match so duplicate
 *  identical sessions are handled correctly. Lower = closer to the baseline. */
export function countMovedBlocks(blocks: Block[], baseline: Map<string, number>): number {
  const remaining = new Map(baseline);
  let moved = 0;
  for (const b of blocks) {
    if (!isTeaching(b)) continue;
    const s = sessionSignature(b);
    const have = remaining.get(s) ?? 0;
    if (have > 0) remaining.set(s, have - 1);
    else moved++;
  }
  return moved;
}

/** Default penalty (optimizer-score units) per moved block. Kept modest so it
 *  breaks ties toward stability and blocks marginal churn, but never overrides a
 *  genuine quality improvement (which is worth tens of points). */
export const DEFAULT_PERTURBATION_WEIGHT = 3;

/** Build an `objectiveAdjust` hook for SA/LNS: returns the (negative) perturbation
 *  penalty for a candidate, anchored to `baseline`. Maximizing score − penalty
 *  ⇒ prefer fewer moved blocks among equal-quality candidates. */
export function perturbationAdjust(
  baseline: Map<string, number>,
  weight: number = DEFAULT_PERTURBATION_WEIGHT,
): (blocks: Block[]) => number {
  return (blocks: Block[]) => -weight * countMovedBlocks(blocks, baseline);
}
