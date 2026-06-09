## Post-Migration Wire-Up

The migration adds the new `schools` columns, the `contractual-docs` storage bucket, and its RLS policies. Once it runs, finish wiring the UI and generator to the new fields.

### 1. Persist new wizard params
- `StepSchoolInfo.tsx`: include `keep_grades_together`, `suggest_extra_plt`, `extra_plt_target_minutes` in the school upsert payload and hydrate them on load.
- Add the same fields to the school types/queries used by the wizard.

### 2. Contractual minutes upload flow
- `StepContractualMinutes.tsx`: upload PDFs to the `contractual-docs` bucket under `${workspace_id}/${school_id}/${filename}`, save `contractual_minutes_file_path` / `contractual_minutes_url`, then invoke the `parse-contractual-minutes` Edge Function.
- Store returned JSON in `contractual_minutes_extracted`, update `contractual_minutes_status` (`pending` → `parsing` → `ready` / `error`), and render a summary card with per-subject and per-teacher minutes plus a re-parse button.

### 3. Generator integration (soft constraints)
- Scheduler: when `keep_grades_together` is true, add a penalty for splitting a grade's specials across non-adjacent blocks.
- When `suggest_extra_plt` is true and slack exists, insert PLT blocks toward `extra_plt_target_minutes`.
- When `contractual_minutes_extracted` is present, treat per-subject weekly minutes as targets and per-teacher planning/duty-free as hard floors; surface shortfalls in the existing feasibility warnings.

### 4. Admin view polish
- Verify `ScheduleBlockCell.tsx` Admin variant shows `teacher_name (grade)` cleanly; mirror it in the Admin PDF export.

### 5. Conflict strategy hydration
- Confirm the `StepConflict.tsx` fix: refresh on Conflicts step keeps the user's selection instead of resetting to `standard`.

### 6. Validation
- Walk the wizard end-to-end, upload a sample contract, refresh on Conflicts, generate a schedule, and check the Admin tab.

Out of scope (deferred to next phase): Master Schedule natural-language chatbot, draft accept/reject flow, A/B week visibility fix, per-block AI explanations.
