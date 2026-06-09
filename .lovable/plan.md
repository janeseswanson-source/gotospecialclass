## Phase 1 — Setup Wizard redesign + new parameters

This plan covers wizard UX, new scheduling parameters, contractual-minutes via AI, the admin-view teacher name fix, and the conflict-strategy reselect bug. The AI schedule editor + accept/reject + A/B fixes are deferred to a Phase 2 plan as you chose.

### 1. Wizard shell redesign (modern, easier to use)
Files: `src/pages/setup/SetupWizardContent.tsx`, `src/pages/setup/SetupPage.tsx`, every `src/pages/setup/steps/Step*.tsx`.

- Replace the dense binder tabs with a two-pane layout:
  - Left rail: vertical stepper (numbered, with completed/in-progress/locked states, AI-readiness chips), collapsible on small screens, dropdown on mobile (keep existing mobile select).
  - Right pane: one focused step at a time, max-width ~860px, generous spacing, single H1 per step, short helper text, no walls of small captions.
- Each step gets a consistent header block: title, one-sentence purpose, "Why this matters" tooltip, and a right-aligned "Ask AI to fill this in" button where applicable.
- Persistent footer with Back / Save & Continue / Skip-for-now and a slim auto-save status pill (reuse `SaveStatusIndicator`).
- Replace heavy color-coded cards with neutral cards + subtle accent stripe (match the recent Master Schedule restyle in `subjectColors.ts`).

### 2. AI assistance throughout the wizard
- Add a reusable `<AiAssistButton>` (opens a prompt dialog) wired to a new Edge Function `wizard-assist` that takes `{ step, currentData, prompt }` and returns a structured patch the step applies via `updateData`. Uses Lovable AI Gateway (`google/gemini-3-flash-preview`) with the AI SDK `Output` API.
- Per-step uses:
  - School Info: "Describe your school day" → fills start/end/class duration/passing time.
  - Recess & Lunch: paste a paragraph or upload schedule → fills `recessConfig`.
  - Specialists/Teachers: keep existing template upload; add "Paste a roster" free-text AI parser.
  - Conflicts: "Describe your scheduling pain points" → recommends + orders strategies.
  - Review: "Explain my setup" summary + "What did I miss?" gap analysis.

### 3. New scheduling parameters
Schema additions on `public.schools` (one migration):
- `keep_grades_together boolean default true`
- `suggest_extra_plt boolean default false`
- `extra_plt_target_minutes int null`
- `contractual_minutes_url text null`
- `contractual_minutes_file_path text null` (storage path)
- `contractual_minutes_extracted jsonb null` (AI result: `{ subjects: [{grade, subject, weekly_minutes}], teachers: [{role, planning_minutes, duty_free_minutes, notes}] }`)
- `contractual_minutes_status text null` (`pending|parsed|error`)

Wizard updates:
- **School Info step**: add a "Keep grades together when scheduling" toggle (default on) with helper text describing the constraint, and a "Suggest an extra PLT block when feasible" toggle with target-minutes input.
- **New Conflict step parameter section** (or extend School Info): explanation that the generator will try to keep all sections of a grade in adjacent/same blocks, and surface a "Suggested extra PLT" recommendation card when feasibility allows.

