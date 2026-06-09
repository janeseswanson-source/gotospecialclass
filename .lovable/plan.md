
## 1. Fix "Failed to save recess configuration"

Schema is actually fine (`recess_lunch_config` has every column the code writes, plus a `UNIQUE(school_id, grade_band)` constraint). The current `delete → insert` flow is fragile and the toast hides the real error.

**Edit `src/pages/setup/steps/StepRecessLunch.tsx` (`autoSave`)**
- Replace `delete + insert` with a single `upsert(rows, { onConflict: 'school_id,grade_band' })`, then delete only the rows whose `grade_band` is no longer present (selective delete). This removes the race where a debounced second save runs while the first delete is in-flight (the most likely real cause of the error).
- De-duplicate `bandKey` collisions in `buildPayload` before insert (guards against two periods generating the same fallback `'all'` key with different grade arrays).
- In the `catch` block, surface the real Postgres error: `toast.error(\`Save failed: ${err.message ?? 'unknown error'}\`)` and `console.error('[StepRecessLunch] save failed', { code: err.code, details: err.details, hint: err.hint, message: err.message })`. This will tell us instantly if there's still a residual constraint/RLS issue.
- Guard against empty `grade_band` strings (default to `'all'`) so the UNIQUE constraint never sees `''`.

No schema/migration change required.

## 2. Scheduling quality fixes (`supabase/functions/generate-schedule/index.ts`)

Today's grid is jagged (07:45 / 07:50 / 08:05 / 08:35), block lengths drift (30 vs 45), Grade 3 can be double-booked, and Mon/Tue afternoons are overloaded while Wed/Thu afternoons sit empty. Four changes:

**a. Standardized period grid.** Build a single period grid once per school from `school.start_time`, `class_duration`, `passing_time` and the recess/lunch bands. Every placement must snap to a period start. No more arbitrary `+5` offsets.

**b. Strategy-driven block length is authoritative.** `chosen_strategy` (e.g. `quick_30`) sets the effective duration for every block emitted in that pass — drop the per-grade override that lets 45-min blocks slip through. Add a post-pass assertion: if any emitted block ≠ effective duration for its grade, log and refuse to commit that block.

**c. Hard per-grade-per-slot uniqueness.** Before commit, scan the candidate set: for every `(grade, day, week_label, overlapping minute)` there may be at most one block. If a second specialist tries to occupy Grade 3 Tuesday 07:45, the second placement is rejected and re-planned in the next free period.

**d. Per-day load balancing.** Add a soft scoring term in `_scoring.ts` that penalizes the variance of specialist-blocks-per-day across Mon–Fri (and an extra penalty for blocks scheduled after a "afternoon_cutoff" minute when earlier slots in the same week are empty). Monte Carlo will then naturally pick flatter weeks.

Each of these is local to the generator and the scorer — no DB migration.

## 3. AI architecture upgrade

Current state: a single `schedule-chat` Edge Function returns text + a JSON patch, only reachable from the "Edit with AI" panel. Improvements:

**a. Move to AI SDK tool-calling (server-side).** Replace the bespoke JSON-patch protocol with named tools: `move_block`, `swap_blocks`, `delete_block`, `insert_block`, `regenerate_day`, `explain_conflict`. Each tool has a Zod `inputSchema` and an `execute` that validates against the same constraints as #2 (period grid, no double-book, recess-safe). Mutating tools use `needsApproval: true` so the user confirms in chat before the DB writes.

**b. Persistent conversational chatbot, not a modal.** Promote `ScheduleChatPanel` to a docked side panel with a floating FAB, mounted on `MasterSchedulePage`, `SpecialistPlannerPage`, and `PrepPage`. Use `useChat` + `DefaultChatTransport` against the same Edge Function with `stopWhen: stepCountIs(50)` for multi-step tool loops. Conversation history persists per `schedule_generation_id` in `localStorage` (no new table — matches our "one conversation, local" pattern unless the user asks for threads).

**c. Shared context object.** The function builds a compact context (`schoolMeta`, `blocks`, `recessBands`, `conflicts`, `warnings`, `strategy`) once per request and passes it to the model as a system message, so every tool call sees the same canonical state.

**d. Re-use across features.** The same tool set powers the chat panel, the existing "Resolve Conflicts" button, and the wizard's "Explain this step" rationale (currently three separate functions). Consolidate `schedule-chat`, `resolve-conflicts-ai`, and `explain-schedule` into one `ai-schedule-agent` function with a `mode` field; keep the old endpoints as thin shims for one release.

**e. Error & cost surfacing.** Centralize 402/429 handling — show a clear banner with a "Add credits" link instead of the generic failure toast.

## Out of scope for this plan
- Drag-and-drop polish, wizard rail tweaks, and the period-card layout — already shipped in the previous iteration.
- No new tables or migrations.

## Technical notes
- Files touched: `src/pages/setup/steps/StepRecessLunch.tsx`, `supabase/functions/generate-schedule/index.ts`, `supabase/functions/generate-schedule/_scoring.ts`, `src/components/schedule/ScheduleChatPanel.tsx`, `src/pages/schedule/MasterSchedulePage.tsx`, new `supabase/functions/ai-schedule-agent/index.ts` (Edge Function with `verify_jwt=false` + manual auth, AI SDK + Lovable AI Gateway, `google/gemini-3-flash-preview`).
- Old `schedule-chat`, `resolve-conflicts-ai`, `explain-schedule` retained as one-line shims pointing at the new agent so existing UI doesn't break mid-migration.
