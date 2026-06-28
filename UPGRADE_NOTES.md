# Scheduler Upgrade Notes

Living document for the surgical scheduler upgrade. Records the pipeline as it
actually works today, the invariants we must not break, and what each phase
changes. Updated as the pipeline evolves.

---

## 1. Current pipeline (as of Phase 0 start) — generate → score → refine

The whole solver lives in one ~3,115-line module:
`supabase/functions/generate-schedule/index.ts`. The request path is:

```
POST /generate-schedule (serve handler, ~line 2670)
  ├─ auth + load school/specialists/teachers/recess/clubs/events/calendar/weights
  ├─ insert a new schedule_generations row (version N+1, status "complete")
  ├─ load locked blocks (for replan) and generate admin/PLC blocks
  ├─ HIGH-QUALITY best-of-N loop (inline, synchronous):
  │     for attempt in 0..MAX_ATTEMPTS(=2), while bestQuality < TARGET(99):
  │         candidate = generateScheduleBlocks(..., seedSalt = attempt)
  │         quality   = qualityPercent(candidate.scoreBreakdown)   // public rubric
  │         keep best; break early on CPU_BUDGET_MS(=1200ms wall clock)
  ├─ persist best candidate's blocks (with placement_reason) in batches of 100
  ├─ EdgeRuntime.waitUntil(finalize()) — background: recompute full warnings,
  │     update generation row (warnings, score_breakdown, sa_*), activity_log
  └─ return { generation_id, version, blocks_count, score_breakdown, ... }
```

### `generateScheduleBlocks(...)` (the engine, ~line 2286)

1. **Pre-flight feasibility** — counts *session* capacity (specialist-days ×
   sessions/day) vs. demand (teachers × specialists, halved for A/B). A genuine
   shortfall becomes a soft `capacity_shortfall` **warning**, never a throw.
2. **Pre-seed an `OccupancyTracker`** with admin/PLC blocks (book specialist +
   `bookGradeRange` lock + block teacher slots for that grade), locked blocks
   (replan), PLUS rotations, specialist lunches, and special-event windows.
3. **Derive a deterministic MC seed** from `generationId` + `seedSalt`
   (`deriveSeed`), and build the `ScoreableInput` for the scorer.
4. **Strategy selection:**
   - If `conflict_timing === "after"` or no conflict grades → a single
     `standard` strategy path.
   - Otherwise a **priority-ordered try/fallback loop** over the requested
     strategies (`ab_week`, `aa_bb_week`, `quick_30`, `big_group`,
     `extra_rotation`, always falling back to `standard`). The first strategy
     whose best Monte-Carlo candidate is error-free wins; otherwise the
     fewest-errors candidate is chosen with `fallbackReason`.
5. **Monte Carlo restart** (`_monteCarlo.ts`): `calibrateMonteCarlo` times one
   strategy run and picks an iteration count (≤150ms→80, ≤300ms→40, ≤600ms→24,
   else 12; throws `MonteCarloBudgetExceededError` if projected > 90s).
   `monteCarloRun` runs the strategy `iterations` times with per-iteration
   derived seeds, scores each with `scoreSchedule`, keeps the best.
6. **Simulated Annealing refinement** (`runSimulatedAnnealing`, ~line 1964):
   single-move local search over the MC winner. Moves = swap (two same-specialist
   different-teacher blocks), move (relocate one block to a free slot), and
   anti-cluster shuffle (relocate a `(grade,subject,day)` duplicate). Each
   candidate is re-checked with `computeWarnings` (gated by `strategyFailed`) and
   re-scored; Metropolis acceptance with cooling. Big-Group members are excluded
   from mutation; the "never strand a specialist on an idle day" guard is in the
   move/shuffle steps.
7. Append makeup / lunch-club / event-planning blocks if requested, compute the
   final `scoreBreakdown`, and return the `SchedulerResult`.

### Scoring (two layers — keep them distinct)

- **Optimizer objective** (`_scoring.ts::scoreSchedule`): a single `total`
  (higher = better) from a weighted `ScoreBreakdown`. Errors dominate (−1000).
  `DEFAULT_WEIGHTS` may be overridden per school (learned weights, ±50% clamp).
  This is what MC and SA optimize.
- **Public quality %** (`_shared/scoring-rubric.ts`, mirrored in
  `src/lib/scoringConstants.ts`): `round(100 − Σ|penalty term|/4)` over a fixed
  `PENALTY_KEYS` list, applied to the **already-weighted** breakdown. This is the
  number the UI shows and the best-of-N loop optimizes for. **Parity between the
  edge rubric and the frontend mirror is enforced by tests and must never drift.**

