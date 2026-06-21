## Plan

### 1) Make “Edit with AI” visibly respond again
- Fix the chat submit wiring so the AI SDK receives the actual typed text from the controlled textarea.
- Add client-side diagnostics for the request lifecycle: clear inline error if the function returns an error, and a fallback assistant message if the stream ends empty.
- Pass the real `status` and `onStop={stop}` to the chat submit button, and update the vendored submit button so it shows a stop icon during both “submitted” and “streaming” states instead of hiding cancel behind a spinner.
- Deploy and test the `schedule-chat` edge function after code changes.

### 2) Keep optimizer score high and show it as a meaningful percentage
- Add a normalized optimizer quality calculation that converts the raw `winning_score` / `score_breakdown` into a 0–100% “Optimizer score”.
- Update Schedule Insights to display the percentage prominently, with the raw score available as secondary detail.
- Strengthen generation quality by increasing the optimizer search budget:
  - more Monte Carlo attempts per strategy,
  - a longer simulated annealing pass,
  - stronger penalties for subject gaps, repeated same-subject same-day clustering, K/TK late-day blocks, and class repeats.
- Keep hard constraints dominant so the optimizer never chases a high score by creating double-bookings or invalid placements.

### 3) Clean up the master grid UI
- Redesign schedule blocks to be denser and easier to scan:
  - bigger subject text,
  - grade/time as compact chips,
  - hide secondary details like teacher/specialist/room behind hover/title or a subtle second line,
  - reduce block min-height and row padding.
- Tighten the table spacing and dividers so the grid reads like an operations board instead of oversized cards.
- Preserve drag/drop, lock, notes, conflict rings, A/B labels, and “AI changed” glow behavior.
- Keep the visual direction aligned with the existing navy/gold binder-tab brand, using semantic theme tokens instead of hardcoded component colors where practical.

### 4) Merge the take-in template into the setup wizard
- Keep the template upload capability, but remove it as a competing standalone path.
- Add/keep the upload entry point inside the setup wizard flow so users have one canonical setup path.
- Update navigation/copy/buttons that point to the old take-in route so they direct users into the wizard step instead.
- Do not delete the parsing backend unless it becomes unused; the wizard should reuse it.

### 5) Verify
- Check that typing a message in Edit with AI shows the user message, calls `schedule-chat`, and renders an assistant response or readable error.
- Confirm proposed AI edits still produce the Apply bar and changed blocks glow in the grid after apply.
- Generate/inspect a schedule and confirm Schedule Insights shows a percentage score and raw score detail.
- Check the master grid at the current viewport for compact, readable block layout with no overlap.
- Confirm setup has one clear template-upload path inside the wizard.