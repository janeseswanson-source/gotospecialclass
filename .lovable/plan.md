## Plan

Five tasks, then a Phase 2 kickoff.

### 1. Types cleanup
- Remove `(supabase as any)` and `(existingSchool as any)` casts in `StepSchoolInfo.tsx` and `StepContractualMinutes.tsx` now that `schools.keep_grades_together`, `suggest_extra_plt`, `extra_plt_target_minutes`, `contractual_minutes_*` columns exist in the regenerated types.

### 2. Warnings UI polish
- Add a tiny `warningMeta(type)` helper (icon + friendly label) for the new types:
  - `grade_cohesion`, `extra_plt_below_target`, `contractual_subject_shortfall`, `contractual_planning_shortfall`, `contractual_duty_free_shortfall`, `contractual_role_unmatched`
- Wire it into `renderRow` in `MasterSchedulePage.tsx` so they render with a friendly title chip instead of raw `type` strings. Keep severity color logic intact. Add `info` severity styling (currently only error/warning are handled).

### 3. Edge-function smoke test
- Add a Deno test file `supabase/functions/parse-contractual-minutes/_smoke_test.ts` that:
  - Mocks the AI Gateway fetch (no live PDF needed — verifies tool-call response parsing, status transitions to `parsed`/`error`, missing-doc 400, unauthorized 401).
- Run via `supabase--test_edge_functions`.

### 4. Pre-generation feasibility
- New helper `src/lib/contractFeasibility.ts` exporting `analyzeContractFeasibility(school, specialists, teachers)` returning an array of `{level: 'info'|'warning', message}`.
- Detects: contract subjects without a matching specialist subject, contract roles unmatched to any specialist, suggested-extra-PLT target larger than free time the wizard implies.
- Render results in `PrepPage.tsx` inside the existing pre-flight card area.

### 5. Scoring nudges (engine-level)
- In `supabase/functions/generate-schedule/index.ts`, extend `ScoreBreakdown` with two penalties: `gradeCohesion` and `contractMin`.
- Compute both from the same logic as the validators (count cohesion overspread; sum shortfall minutes for subjects + teachers). Both default-weighted so they nudge but never block.
- Add default weights and ensure existing `weightOverrides` continue to work.

### 6. Phase 2 kickoff
- After items 1–5 are merged, stop and present a short Phase 2 plan covering whatever you have queued next (publishing/billing, dashboards, exports, etc.). I'll wait for your direction on Phase 2 scope.

### Technical notes
- All warning types remain soft (no `severity: 'error'`).
- Scoring weights live alongside existing keys in `scoring_weight_profiles.weights`; no migration needed.
- No new tables or storage buckets.