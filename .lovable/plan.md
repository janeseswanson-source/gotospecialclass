# Generator fixes A–E (implemented)

## A. New / stronger penalties in `_scoring.ts`
- `subject_gap: -40` per (grade, specialist) pair with zero sessions in the week.
- `subject_day_clustering: -15` per duplicate of same (grade, subject) on same day.
- `k_grade_after_780: -3 → -20`
- `class_repeats: -8 → -25`

## B. Monte Carlo
- Iteration tiers raised: ≤200ms → 200, ≤500ms → 100, else → 50 (was 50/25/10).
- Budget cap raised 30s → 60s.

## C. Simulated Annealing
- Added third mutation type: "anti-cluster shuffle" — finds a (grade, subject, day) duplicate and relocates one occurrence to a day that doesn't already have that subject.
- `SA_MAX_ITER` 200 → 500, cooling 0.95 → 0.97, time budget 8s → 12s.

## D. Shared rubric in `verify-schedule`
- Quality score is computed deterministically from the generator's `score_breakdown` (sum of penalty magnitudes, scaled to 0–100).
- AI is no longer asked to invent a score — only qualitative summary + concrete fixes.

## E. Pre-flight feasibility
- Hard error in `generateScheduleBlocks` when `Σ(specialist working-days) < grades × specialists`.
- Returned as HTTP 422 with code `infeasible_schedule` and an actionable message (add specialists / expand days / enable A/B Week).

## Files touched
- `supabase/functions/generate-schedule/_scoring.ts`
- `supabase/functions/generate-schedule/_monteCarlo.ts`
- `supabase/functions/generate-schedule/_monteCarlo_test.ts`
- `supabase/functions/generate-schedule/_scoring_test.ts`
- `supabase/functions/generate-schedule/index.ts`
- `supabase/functions/verify-schedule/index.ts`
- `supabase/functions/update-scoring-weights/index.ts`
