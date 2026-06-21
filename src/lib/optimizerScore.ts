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
import { qualityPercent } from "./scoringConstants";

/** Convert a persisted score_breakdown into a 0–100% quality percentage.
 *  Returns null for a missing breakdown (UI shows "—" rather than 0%);
 *  otherwise defers to the shared rubric so FE and edge always agree. */
export function breakdownToPercent(breakdown: Record<string, number> | null | undefined): number | null {
  if (!breakdown || typeof breakdown !== "object") return null;
  return qualityPercent(breakdown);
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
