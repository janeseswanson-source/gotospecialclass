## Phase 2 — full build

All five remaining items from the approved plan, shipped in the order they unblock each other. Items 1–3 (conflict strategy, A/B viewer, checklist) are already merged from the last turn.

### A. Schema migration (one migration, runs first)

Add to `schedule_generations`:
- `review_state text not null default 'pending'` — values: `pending` | `accepted` | `rejected`
- `chat_history jsonb not null default '[]'::jsonb` — array of AI SDK `UIMessage`

Add to `schools`:
- `ai_explanations_enabled boolean not null default true`

Add to `schedule_blocks`:
- `ai_explanation text` — natural-language rationale (separate from the existing formulaic `placement_reason`)

No new tables, no RLS changes needed (existing policies cover all columns).

### B. AI chat editor for the master schedule (headline feature)

**Packages to install:** `ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/react`, `react-markdown`, plus the AI Elements components `conversation message prompt-input shimmer tool` via `bunx ai-elements@latest add ...`.

**New edge function `schedule-chat`** (`verify_jwt=false`, manual JWT auth, CORS):
- Body: `{ generation_id, messages: UIMessage[] }`.
- Loads `schedule_blocks`, `specialists`, `teachers`, `schools` row, and `recess_lunch_config`.
- Uses `streamText` from the AI SDK against Lovable AI Gateway (`google/gemini-3-flash-preview`) via the shared provider helper in `supabase/functions/_shared/ai-gateway.ts` (create it if missing — pattern from `ai-sdk-lovable-gateway`).
- System prompt: the model is an editor of an existing K-6 specials schedule; explain the school context (grades, specialists, lunch bands, rotation strategy) and the constraint summary; instruct it to call tools rather than answer freely when changes are needed.
- Tools (Zod schemas, `execute` writes to `schedule_blocks` and returns the updated block or an error reason):
  - `list_blocks({ filter?: { grade?, specialist?, day? } })` — read-only, returns trimmed block list.
  - `move_block({ block_id, day, start_time })` — validates occupancy via shared helpers reused from `_scoring.ts` and the generator's `OccupancyTracker`; rejects with reason on conflict.
  - `swap_blocks({ block_a_id, block_b_id })`.
  - `replace_block({ block_id, new_specialist_id?, new_teacher_id?, new_subject? })`.
  - `delete_block({ block_id })`.
  - `insert_block({ day, start_time, end_time, subject, specialist_id, teacher_id?, grade, room? })`.
  - `bulk_replan({ instruction, scope: { specialist_ids?, grade?, day? } })` — chains into the existing `replan-subgraph` function for compound rewrites.
- `stopWhen: stepCountIs(50)`.
- `onFinish`: persists the completed `UIMessage[]` to `schedule_generations.chat_history`.
- Returns `toUIMessageStreamResponse({ originalMessages, onFinish })` with CORS headers.

**New side panel `<ScheduleChatPanel>` in `MasterSchedulePage.tsx`:**
- Uses `useChat` from `@ai-sdk/react` with `DefaultChatTransport` pointing at the function URL, `id = generation_id`, `messages` hydrated from `chat_history` on mount.
- AI Elements composition per `chat-ui-composition`: `Conversation` + `Message` + `MessageResponse` (markdown) + collapsed `Tool` cards for each tool call/result + `PromptInput` with `PromptInputTextarea` and `PromptInputSubmit` in `PromptInputFooter` (right-aligned). Shimmer for `status === 'submitted' | 'streaming'`. No `Sparkles` as the brand mark — use the existing app accent color in a small `BrainCircuit` chip.
- Quick-prompt chips above the composer: "Move 3rd grade music to Tuesday morning", "Give Ms. Lee a longer Friday prep", "Even out specialist workload across days".
- Subscribes to `schedule_blocks` realtime for the active generation; on tool-result re-runs `loadBlocks(generation_id)` so the grid reflects edits instantly.
- Trigger button on the master schedule toolbar: `Edit with AI` (chat icon). Panel slides in from the right (40 vw, collapsible).

### C. Accept / Reject gate

In `MasterSchedulePage.tsx`, when `activeGen.review_state === 'pending'`:
- Sticky top bar above the grid: "Review this schedule" with three actions:
  - **Accept** — sets `review_state='accepted'`, persists, dismisses bar.
  - **Edit with AI** — opens the chat panel from B and keeps state `pending`.
  - **Regenerate** — calls existing `generate-schedule` flow.
- Drag/drop and manual edits stay enabled in both states; bar is purely advisory + a clean point to lock the schedule for exports.
- Export buttons become "available now" but show a subtle hint when the schedule is still `pending`.

### D. Per-block AI explanations

