// Phase 4 — learnable-weights loop (inverse optimization).
//
// After a generation is accepted, admins make manual edits. Those edits reveal
// what they actually value: each edit changes the soft-term counts. We infer a
// CLAMPED weight nudge that would have made the admin's edited layout score higher
// than the original — lightweight inverse optimization (gradient ascent on the
// edited-vs-original score margin). The result is a PROPOSAL the admin confirms;
// it is never auto-applied. Hard-constraint weights (errors/warnings) are never
// touched, and every weight stays within ±50% of its default.
//
// Math: for term k scored with the same weights on both layouts,
//   gradient_k = count_k(edited) − count_k(original) = (edited[k] − original[k]) / w_k
// To raise the margin (reward the admin's direction) we step weight_k by
//   lr · |default_k| · sign(gradient_k)
// which correctly increases a penalty's magnitude when the admin reduced that
// penalty, and increases a reward's weight when the admin increased that reward.

import { DEFAULT_WEIGHTS, type ScoreBreakdown } from "./_scoring.ts";

export type WeightKey = keyof ScoreBreakdown;

/** Hard-constraint terms are NEVER reweighted by learning. */
const NON_LEARNABLE = new Set<WeightKey>(["errors", "warnings"]);

export const LEARNABLE_KEYS: WeightKey[] = (Object.keys(DEFAULT_WEIGHTS) as WeightKey[])
  .filter((k) => !NON_LEARNABLE.has(k));

/** Clamp a weight to ±50% of its default magnitude (same rule as the edge fn). */
export function clampToDefault(key: WeightKey, value: number, defaults: Record<string, number> = DEFAULT_WEIGHTS): number {
  const def = defaults[key];
  if (def === undefined || def === 0) return value;
  const a = def * 0.5;
  const b = def * 1.5;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return Math.max(lo, Math.min(hi, value));
}

export interface WeightDelta {
  key: WeightKey;
  from: number;
  to: number;
  direction: "increase_magnitude" | "decrease_magnitude" | "unchanged";
  /** Plain-language reason tied to the observed edit. */
  reason: string;
}

export interface WeightProposal {
  proposedWeights: Record<string, number>;
  deltas: WeightDelta[];
  summary: string;
}

const TERM_LABEL: Partial<Record<WeightKey, string>> = {
  subject_gap: "subject coverage gaps",
  subject_day_clustering: "same-subject-same-day clustering",
  class_repeats: "repeat specialist visits",
  k_grade_after_780: "late-day Kindergarten classes",
  cart_back_to_back: "cart back-to-back moves",
  grade_cohesion: "grade-day cohesion",
  grade_day_spread: "same-day grade mixing",
  contract_min: "contractual minutes",
  spec_dayload_stdev: "specialist day-load balance",
  teacher_planning: "teacher planning minutes",
  full_week_coverage: "full-week coverage",
  am_pm_satisfied: "AM/PM preferences",
  day_pref_satisfied: "day preferences",
  planning_target_met: "specialist planning targets",
};

/**
 * Propose a clamped weight nudge from the original (generated) and edited
 * (admin-preferred) score breakdowns. Both breakdowns MUST be computed with the
 * same `currentWeights` so |breakdown_k| ∝ count_k. Pure + deterministic.
 *
 * @param learningRate fraction of each default magnitude to step per sample.
 */
export function proposeWeightDeltas(
  originalBreakdown: Record<string, number> | null | undefined,
  editedBreakdown: Record<string, number> | null | undefined,
  currentWeights: Record<string, number>,
  defaults: Record<string, number> = DEFAULT_WEIGHTS,
  learningRate = 0.1,
): WeightProposal {
  const orig = originalBreakdown ?? {};
  const edit = editedBreakdown ?? {};
  const proposedWeights: Record<string, number> = { ...currentWeights };
  const deltas: WeightDelta[] = [];

  for (const key of LEARNABLE_KEYS) {
    const w = currentWeights[key] ?? defaults[key] ?? 0;
    const def = defaults[key] ?? 0;
    if (w === 0 || def === 0) continue;

    const ob = orig[key] ?? 0;
    const eb = edit[key] ?? 0;
    // gradient_k = (count_edit − count_orig); same-weights ⇒ divide by w.
    const gradient = (eb - ob) / w;
    if (gradient === 0) continue;

    const step = learningRate * Math.abs(def) * Math.sign(gradient);
    const next = clampToDefault(key, w + step, defaults);
    if (next === w) continue;

    const increasedMagnitude = Math.abs(next) > Math.abs(w);
    const label = TERM_LABEL[key] ?? key;
    deltas.push({
      key,
      from: round(w),
      to: round(next),
      direction: increasedMagnitude ? "increase_magnitude" : "decrease_magnitude",
      reason: increasedMagnitude
        ? `Your edits reduced ${label}, so future schedules will weight it more.`
        : `Your edits accepted more ${label}, so future schedules will weight it less.`,
    });
    proposedWeights[key] = next;
  }

  deltas.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
  const summary = deltas.length === 0
    ? "Your edits did not change any soft-quality trade-off — no weight change is proposed."
    : `Proposed ${deltas.length} weight adjustment${deltas.length === 1 ? "" : "s"} based on your edits, each within ±50% of the default. Review and confirm to apply to future schedules.`;

  return { proposedWeights, deltas, summary };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
