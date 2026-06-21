## Goal
Stop the "CPU Time exceeded" error from killing a generation run, push toward 20 attempts, and always persist the highest-scoring schedule seen so far.

## Root cause
Logs show 8 HQ attempts completed (~5s elapsed) and then `CPU Time exceeded` hit during the post-generation phase (DB writes + verify-schedule call) before anything was saved. The outer HQ loop currently:
- caps at `MAX_ATTEMPTS = 8` and `TOTAL_BUDGET_MS = 240_000`
- uses *wall clock* only, but Supabase edge functions have a separate CPU-time ceiling — so the loop happily keeps burning CPU and leaves no headroom for the save/verify phase that runs afterwards.
- has no top-level try/catch, so when CPU is exhausted mid-save the partial best is lost.

## Plan (edits in `supabase/functions/generate-schedule/index.ts`)

1. **Raise attempt ceiling, but gate by remaining budget**
   - `MAX_ATTEMPTS = 20`
   - Track `tStartHQ = performance.now()`. Before each attempt, estimate per-attempt cost from the slowest attempt so far (`maxAttemptMs`) and only start the next attempt if `elapsed + maxAttemptMs * 1.3 < HQ_SOFT_BUDGET_MS`.
   - `HQ_SOFT_BUDGET_MS ≈ 120_000` so we always leave a hard reserve (`POST_RESERVE_MS ≈ 60_000`) for DB inserts + verify-schedule.
   - Early-exit as soon as `bestQuality >= TARGET_QUALITY (99)`.

2. **Always keep the best result across all attempts**
   - Current code already replaces `schedulerResult` only when `q > bestQuality` — keep that.
   - Also track `bestQuality`, `bestAttemptIndex`, and `attemptsRun` to log/report and to include in the success payload (so the UI can show "best of N attempts").

3. **Survive a per-attempt failure**
   - Already wraps each attempt in try/catch. Add the same protection around the initial attempt 0 — if it throws, fall back to a single deterministic attempt with `attempt=0` and `monteCarlo` disabled-style minimal seed so we always have *some* schedulerResult.

4. **Survive CPU/time exhaustion during the loop**
   - Wrap the entire HQ loop body in try/catch. If a `CPU Time exceeded`–style error bubbles up, log it and break out keeping `schedulerResult = best so far`, then continue to the save/verify path.
   - Before each iteration also check a hard wall-clock cap (`HQ_HARD_BUDGET_MS`) and break instead of starting another attempt.

5. **Reserve headroom for save + verify**
   - After the loop, log remaining budget. If `< POST_RESERVE_MS` remaining, skip the optional `verify-schedule` HTTP call and just persist the best blocks + breakdown so the user still gets the schedule rather than a thrown error.

6. **Keep the score rubric unchanged**
   - `qualityPct()` (100 − Σ|soft penalties|/4) already matches the verifier and `optimizerScore.ts`. No score-math changes — just more attempts and safer best-tracking.

## Acceptance
- Generation no longer surfaces "Schedule generation had an issue" toast when the CPU ceiling is approached; the best schedule of N attempts is saved.
- Logs show `[HQ] attempt k → quality X%` up to 20 times (or until 99% reached) and `[HQ] best Y% after k attempts, saving...`.
- Schedule Insights displays the highest score achieved across the run.

## Out of scope
- Per-strategy generator tuning (Monte Carlo / SA budgets stay as currently configured).
- Chat panel work — already in progress in a previous turn.
