// Normalize the optimizer's raw score into a 0–100% "quality" percentage
// using the SAME rubric as the verify-schedule edge function so the two
// numbers stay aligned (no more "AI Quality 89/100" next to "Optimizer 49%").
//
// Rubric: 100 - sum(|soft penalties|)/4, clamped to [0,100]. We read those
// penalties straight from the persisted `score_breakdown` JSON.
//
// Why a rubric and not raw/ceiling: positive weights like "+20 per teacher
// with a day preference" make the ceiling depend on how many teachers
// actually have preferences set — if none do, the optimizer literally cannot
// reach them and the percentage gets stuck at 50–60% no matter how perfect
// the schedule is. A penalty-based rubric measures what the schedule is
// doing WRONG, which is what users actually care about.

const PENALTY_KEYS = [
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

/** Convert a persisted score_breakdown into a 0–100% quality percentage. */
export function breakdownToPercent(breakdown: Record<string, number> | null | undefined): number | null {
  if (!breakdown || typeof breakdown !== "object") return null;
  let penaltyMag = 0;
  for (const k of PENALTY_KEYS) {
    const v = breakdown[k];
    if (typeof v === "number" && Number.isFinite(v)) penaltyMag += Math.abs(v);
  }
  const pct = Math.round(100 - penaltyMag / 4);
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

/** Back-compat shim: older callers passed (rawScore, {gradeCount,...}).
 *  We now ignore both and require the breakdown via breakdownToPercent. */
export function scoreToPercent(
  _rawScore: number | null | undefined,
  _input: { gradeCount: number; teacherCount: number; specialistCount: number },
  breakdown?: Record<string, number> | null,
): number | null {
  return breakdownToPercent(breakdown);
}
