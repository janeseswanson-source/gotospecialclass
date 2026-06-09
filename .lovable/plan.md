## What's already done in the repo

From the previous plan and follow-on work, these are already in code and don't need to be redone:

- Types cleanup in `StepSchoolInfo.tsx` and `StepContractualMinutes.tsx` (no more `as any` casts on `schools`).
- Warnings UI polish via `src/lib/warningMeta.ts` and friendly rendering in `MasterSchedulePage.tsx`, plus `info` severity styling.
- Smoke tests for `parse-contractual-minutes` edge function.
- Pre-generation feasibility card (`src/lib/contractFeasibility.ts` + `PrepPage.tsx`).
- Scoring nudges (`grade_cohesion`, `contract_min`) in `generate-schedule/_scoring.ts`.
- Wizard params `keep_grades_together`, `suggest_extra_plt`, `extra_plt_target_minutes` on `StepSchoolInfo`.
- `StepContractualMinutes` step with PDF/URL upload, `parse-contractual-minutes` edge function, `contractual-docs` storage bucket.
- AI block-edit edge function already exists as `supabase/functions/replan-subgraph/index.ts` (117 lines) — currently usable for single-block edits, no chat UI on top.
- A/B week labels exist on blocks (`b.week_label`) and `MasterSchedulePage` already has a `weekFilter` Tabs control at line 839 — but it's only visible when `hasWeekLabels` is true, which is exactly the bug below.

## What's NOT done / broken (this plan covers it)

### 1. Conflict strategy not actually used at generation time
**Bug:** `StepReview.tsx:98` writes `conflict_strategy` as a single scalar; `StepConflict.tsx:312` only picks the first non-standard strategy from `conflictStrategies[]`. The generator (`generate-schedule/index.ts:1942`) reads `school.conflict_strategy ?? "standard"` and runs only that one. So selecting A/B + AA/BB + Quick-30 collapses to whichever appears first, often "standard".

**Fix:**
- Persist the full ordered `conflict_strategies` array (already a `text[]` column) and stop overwriting `conflict_strategy` with a derived scalar on save.
- In `generate-schedule/index.ts`, change the strategy order source to prefer `school.conflict_strategies` (ordered) and fall back to `[conflict_strategy ?? "standard"]`. Each listed strategy runs in turn during the Monte Carlo loop (the loop at line 2150 already supports an array).
- Stamp the chosen + attempted strategies into `schedule_generations.chosen_strategy` / `attempted_strategies` as today.

### 2. A/B week viewer doesn't surface the alternate weeks
**Bug:** Week tabs render only when `hasWeekLabels` is true (line 453). When a generation falls back to `standard`, blocks have no `week_label` and the tab disappears. When it does succeed, the "all" tab dumps both weeks into the same cell, which is unreadable.

**Fix in `MasterSchedulePage.tsx`:**
- Always render the week selector when the chosen strategy is `ab_week`/`aa_bb_week`, not only when blocks happen to carry labels.
- Default selection to "Week A" instead of "all" for those strategies, so users see one week at a time and can flip.
- Show a small badge near the schedule header: `Rotation: A/B Week — viewing Week A` with a toggle.
- For AA/BB show 4-week selector (`AA-1, AA-2, BB-1, BB-2`) backed by the existing `week_label` field.

### 3. Setup checklist forgets conflict strategy on reload
**Bug:** `StepConflict.tsx:271-287` loads `conflict_strategies` from DB and falls back to `[conflict_strategy]` only when the array is empty. The checklist (separate code path) checks a different field, so after a reload it asks the user to reselect even though the data is there.

**Fix:** Make the checklist's "Conflict strategy chosen" probe match the same source of truth (`conflict_strategies` array length > 0 OR `conflict_strategy !== 'standard'`). One-line change in the checklist helper plus a smoke test.

### 4. Per-block AI explanations missing in the UI
`computePlacementReason` runs in the generator and writes `placement_reason` to each block; the edit drawer already reads it (line 991). But the per-block reasons are formulaic strings, not natural-language explanations.

**Fix:** Extend `generate-schedule` to optionally call Lovable AI (`google/gemini-3-flash-preview`) once per generation with a compact block summary and ask it to add a 1-sentence rationale per block (batched in a single call, JSON output keyed by block id). Store on `schedule_blocks.placement_reason`. Behind a feature flag (`schools.ai_explanations_enabled`, default true) so it can be turned off if credits are tight.

### 5. AI chat editor for the master schedule (main Phase 2 ask)
Today only `replan-subgraph` exists, called from a single-block menu. The user wants free-form, conversational edits on the whole schedule.

**New build:**
- New edge function `schedule-chat` (verify_jwt=false, manual auth) that accepts `{ generation_id, messages: UIMessage[] }`, loads the current `schedule_blocks` for that generation, and runs `streamText` from the AI SDK with a system prompt and tools:
  - `move_block({block_id, day, start_time})`
  - `swap_blocks({block_a_id, block_b_id})`
  - `replace_block({block_id, new_subject|new_specialist_id|new_teacher_id})`
  - `delete_block({block_id})`
  - `insert_block({...})`
  - `bulk_apply({nl_instruction})` — falls back to `replan-subgraph` for compound asks.
