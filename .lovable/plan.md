
## Goals
Tackle six related issues in one pass:

1. Recess & Lunch step is cramped and clipped horizontally.
2. AB-week generation often makes both weeks look identical / nonsensical.
3. quick_30 (and other strategy-driven durations) aren't actually applied to block lengths.
4. "Edit with AI" panel appears broken: closes on send, no replies, no visible change.
5. Schedule grid drag-and-drop needs to be obviously functional + allow swap.
6. Left-rail "Why this step" tips dominate the screen.

Out of scope: schema changes, new wizard steps, billing, exports, or AI-chatbot history persistence beyond what's already wired.

---

## 1. Recess & Lunch UI rework (`StepRecessLunch.tsx`, `PeriodCard.tsx`)

Problem: the three period columns (AM Recess / Lunch / PM Recess) plus the always-shown early-release block create a row that overflows the viewport. Time inputs are clipped on the right; the wizard's left rail eats ~260px and there's only ~700px left for the cards.

Fixes:
- Switch the period grid from `grid-cols-3` to a responsive layout: `flex flex-col gap-4` on small screens, `xl:grid-cols-3` only when there's room; on `lg` it stacks 2+1.
- Inside each `PeriodCard`:
  - Move the time pickers onto their own row below the label input instead of sharing the row. New row: `[start] → [end]    [trash]`. Use `min-w-0` and `flex-1` so the times never clip.
  - Tighten grade chips: render in a compact wrap with `gap-1`, smaller chip padding, and an "All / None" quick-toggle.
  - Hide the dashed "Early-release" subsection by default and only render it if `showEarlyRelease` AND this row was opened via a per-card "Add ER override" toggle.
- Collapse the global Early-Release section behind a `Collapsible` (already imported) and default it closed.
- Remove the horizontal overflow on the step container; ensure `min-w-0` propagates from `WizardStepShell`'s right column down through the cards.

Acceptance:
- At 1024px wide, all three cards are visible without horizontal scroll OR they stack vertically with no clipped controls.
- No control is cut off at 1280px.
- Existing autosave + bandKey persistence keeps working unchanged.

---

## 2. AB-week / AA-BB-week correctness (`supabase/functions/generate-schedule/index.ts`)

Symptom: A and B weeks look the same. Reading `generateABWeek` (lines 1060–1145):
- The split `groupA / groupB` only includes *conflict* grades. If conflict-grades is empty (the typical case before the user marks any), both weeks get the same non-conflict assignments and nothing differentiating, so Week A ≡ Week B.
- Even when there are conflict grades, the same `rotation` offset and the same teacher order is used for both, so the only difference is which subset of conflict grades plays — same time slot, same specialist.

Fixes:
- If `conflictGT.length === 0`, fall back to splitting *all* grades roughly in half so the two weeks aren't identical; record a `preferenceViolation` explaining the implicit split.
- Use a different rotation offset (and a different shuffle seed via `deriveSeed(rng, "weekB")`) for the Week-B pass so identical inputs still produce a distinguishable schedule.
- Tag every block with its `week_label` ("A" / "B"); ensure non-conflict blocks remain `week_label: null` (shared across both weeks) — that part is already correct.
- Mirror the same fix in `generateAABBWeek`.
- Add a post-generation sanity check: if `blocks.filter(week_label === "A")` and `B` produce identical `{day,start,grade,specialist}` tuples, downgrade chosen strategy to `standard` and record `fallbackReason: "A/B weeks were indistinguishable"`.

Acceptance:
- AB-week generations have at least N distinct A-only and B-only blocks where N >= number of conflict grades (or floor(grades/2) if none).
- Toggling the week filter in the master schedule shows genuinely different layouts.

---

## 3. Strategy-driven class durations (quick_30 + general)

Symptom: choosing quick_30 still renders 45-minute blocks. Reading `generateQuick30` (line 1244+): the duration callback is `(grade) => conflictSet.has(grade) ? 30 : classDuration`. So:
- If the user never tagged grades as "conflict", quick_30 falls through to default 45 for everyone.
- The strategy *name* is stored on `schedule_generations.chosen_strategy`, but `schedule_blocks.end_time` was set from `classDuration` already.

Fixes (in scope, no schema change):
- For `quick_30`, when `conflictGrades.length === 0`, apply the 30-minute duration to **all** grades (the whole point of the strategy is "use 30 to fit everyone").
- Store the effective duration applied (per grade) on `schedule_blocks.placement_reason` so the UI can display the explanation already.
- Add a guard in the master schedule load: if `chosen_strategy === "quick_30"` and any block is > 30 min for a grade flagged as conflict, surface a `ScheduleWarning` ("Strategy expected 30-min blocks but found 45-min").
- Audit `generateBigGroup`, `generateExtraRotation`, `generateABWeek` callsites to confirm their `classDuration` callbacks honour the strategy — currently they all pass `() => classDuration`. Add a `strategyDurationFor(strategy, grade, baseDuration, conflictSet)` helper and route every call through it.

Acceptance:
- Picking quick_30 in the wizard and regenerating produces 30-min blocks across the board (with conflict grades still 30).
- Generated schedule's block durations match the strategy displayed in the header.

