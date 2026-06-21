## Fix gaps in latest generator + branding changes

### 1. Add missing unit tests for new penalties
- In `_scoring_test.ts`, add tests for:
  - `subject_gap`: a grade missing a specialist should incur −40 per missing pair.
  - `subject_day_clustering`: two blocks of the same (grade, subject) on the same day should incur −15 per duplicate.

### 2. Guard anti-cluster shuffle against idle-day creation
- In `runSimulatedAnnealing` (index.ts), the anti-cluster shuffle branch (mutation type 2) currently picks any block from a duplicate cluster and moves it.
- It should check `isLastOnDay` — if the chosen block is the specialist's **only** teaching block on that day, skip the move (just as the regular MOVE mutation does). Without this, SA can accidentally strand a specialist on an idle day.

### 3. Decide + align feasibility check behavior
**Background**: The approved plan specified a hard error (`throw new Error("Infeasible schedule: ...")`) returning HTTP 422. The implemented code changed this to a soft warning (`capacity_shortfall`) so generation continues and produces a best-effort schedule.

**Options**:
- **Option A (keep warning)**: Remove the dead `infeasible_schedule` catch block at line ~2900 of `index.ts`. The warning path stays.
- **Option B (revert to hard error)**: Change `generateScheduleBlocks` to throw when `sessionCapacity < requiredSessions`, and keep the existing catch block.

*Recommendation*: Option A (warning). A hard 422 blocks the user from seeing any schedule at all. The warning still tells them exactly what's wrong and how to fix it, while the solver covers as many classes as it can.

### 4. Type-check cleanup (if needed)
- Verify `BrandedScheduleHeader.tsx` compiles cleanly. `React.ReactNode` is used without an explicit React import; it currently passes `tsc --noEmit`, so no action needed unless a future TS config change breaks it.

### Files touched
- `supabase/functions/generate-schedule/_scoring_test.ts`
- `supabase/functions/generate-schedule/index.ts`

**Estimated effort**: small (~15 min).