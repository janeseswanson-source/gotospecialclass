// Normalize the optimizer's raw `winning_score` into a 0–100% "quality"
// percentage so the Schedule Insights panel can display something
// meaningful to users. The raw score is a sum of penalties + bonuses and
// its absolute value varies wildly by school size, so we express it as a
// fraction of the theoretical positive ceiling for THIS schedule.
//
// Ceiling = the sum of every positive weight × the number of items it can
// reward (one per grade for coverage, one per teacher for am/pm or day
// preference, one per specialist for planning target met). This matches
// the scorer in supabase/functions/generate-schedule/_scoring.ts.

interface CeilingInput {
  gradeCount: number;
  teacherCount: number;
  specialistCount: number;
}

const POSITIVE_WEIGHTS = {
  full_week_coverage: 100,
  am_pm_satisfied: 10,
  day_pref_satisfied: 20,
  planning_target_met: 30,
};

/** Theoretical best the optimizer could ever score for a given school. */
export function maxPossibleScore(input: CeilingInput): number {
  const { gradeCount, teacherCount, specialistCount } = input;
  return (
    POSITIVE_WEIGHTS.full_week_coverage * Math.max(1, gradeCount) +
    POSITIVE_WEIGHTS.am_pm_satisfied * Math.max(0, teacherCount) +
    POSITIVE_WEIGHTS.day_pref_satisfied * Math.max(0, teacherCount) +
    POSITIVE_WEIGHTS.planning_target_met * Math.max(0, specialistCount)
  );
}

/**
 * Convert a raw winning_score into an integer percentage 0–100.
 * Negative scores (errors dominating) clamp to 0; scores at or above the
 * theoretical max clamp to 100.
 */
export function scoreToPercent(rawScore: number | null | undefined, input: CeilingInput): number | null {
  if (rawScore == null || !Number.isFinite(rawScore)) return null;
  const ceiling = maxPossibleScore(input);
  if (ceiling <= 0) return null;
  const pct = Math.round((rawScore / ceiling) * 100);
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}
