## Plan

### 1) Fix “Edit with AI” so every send shows activity
- Make the chat input submit path impossible to silently no-op:
  - pass the actual typed text from `PromptInput` into `sendMessage`
  - show the user message immediately
  - show a visible “Thinking…” state as soon as the request starts
- Add explicit request diagnostics in the panel:
  - if the backend is not called, show a readable inline error
  - if the stream returns empty, add a fallback assistant message explaining what failed
  - if the backend returns JSON/non-stream errors, parse and display the message instead of leaving the chat blank
- Confirm the deployed `schedule-chat` endpoint is actually receiving calls; current logs show no recent `schedule-chat` requests, so the client submit/request path is the first target.

### 2) Make `schedule-chat` more reliable
- Keep the existing AI editor tools, but harden the streaming response:
  - return AI-SDK-compatible stream errors
  - persist chat history only after a valid finished stream
  - surface missing key/provider/function errors as visible assistant text
- Redeploy `schedule-chat` and test it directly after changes.

### 3) Add “highest quality” generation mode targeting 99–100%
- Change generation from “run once and take best” to “keep searching for a target quality”:
  - target quality: 99%
  - max effort: much longer than current limits, since you said waiting longer is acceptable
  - stop early only when the schedule reaches target quality and has no hard errors
  - otherwise save the best schedule found and clearly label if it could not reach 99% because of impossible constraints
- Increase optimizer effort beyond the current settings:
  - larger Monte Carlo candidate pool
  - longer simulated annealing pass
  - multiple deterministic retry waves with different seeds
  - compare all candidate strategies by final quality, not just first error-free strategy

### 4) Make the score meaningful and aligned
- Replace the current misleading optimizer percent calculation that can show 49% even when AI Quality is 89/100.
- Use one shared quality calculation based on the score breakdown penalties, matching the verifier’s rubric.
- Show:
  - `AI Quality: 99/100` when verification is available
  - `Optimizer target: 99%` / `Best found: X%`
  - raw score only as secondary detail

### 5) Verification
- Test chat from the UI: type a message, confirm user bubble, thinking state, backend request, assistant response/tool proposal.
- Test direct backend chat call if UI still fails.
- Generate a schedule and confirm the generation takes longer, records more attempts, and targets 99–100%.
- Confirm Schedule Insights no longer shows contradictory quality percentages.