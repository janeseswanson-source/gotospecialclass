## Goal

Make the "Edit with AI" panel respond reliably, and make AI-applied changes obvious in the Master Grid with a colored glow + animation on the changed blocks.

## What's actually wrong

1. **Chat not responding.** Every Claude call in the project is pinned to `CLAUDE_MODEL = "claude-opus-4-8"` (in `supabase/functions/_shared/anthropic.ts`). That model id does not exist in the Anthropic API — the streaming `schedule-chat` request rejects before producing tokens, so the panel just hangs / errors silently. Recent `schedule-chat` logs are empty, consistent with the stream failing fast.

2. **Highlight is too subtle.** The plumbing already works end‑to‑end: `apply-schedule-edits` returns `changed_block_ids`, `ScheduleChatPanel` forwards them via `onApplied`, `MasterSchedulePage` puts them in `recentChangedIds`, `ScheduleGrid` passes `isHighlighted` to `ScheduleBlockCell`, and the cell applies `animate-pulse-once`. But `animate-pulse-once` is only an opacity dip (`0% 100% opacity 1, 50% 0.55`) and `ring-sky-500/70` — there's no glow, no color shift, and it disappears after ~3 seconds while the flag stays for 12s.

## Plan

### 1. Use a real Claude model (fixes "not responding")

In `supabase/functions/_shared/anthropic.ts`:

- Change `CLAUDE_MODEL` from `"claude-opus-4-8"` to a currently-available Anthropic model id. Recommended: `"claude-opus-4-5"` (latest Opus; what the user means by "Opus 4.x"). If that 404s in this account, fall back to `"claude-sonnet-4-5"`.
- No other code changes needed — every function reads `CLAUDE_MODEL` from this file.

Then redeploy `schedule-chat`, `apply-schedule-edits`, `explain-schedule`, `verify-schedule`, `resolve-conflicts-ai`, `parse-*`, `calendar-search` so they pick up the new id, and curl `schedule-chat` with a trivial message to confirm a token stream comes back.

### 2. Stronger "just changed" visual on the grid

In `src/index.css`:

- Replace `.animate-pulse-once` and its keyframes with a longer, more visible **glow + color-wash** animation, e.g. `animate-ai-changed` running ~2.5s × 3 (total ~7.5s, matching the 12s flag with a comfortable tail):
  - Animates a colored ring (`hsl(var(--primary))` or a dedicated `--ai-change` token) AND a soft outer box-shadow glow that pulses from strong → soft.
  - Adds a brief background tint wash (e.g. `bg-primary/15` → transparent) so the block visibly "lights up", not just outlines.

In `src/components/schedule/ScheduleBlockCell.tsx`:

- Swap the `isHighlighted` class set from `ring-2 ring-sky-500/70 shadow-[…] animate-pulse-once` to the new `animate-ai-changed` utility plus a persistent thin colored ring while highlighted (so even between pulses the block reads as "just changed").
- Make sure it doesn't fight the `isSelected` style — `isHighlighted` should win visually while active.

In `src/pages/schedule/MasterSchedulePage.tsx`:

- Align the clear timer (`12_000` ms) with the animation length so highlight + animation end together (use ~8s, or keep 12s but ensure the animation loops/holds the colored ring for the full duration via `animation-fill-mode: both`).
- After `flagChangedBlocks`, also auto-scroll the grid to the first changed block id (smooth) and show a small toast: "Highlighted N change(s) in the grid." so the user knows where to look.

### 3. Verify

- Open the AI editor, send "Move 3rd grade music to Tuesday morning", confirm a streamed reply arrives and a proposal card appears.
- Click Apply → confirm the targeted block(s) in the Master Grid glow with the new color + animation for the full duration, on both the All Grades view and the per-grade view.
- Check `schedule-chat` logs for clean `onFinish` (no stream errors), and `apply-schedule-edits` returns `changed_block_ids`.

## Out of scope

- Reworking the chat panel layout, tool list, or proposal cards.
- Persistence model / chat history changes.
- Other AI surfaces' prompts.