Generator wiring:
- Pass these new fields into `supabase/functions/generate-schedule/index.ts` as soft constraints (penalty in `_scoring.ts` for splitting a grade; bonus block insertion in main loop when `suggest_extra_plt` is on and a free common slot exists).
- Surface the resulting suggestion in the generation summary so the user can accept/reject the extra PLT (the accept/reject UI itself comes in Phase 2; for now it's logged in `schedule_generations.score_breakdown`).

### 4. Contractual minutes upload + AI parsing
- New wizard step **"Contractual Minutes"** inserted between Teachers and Admin Rotation (update `stepIndex.ts`, `SetupWizardContent.tsx`).
- UI: tabs for "Upload PDF" / "Paste URL" / "Skip". PDF goes to a new private storage bucket `contractual-docs` (created via storage tool). URL is stored as-is.
- New Edge Function `parse-contractual-minutes`:
  - Downloads the PDF (or fetches the URL, with HTML→text fallback), sends to Lovable AI with a structured schema covering BOTH per-subject weekly minutes (per grade) and per-teacher planning/duty-free minutes.
  - Writes `contractual_minutes_extracted` + `contractual_minutes_status='parsed'`.
- After parsing, the step shows an editable review table so the coordinator can correct values before saving.
- Generator reads the extracted JSON: per-subject minutes become target totals (penalty for shortfalls in `_scoring.ts`); per-teacher planning minutes feed the existing planning-minutes constraint per teacher/role.

### 5. Cleaner recess / lunch labels
File: `src/pages/setup/steps/StepRecessLunch.tsx`.
- Rename UI labels from generic "AM Recess Start/End" to grade-scoped phrasing: "K–2 Morning Recess (start–end)", "Lunch for Grade 3 (12:00–12:30)", etc., based on which grades the row applies to.
- Group fields by meal (Morning Recess / Lunch / Afternoon Recess) inside one card per grade band; show a compact summary line "9:45 AM – 10:00 AM · 15 min" instead of two raw time inputs side by side.
- Move the early-release variant into a collapsible "Early-release day overrides" section so it stops crowding the main form.

### 6. Admin view shows classroom teacher name
File: `src/pages/schedule/MasterSchedulePage.tsx` (Admin tab) and `src/components/schedule/ScheduleBlockCell.tsx`.
- The data already joins `teacher_name`; the Admin grid currently shows specialist/subject only. Add a second line under the subject with `teacher_name (grade)` when the view tab is "Admin". Keep specialist-focused tabs unchanged.
- Also include teacher name in the Admin PDF export (`src/pdf/AdminOverview.tsx`).

### 7. Bug: conflict strategy unselected after refresh
File: `src/pages/setup/steps/StepConflict.tsx` (around the load effect at L264 and the save at L296).
- Root cause: on load, `conflict_strategies` (jsonb array) is hydrated, but if it's null the step falls back and the user sees an empty list even though `conflict_strategy` (single legacy column) is set. The auto-save then overwrites `conflict_strategy` back to `'standard'` (L302) because the array is empty.
- Fix:
  - On load, if `conflict_strategies` is null/empty but `conflict_strategy` is set and not `'standard'`, seed `conflictStrategies` from it.
  - Guard the auto-save so it does not run until the initial load has completed (track a `hydratedRef`); this prevents the empty-array overwrite that defaults it back to standard.
  - Add a regression test in `src/lib/scheduleGrid.test.ts`-style spec for the seed logic (or a new `StepConflict.test.tsx` if testing infra allows).

### 8. Validation
- Manual: walk the wizard end-to-end on desktop + mobile; confirm new layout, AI assist buttons, new params persist, recess labels read clearly.
- Contractual minutes: upload a sample PDF, confirm parsed JSON appears in the review table and saves.
- Refresh on the Conflicts step after picking AA/BB → strategy stays selected, DB row keeps `conflict_strategies` populated.
- Admin tab: every block shows the classroom teacher's name; PDF export includes it.
- `bun run build` + lint clean.

### Technical notes
- New schema fields and the new step require one Supabase migration (schools alter + new storage bucket + RLS for the bucket scoped to workspace members).
- New Edge Functions: `wizard-assist`, `parse-contractual-minutes` (manual `verify_jwt=false` auth pattern, Lovable AI Gateway via `_shared/ai-gateway.ts`).
- Generator changes are additive penalties/bonuses; existing schedules continue to validate.
- Out of scope for this plan (Phase 2): natural-language Master Schedule chatbot, accept/reject draft flow, A/B week visibility fix, per-block AI explanations.