Extend `generate-schedule/index.ts`:
- After block placement, when `school.ai_explanations_enabled`, batch the full block set into one Lovable AI call (`google/gemini-3-flash-preview`) with `Output.object({ schema: z.object({ explanations: z.record(z.string()) }) })` keyed by block id. Compact context: each block as `id|day|time|grade|specialist|subject`, plus a one-paragraph constraint summary.
- Store result on `schedule_blocks.ai_explanation` in a single bulk update.
- Failure is non-fatal — fall back to the existing `placement_reason`.
- In `MasterSchedulePage.tsx` edit drawer (line ~991), prefer `ai_explanation` and fall back to `placement_reason`.

### E. Wizard parameters wiring + lunch/recess collapse

**Wizard params (already on `schools`):**
- Extend `contractFeasibility.ts` with a check that fires when `keep_grades_together` is on and a grade's required minutes can't fit in a single day → renders in the existing PrepPage preflight card.
- In the warnings panel, when `extra_plt_below_target` appears, render an "Add suggested PLT block" button that calls `replan-subgraph` with scope `{ specialist_ids: [specialistId] }`.

**Lunch / recess UX (`StepRecessLunch.tsx`):**
- Rework from per-grade rows into period-grouped cards: `Early Lunch`, `Late Lunch`, `Recess` — each with one editable label, one start/end pair, and a chip multi-select of grades. Summary line under each card: `Early Lunch · 11:15 AM–11:45 AM · Grades K, 1, 2`.
- Same period label used in the `MasterSchedulePage` grid cells (drop per-grade duplicate text).

### F. Wizard UX rework (modern + AI-assisted)

**Layout pass across all 11 steps:**
- New shared `<WizardStepShell>` component: two-column layout — left rail with the step title, a short rationale paragraph, and inline tips; right column is the form. Drop redundant section headers and tighten spacing using existing brand tokens (`#1B2A4A`, `#C5A55A`).
- Replace top progress bar with a persistent left rail in `SetupWizardContent.tsx`: vertical list of steps with status icons (`done` / `active` / `needs-attention` driven by the same checklist that the Review step uses). Clicking a completed step navigates to it.

**AI helpers (existing functions, surfaced more clearly + one new function):**
- `StepSchoolInfo`: "Paste your school calendar URL or PDF → AI fills bell schedule, start/end dates, holidays" — wires the existing `parse-calendar` function with a more prominent CTA.
- `StepTeachers` / `StepSpecialists`: surface the existing `process-onboarding-template` (Excel import) as the primary action of the step, not a secondary link.
- `StepConflict`: "Recommend strategy" button runs the existing `analyzeFeasibility` and pre-populates `conflictStrategies` in order.
- `StepClubs` / `StepEvents`: free-text "Describe your clubs/events in plain English" box → **new edge function `parse-clubs-nl`** (one-shot `generateText` with `Output.object`, returns structured rows) that the user then edits inline.
- `StepContractualMinutes`: already AI-powered; just elevate visually inside the new shell.

**Review step:**
- "Schedule Readiness" score (weighted sum of preflight warnings) and a single CTA: Generate Schedule.

### G. Build & verify

- `bun add` the new packages, run `bunx ai-elements@latest add ...` and confirm components installed.
- After each major piece, hit the function locally via `supabase--curl_edge_functions` to confirm 200 + correct streaming shape, then exercise it from the UI in the preview.
- Smoke tests:
  - `supabase/functions/schedule-chat/_smoke_test.ts` — CORS, 401, one tool round-trip with a stubbed AI Gateway fetch.
  - `supabase/functions/parse-clubs-nl/_smoke_test.ts` — same shape.

### Suggested order (single ticket each, runs back-to-back)

1. Schema migration (A).
2. Install AI SDK + AI Elements packages.
3. `schedule-chat` edge function (B backend).
4. `<ScheduleChatPanel>` + toolbar button (B frontend).
5. Accept/Reject bar (C).
6. AI explanations in generator + edit drawer (D).
7. PLT/keep-together feasibility + button (E1).
8. Lunch/recess rework (E2).
9. Wizard shell + left rail (F1).
10. Per-step AI helpers + `parse-clubs-nl` (F2).
11. Review step readiness score (F3).
12. Final QA pass + smoke tests (G).

### Technical notes
- All AI calls go through Lovable AI Gateway with the shared provider helper. No new API keys; `LOVABLE_API_KEY` already exists.
- Chat history is one conversation per generation (matches `chat-agent-ui-contract` "one conversation + database" shape — no thread sidebar).
- Tool executions write directly to `schedule_blocks` with the same constraint helpers used by the generator. Rejected edits return a structured error that the model surfaces back to the user.
- Realtime updates use the existing Supabase realtime channel on `schedule_blocks` filtered by `generation_id`.
- No new storage buckets. No connector changes.

### Out of scope (still)
- Billing/Stripe.
- Parent-facing exports.
- Lesson planner content generation.