---

## 4. Fix "Edit with AI" chat (`ScheduleChatPanel.tsx`, `MasterSchedulePage.tsx`, `schedule-chat/index.ts`)

Symptoms reported: chatbox closes on send, no reply, no visible change.

Suspected causes from current code:
- `ScheduleChatPanel`'s form `onSubmit` calls `handleSubmit`, which calls `sendMessage`. But `PromptInput`'s `onSubmit` *also* fires, double-submitting. The outer form is wrapping `PromptInput` and submitting via Enter triggers both → second submit with empty input throws → toast → state churn.
- The panel is mounted inline in `MasterSchedulePage`; if any parent re-render unmounts it (e.g. `loadBlocks` after `onScheduleChanged`) the chat resets and looks "closed".
- The transport URL uses `VITE_SUPABASE_URL` which exists, but the chat endpoint requires `verify_jwt`; if session is missing the function returns 401 silently.

Fixes:
- Remove the outer `<form onSubmit>` and rely solely on `PromptInput`'s `onSubmit`. Move the submit handler into `PromptInput`'s `onSubmit` prop and drop `handleSubmit(e)` form glue.
- Keep the panel mounted across `onScheduleChanged` by lifting `chatOpen` and the panel out of any conditional unmount; only refetch *blocks* in `onScheduleChanged`, never re-key the panel. Add `key={generationId}` so it only resets when the user picks a different generation.
- Add explicit error surfacing: on `error` from `useChat`, render the message in the conversation as an assistant error bubble (not just a toast) so the user sees something.
- After each `onFinish`, also flash a small "Schedule updated — X changes" banner inside the panel, sourced from tool-call counts in the last assistant message.
- Verify token: in `transport.headers`, if `data.session?.access_token` is missing, throw a friendly "Sign in again" instead of sending an empty Bearer.
- Make the panel persistent (not gated on a button): add a floating "AI" FAB on `MasterSchedulePage` that toggles the panel open/closed; remove the requirement to click "Edit with AI" first. The panel reads the current `selectedGen` and stays usable even with no generation (it just disables sending and shows "Generate a schedule first").
- In the server (`schedule-chat/index.ts`), keep persistence in `onFinish`. No changes needed there beyond confirming `toUIMessageStreamResponse` is returned with the same CORS headers (already done).

Acceptance:
- Sending a message keeps the panel open, streams an assistant reply, and renders any tool calls with their input/output collapsed by default.
- Tool-driven block changes refresh the visible grid without unmounting the chat.
- Closing and reopening the panel restores chat history (already persisted to `chat_history`).

---

## 5. Drag-and-drop polish (`ScheduleGrid.tsx`, `MasterSchedulePage.tsx`)

Drag/drop already exists via native HTML5 DnD; the user thinks it's missing. Add discoverability + a real swap:

- Add a `cursor-grab` / `active:cursor-grabbing` style on draggable cells and a subtle hover ring labeled "Drag to move".
- When dropping onto a cell that's already occupied by another block of the *same grade*, perform a swap (both blocks move to each other's slot) instead of failing. Implemented in `handleBlockDrop` by detecting the existing block at the target slot and issuing a paired update inside a single `pushHistory` snapshot.
- Show a one-time tooltip on the first grid render: "Drag any block to a new slot — drop on an empty cell to move, or onto another block to swap."
- Keep `computeAutoFit` behavior for empty drops.

Out of scope: full dnd-kit migration.

---

## 6. Shrink the wizard rationale rail (`WizardStepShell.tsx`)

Currently the rail is `260px` and always visible, sapping ~30% of width at 1024px.

Fix:
- Default the rail to a collapsed 40px strip with just the lightbulb icon and a chevron; clicking expands it inline to ~240px with the rationale.
- Persist collapsed/expanded state in `localStorage` under `wizard.rail.collapsed`.
- At `<lg` widths, render the rail as a small "Why this step?" pill above the content that opens a `Popover` instead of taking column width.

Acceptance:
- Recess & Lunch step at 1024px gives the period cards the full content column when the rail is collapsed.
- User can re-open the rail at any time; preference sticks across reloads.

---

## Files

Edit:
- `src/pages/setup/steps/StepRecessLunch.tsx`
- `src/pages/setup/steps/recessLunch/PeriodCard.tsx`
- `src/components/setup/WizardStepShell.tsx`
- `src/components/schedule/ScheduleChatPanel.tsx`
- `src/pages/schedule/MasterSchedulePage.tsx`
- `src/components/schedule/ScheduleGrid.tsx`
- `src/components/schedule/ScheduleBlockCell.tsx` (cursor styles only)
- `supabase/functions/generate-schedule/index.ts`

No new files, no migrations.

## Risks
- Touching `generate-schedule` could disturb Monte-Carlo scoring; mitigate by guarding new branches behind explicit empty-conflict-grade checks and adding a unit-test-style assertion via the existing `_scoring_test.ts` pattern in a follow-up if needed.
- Removing the outer chat `<form>` changes Enter-to-send wiring; verify Shift+Enter still inserts newline (PromptInput handles this).

