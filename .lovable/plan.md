## Two bugs

### 1. AI chat returns nothing in the chatbox

Looking at recent `explain-schedule` logs we see `Http: connection closed before message completed` — Anthropic was tearing the stream down. The previous model id (`claude-opus-4-8`) doesn't exist on Anthropic; I already fixed it to `claude-opus-4-5` (verified live: it returns a real response), but **`schedule-chat`'s `streamText` call never passes `maxOutputTokens`**, and the `@ai-sdk/anthropic` v2 provider does not always inject a default. When it doesn't, Anthropic's API rejects the request (it requires `max_tokens`), the stream closes immediately, and the chatbox stays empty — there's nothing for `useChat` to render.

We also swallow stream errors silently: `result.toUIMessageStreamResponse(...)` has no `onError` mapper, so anything thrown inside the stream (provider 4xx, tool error, JSON issue) is sent as a generic abort with no message in `useChat`'s `error`.

### 2. Drag-swap toasts "Swapped ✓" but the grid doesn't visibly change

`handleBlockDrop` calls `setBlocks(candidate)` synchronously and then writes both rows in parallel. The state shape is right, so the grid *should* re-render. The likely culprit is one of:

- The `useEffect` at line 186 reloads from DB whenever `specialists`/`teachers` array references change. If anything triggers a `setSpecialists`/`setTeachers` re-set after the swap (parent context, a refetch, etc.) the in-flight optimistic state gets overwritten by a stale DB read fired before the swap UPDATEs commit.
- A swap between two cells in the same row (same time, different day) does shift positions, but with no visual feedback the user reads it as "nothing happened".
- The swap touches blocks that aren't in the currently-visible grade/week filter, so the user looking at one tab doesn't see them move.

I want to confirm via Playwright, but the fix is the same regardless: make the swap visibly obvious *and* defend the state update.

## Plan

### A. `supabase/functions/schedule-chat/index.ts`

1. Pass `maxOutputTokens: 4096` (and `temperature: 0.2`) to `streamText` so Anthropic accepts the request.
2. Add `onError` to `toUIMessageStreamResponse` that returns a readable message (`err?.message ?? "Chat failed"`) so transport errors actually surface in the panel.
3. Also wrap the initial `streamText(...)` in a try/catch that JSON-returns the provider's error message instead of dropping the connection.

Apply the same `maxOutputTokens` to `explain-schedule` (also uses `streamText`).

### B. `src/components/schedule/ScheduleChatPanel.tsx`

1. When `error` is set, show the actual `error.message` (already wired) — once the server propagates it, the user will know what went wrong instead of seeing an empty bubble.
2. If the stream returns no text and no proposals, render a one-line fallback ("No response — please try again or rephrase.") so the user isn't staring at a blank conversation.

### C. Drag-swap visual feedback in `src/pages/schedule/MasterSchedulePage.tsx`

1. **Reuse the AI-changed glow for manual swaps.** After a successful `handleBlockDrop` swap or move, call `flagChangedBlocks([blockId, targetBlock?.id].filter(Boolean))`. This already triggers the new sky-blue glow + auto-scroll-to-block, so the user immediately sees both swapped blocks light up.
2. **Defend against stale reload overwriting optimistic state.** Replace the broad `useEffect([selectedGen, specialists, teachers])` reload with one that only runs when `selectedGen` changes, plus an explicit one-shot remap when `specialists`/`teachers` arrive for the first time. This stops a context-driven `setSpecialists` from clobbering `setBlocks(candidate)` mid-swap.
3. After the parallel `await Promise.all([... update ...])`, re-derive `mapBlocks` on the candidate so the row carries forward the latest `specialist_name`/`teacher_name` (defensive — current spread already keeps them, but this guards against future schema drift).

### D. Verify

- Reload the Master Schedule, open the AI editor, send "hi" — should get a streamed reply. Then try "Move 3rd grade music to Tuesday morning" → Apply → blocks glow blue.
- Drag a block onto another block → both blocks glow blue in place after the toast, and the grid reflects the new positions on both All-Grades and per-grade views without a manual reload.
- Open Playwright against `localhost:8080` to confirm both end-to-end (screenshot the grid before/after the swap and after sending a chat message).
