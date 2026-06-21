// SINGLE SOURCE OF TRUTH for the schedule "quality %" rubric (edge side).
//
// The optimizer's score_breakdown already has each penalty term pre-weighted
// (count × weight), so quality is derived purely from the magnitude of the
// soft-penalty terms — NO weights are re-applied here (doing so would double
// count). Generator (generate-schedule), reviewer (verify-schedule), and the
// frontend (src/lib/scoringConstants.ts — keep IN SYNC) must all use this exact
// key list + formula so the numbers never disagree.
//
// Rubric: round(100 − Σ|penalty term|/4), clamped to [0,100].

export const PENALTY_KEYS = [
  "subject_gap",
  "subject_day_clustering",
  "class_repeats",
  "k_grade_after_780",
  "cart_back_to_back",
  "grade_cohesion",
  "contract_min",
  "spec_dayload_stdev",
  "warnings",
  "errors",
] as const;

/** Sum of absolute soft-penalty magnitudes from a (pre-weighted) breakdown. */
export function penaltyMagnitude(breakdown: Record<string, number> | null | undefined): number {
  if (!breakdown || typeof breakdown !== "object") return 0;
  let mag = 0;
  for (const k of PENALTY_KEYS) {
    const v = breakdown[k];
    if (typeof v === "number" && Number.isFinite(v)) mag += Math.abs(v);
  }
  return mag;
}

/** 0–100 quality percentage. Returns 0 for a missing breakdown (unknown), but
 *  100 for an empty object (a real schedule with zero penalties = perfect). */
export function qualityPercent(breakdown: Record<string, number> | null | undefined): number {
  if (!breakdown || typeof breakdown !== "object") return 0;
  const mag = penaltyMagnitude(breakdown);
  return Math.max(0, Math.min(100, Math.round(100 - mag / 4)));
}
