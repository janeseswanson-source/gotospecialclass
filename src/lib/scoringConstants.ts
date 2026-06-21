// Frontend mirror of supabase/functions/_shared/scoring-rubric.ts.
//
// Edge (Deno) and frontend (Vite) can't share a module directly, so this is a
// deliberate, tested mirror: the SAME PENALTY_KEYS + formula. A parity test
// (scoringConstants.test.ts) and the edge test (scoring-rubric_test.ts) assert
// identical results on identical fixtures so the two never drift.
//
// Rubric: round(100 − Σ|penalty term|/4), clamped to [0,100]. The optimizer's
// score_breakdown is already pre-weighted, so weights are NOT re-applied here.

export const PENALTY_KEYS = [
  "subject_gap",
  "subject_day_clustering",
  "class_repeats",
  "k_grade_after_780",
  "cart_back_to_back",
  "grade_cohesion",
  "contract_min",
  "spec_dayload_stdev",
  "teacher_planning",
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
