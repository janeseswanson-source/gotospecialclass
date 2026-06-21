## 1. Schedule generation: stop hitting "CPU Time exceeded"

The logs show 7 HQ attempts at ~700ms wall each, then CPU exceeded mid-attempt-7 — before save. Wall-clock gating isn't enough; CPU accumulates faster than wall time.

**Fix in `supabase/functions/generate-schedule/index.ts`:**
- Lower `MAX_ATTEMPTS` from 20 → **6** (logs show CPU budget bursts around attempt 7).
- Add a **CPU-aware early break**: track cumulative attempt time; if `cumulativeAttemptMs > 3500` AND we already have a result with quality ≥ 90, break.
- Wrap the **entire save + verify path** in `try/catch`; if save partially fails, persist `best_blocks` first, skip the `verify-schedule` HTTP call when remaining wall budget < 15s.
- Use `EdgeRuntime.waitUntil(...)` for the optional `verify-schedule` call so it never blocks the response.
- Always return a 200 with the best-of-N result; never let the loop kill the request.

Target: schedules of 89–95% reliably; 99% only when it converges naturally within budget. Honest expectation-setting beats "always 99%" claims that crash.

## 2. AI Edit chat: still silent

Even with `apikey` header added last turn, user reports no AI reply. Plan:
- Inspect `supabase/functions/schedule-chat/index.ts` to confirm it actually streams (`toUIMessageStreamResponse`) and isn't throwing before first chunk.
- Check recent `schedule-chat` edge logs for 4xx / 5xx after the user's last message.
- If logs show 401: function is mis-configured for `verify_jwt` — set it to `false` in `supabase/config.toml` and validate JWT in code (matches the Edge Function guidance).
- If logs show 500: capture exact error and patch.
- Add a visible status line in the chat panel header showing fetch state for the user.

## 3. Master grid block: redesign to match reference

Update `src/components/schedule/ScheduleBlockCell.tsx` and the way the grid groups multi-rotation cells:

**New block layout (top-down, dense):**
```
[Grade chip] Start–End time
Subject · Teacher
Subject · Teacher
Subject · Teacher
```

- Always-visible time at top (not hover-only).
- One row per rotation, format: `Subject · Teacher`.
- **Dedupe repeated teacher/subject pairs** across rotations within the same cell.
- Tighten font (text-[11px] for subject, text-[10px] for rotations).
- Remove the height-scales-with-duration logic — fixed compact rows like the reference.

Group multi-rotation blocks in `ScheduleGrid.tsx` into a **single stacked cell** instead of A/B side-by-side. The grade chip applies to the cell; each rotation line shows its own subject + teacher.

## 4. XLSX export: match reference layout, keep brand

Rewrite `src/lib/exportScheduleXlsx.ts` Master Schedule sheet cell rendering:

- One cell per `(day, time)` containing **stacked rotation rows**:
  - Top line: small grade chip (e.g. `1st`) bold, gold/navy.
  - Then `Subject` (8pt) + `Teacher` (8pt) per rotation, one per line.
- Dedupe repeats; collapse identical rotations.
- Keep brand palette (navy header, cream time column, gold rules, subject-tinted fills).
- Add full-width band rows for Recess / Lunch / Early Dismissal (already partly present) — make them visually match the screenshot's grey bands.
- "Planning and Prep" section header band at the very top across all days.

## Technical notes

- HQ loop: track `attemptCpuBudgetMs = 3500`; combined wall budget stays at 90s soft.
- Chat panel: add a `[chat] status` debug line surfaced only when `import.meta.env.DEV` is true so we can ship verbose logs without UI noise.
- Block dedupe: hash by `${subject}|${teacher_id}`; keep first occurrence, drop duplicates within the same `(day, start_time)` cell.
- XLSX: continue using ExcelJS rich-text per cell; grade chip = small `richText` run with gold fill via a leading character + space (Excel can't truly inline chips, so render as bold colored text prefix like `1st  Art  Teacher 1`).

## Out of scope
- Per-strategy generator tuning (Monte Carlo iteration counts stay).
- Take-in template wizard merge (already shipped).
- Optimizer score visualization (already shipped).