### SSOT validator (`_shared/constraints.ts`)

`violations()` / `isLegalPlacement()` is the **single source of truth** for "is
this placement legal?" used by every PERSIST path (AI/manual edits,
replan, conflict resolution). It enforces: end>start, within school hours
(early-release aware), no recess/lunch overlap for the grade's band, no PLC/Admin
grade-range lock overlap, no specialist double-book, no teacher/class double-book.
Big-Group exemption: same specialist + grade + *identical* interval + different
teachers is a class taught together and is **not** a double-book.

> Note: `index.ts`'s in-generation legality is enforced by the `OccupancyTracker`
> + `computeWarnings`, which intentionally mirror the SSOT. The SSOT is the gate
> for everything that *persists* an edit. New optimization code must validate
> against the SSOT (or the occupancy tracker that mirrors it) — never a fork.

### Replan (`replan-subgraph/index.ts`)

Identifies "disturbed" blocks matching a scope (specialist/grade/day), locks
everything else, and calls `generate-schedule` with `locked_block_ids`. Locked
blocks are pre-seeded into occupancy so the regen routes around them. Today this
is a *full regen of the disturbed scope* — there is **no minimal-perturbation
objective yet** (Phase 2).

---

## 2. Determinism contract — current reality

- The hot path uses the seeded `mulberry32` RNG (`_random.ts`) for all strategy
  permutations and SA mutation choices. Good.
- **Known violation (Phase 1a target):** `runSimulatedAnnealing` uses
  `performance.now()` as a 20s wall-clock budget (`SA_TIME_BUDGET_MS`), and the
  serve handler's best-of-N loop uses a `performance.now()` CPU budget
  (`CPU_BUDGET_MS=1200`) and `calibrateMonteCarlo` times a calibration run with
  `performance.now()`. These make the *number of iterations / attempts* depend on
  wall-clock speed, so the same seed can yield different output on a slower box.
  Phase 1a replaces the SA wall-clock budget with a fixed seeded iteration budget
  (wall-clock kept only as an unreachable safety cutoff).

---

## 3. Inviolable invariants (mirror of the task brief — do not break)

1. `_shared/constraints.ts::violations()` is the only legality definition. Never
   fork/duplicate/re-implement it. Every move/rebuild/resolution/persist
   validates against it (or the occupancy mirror in-generation).
2. Edge↔frontend scoring parity: `scoring-rubric.ts` and `scoringConstants.ts`
   keep identical `PENALTY_KEYS` + formula. Don't change the displayed quality %.
3. Determinism: no `Math.random()` / `Date.now()` / `performance.now()` in the
   seeded hot path in a way that affects output. Same seed ⇒ identical blocks.
4. Edge CPU ~2s ceiling. Heavy optimization runs as **background refinement**,
   never synchronously inline.
5. Big-Group exemption: same specialist + grade + identical interval + different
   teachers is taught together and must never be split. Preserve `combinedMembers`
   exclusion in every move/swap/LNS destroy-rebuild/conflict tactic.
6. Domain rules: never manufacture an idle day; early-release awareness;
   per-grade-band recess/lunch; PLC/Admin grade-range locks. New code respects
   them.
7. AI never places blocks directly. LLMs propose/translate/explain/narrate; the
   deterministic engine places + validates; propose→confirm→apply gate stays.

---

## 4. Test / measurement commands

```sh
# backend (Deno)
deno test --no-check --allow-hrtime supabase/functions/generate-schedule/
deno test --no-check supabase/functions/_shared/constraints_test.ts
deno test --no-check supabase/functions/_shared/scoring-rubric_test.ts
# quality harness (no deploy)
deno run --allow-hrtime supabase/functions/generate-schedule/_simulate.ts [strategy]
# frontend (vitest)
npm run test
```

### Baseline at Phase 0 start
- Frontend vitest: **27 passed**.
- `_shared` Deno tests: constraints **11 passed**, scoring-rubric **6 passed**.
- `generate-schedule` Deno tests: **65 passed, 2 failed**. The 2 failures are
  pre-existing and **stale**: `_monteCarlo_test.ts` still asserts the old
  `calibrateMonteCarlo` thresholds (200 iters / 60s budget) while the code now
  uses 80 iters / 90s. These tests cover the exact calibration logic Phase 1a
  reworks, so they are corrected there rather than papered over now.

---

## 5. Phase log

- **Phase 0 (in progress):** characterization tests pinning current
  `score_breakdown` / block count / zero-violation status across `_simulate.ts`
  fixtures; then decompose the monolith into focused modules, behavior-preserving.