- Each tool validates against the same occupancy/role/lunch constraints used by the generator (reuse helpers from `_scoring.ts` and the occupancy module), and writes through to `schedule_blocks` in a transaction. Rejected edits return a structured reason the model surfaces.
- New side panel `<ScheduleChatPanel>` in `MasterSchedulePage.tsx`: AI SDK `useChat` against the function, message list with `message.parts`, composer pinned to bottom, suggested prompts ("Move 3rd grade music to Tuesday", "Give Ms. Lee a longer prep on Friday"). Follows `chat-ui-composition`/`chat-agent-ui-contract`: one conversation per generation, persisted in `schedule_generations.chat_history JSONB`.
- Optimistic UI: when a tool writes to `schedule_blocks`, push a realtime update or simply re-query the schedule after `onFinish`.

### 6. Accept / Reject gate on first generation
Today the schedule lands on `MasterSchedulePage` directly editable. Add a lightweight review state:
- New `schedule_generations.review_state` column: `pending` | `accepted` | `rejected`.
- After generation completes, show a top bar: "Review this schedule" with two buttons:
  - **Accept** → flips to `accepted`, unlocks drag/drop and exports.
  - **Reject & edit** → opens the chat panel from item 5 and keeps state `pending`. User can also choose "Regenerate from scratch" which re-runs `generate-schedule`.
- Drag/drop and manual editing remain enabled in both states; the bar just communicates the workflow.

### 7. Wizard parameters: "keep grades together" + "suggest extra PLT"
Already exists on `schools` and `StepSchoolInfo`. What's missing: the generator only treats them as soft scoring nudges. Add:
- A pre-flight feasibility line in `contractFeasibility.ts` when `keep_grades_together` is on and a grade's required minutes can't fit in a single day.
- An "Add suggested PLT block" CTA in the warnings panel when the engine emits `extra_plt_below_target` — clicking it runs `replan-subgraph` to insert one.

### 8. Lunch / recess labels too noisy
`StepRecessLunch.tsx` (427 lines) lists every grade × period. Rework:
- Group by period (`Early Lunch`, `Late Lunch`, `Recess`) with each period showing a single editable label + a multi-select of grades.
- Collapse repeated rows; show a single summary line: `Early Lunch · 11:15–11:45 · Grades K, 1, 2`.
- Same treatment in `MasterSchedulePage` cells: show the period label, not the per-grade duplicate.

### 9. Wizard UX rework (modern + AI-assisted)
Broad ask, scoped here so it ships incrementally:
- **Layout:** convert each step from dense forms into a two-column "explain on the left, inputs on the right" pattern. Reuse the existing brand tokens (`#1B2A4A`, `#C5A55A`), tighten spacing, drop redundant section headers.
- **Progress:** persistent left rail with step status (done/active/needs-attention) replacing the current top bar. Click any completed step to jump back.
- **AI helpers per step:**
  - `StepSchoolInfo`: "Paste your school calendar URL or PDF → AI fills bell schedule, start/end dates, holidays." Hooks into existing `parse-calendar` function.
  - `StepTeachers` / `StepSpecialists`: already supports template upload via `process-onboarding-template`; surface it more prominently with a single "Import roster" button.
  - `StepConflict`: add a "Recommend strategy" button that runs the existing `analyzeFeasibility` and suggests the ordered list of strategies for the user.
  - `StepClubs` / `StepEvents`: free-text box "Describe your clubs in plain English" → AI parses into structured rows (new tiny edge function `parse-clubs-nl`).
  - `StepContractualMinutes`: already AI-powered; just elevate it visually.
- **Review step:** show a "Schedule Readiness" score (sum of feasibility warnings) and a CTA to run the generator.

### 10. Admin view should show class teacher name
In `MasterSchedulePage.tsx` admin grid, each block currently shows `subject · grade · room`. Join `classroom_teachers` via `teacher_id` and append `· Ms. Lee` when the viewer is an admin (`useUserRole` is already in code). One-line addition to the block card renderer.

## Out of scope for this plan (call out, don't build yet)
- Billing / Stripe activation flow.
- Per-school export bundling and parent-facing PDFs.
- Lesson planner content generation.

## Suggested build order
1. Conflict strategy persistence + generator wiring (items 1, 3) — small, unblocks everything else.
2. A/B week viewer fix + admin teacher name (items 2, 10) — quick UI wins.
3. AI chat editor + accept/reject gate (items 5, 6) — the headline Phase 2 feature.
4. Per-block AI explanations (item 4).
5. Wizard rework: lunch/recess collapse + AI helpers + layout pass (items 7, 8, 9).

## Technical notes
- New columns required: `schedule_generations.review_state` (text, default `'pending'`), `schedule_generations.chat_history` (jsonb), `schools.ai_explanations_enabled` (bool, default true). One migration.
- New edge functions: `schedule-chat`, `parse-clubs-nl`. Both follow the existing `verify_jwt=false` manual-auth pattern and use Lovable AI Gateway (`google/gemini-3-flash-preview`).
- Reuse `replan-subgraph` for compound rewrites from the chat agent.
- No new storage buckets.
- All AI calls go through Lovable AI Gateway with the shared provider helper.
