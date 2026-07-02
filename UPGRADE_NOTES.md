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

- **Phase 0 (done):** characterization tests pin `score_breakdown` / block count /
  chosenStrategy / winningScore / SSOT zero-violation across the standard /
  ab_week / aa_bb_week / quick_30 / big_group fixtures
  (`_characterization_{fixtures,test}.ts`). Decomposed the two highest-value
  seams out of the monolith, behavior-preserving (snapshots byte-identical):
  - `_occupancy.ts` — `Interval`, `intervalsOverlap`, `OccupancyTracker`.
  - `_annealing.ts` — `runSimulatedAnnealing`, `buildOccupancyFromBlocks`.
  index.ts re-exports the moved symbols + exports the leaf helpers SA needs; the
  index↔_annealing import cycle is safe (all references are inside function
  bodies). **Deferred (documented):** further splitting the constructive
  strategies (`_strategies.ts`) and the orchestrator (`_orchestrate.ts`) — Phase 1
  only touches the now-isolated search layer, so these are lower priority.

- **Phase 1a (done):** SA is now deterministic. `runSimulatedAnnealing` takes
  `SAOptions { maxIterations, safetyMs }`: the iteration budget is a fixed seeded
  count and the cooling schedule is deterministic, so same seed + inputs ⇒
  byte-identical result. The old per-iteration wall-clock budget
  (`SA_TIME_BUDGET_MS = 20000`, which made the iteration count machine-dependent)
  is removed; wall-clock survives only as a never-reached safety valve
  (`safetyMs`, default 30s, checked every 128 iters). Default `maxIterations`
  (1000) reproduces legacy behavior, so the characterization snapshots stay
  byte-identical. New `_annealing_test.ts` proves the contract — notably that
  varying `safetyMs` (5s vs 600s) does not change output. Also fixed the 2 stale
  `_monteCarlo_test.ts` cases (80-iter fast tier; injectable `budgetMs` so the
  budget gate is testable without a long spin). **Backend suite: 79 passed, 0
  failed (was 65/2 at baseline).**

  > Determinism caveat (unchanged, documented): `calibrateMonteCarlo` still times
  > a calibration run to pick the MC iteration count, so the *number* of MC
  > restarts is CPU-adaptive. Within one deployment environment this is stable;
  > across very different machines the MC iteration count (hence the winner) can
  > differ. This is the intentional CPU-budget mechanism, separate from the SA
  > wall-clock that Phase 1a fixed. Same-seed determinism holds per environment.

- **Phase 1b (done):** `_lns.ts` adds Large Neighborhood Search (ruin-and-recreate)
  as a refinement layer that escapes the local optima single-move SA gets stuck
  in. Each round DESTROYS a coherent subset (one specialist's week / one weekday /
  one grade's rotation) and RECREATES exactly those sessions via the same
  occupancy-validated slot enumeration the strategies use; accepts via Metropolis
  but **returns the best-seen** schedule, so quality is monotonic (result ≥ input).
  Invariants preserved and **tested**: Big-Group combined members are never
  destroyed (never split); idle-day guard (`activeDays(before) ⊆ activeDays(after)`
  per specialist, == SA's last-block guard); zero error-severity warnings on every
  accepted rebuild; deterministic (seed-only; `safetyMs` proven not to affect
  output). Measured on the post-generation schedules: **standard (complaint
  school) +15, quick_30 +20, big_group +20; ab_week / aa_bb_week unchanged (never
  worse); 0 SSOT violations on all five.** (A/B-week recreate is conservative
  because occupancy ignores `week_label` — same limitation SA already has; noted
  for a future occupancy-by-week improvement.) Not yet wired into the request
  path — that is the background-refinement step (keeps the inline path under the
  edge CPU budget).

- **Phase 1c (done):** `_confidence.ts` adds a quality-confidence signal the UI can
  show. Two cheap, honest parts:
  - **Convergence** (`computeConvergence`) from refinement telemetry
    (`rounds`, `lastImprovementRound`, now reported by LNS): "still improving" vs.
    "plateaued/converged" (no improvement in the last 30% of the budget).
  - **Headroom** (`estimateHeadroom`): a relaxation lower bound on structurally
    unavoidable soft penalty — session capacity (same per-specialist formula as
    the generator's feasibility precheck) vs. (grade × specialist) coverage
    demand. `forcedSubjectGaps = max(0, requiredPairs − capacity)` →
    `unavoidablePenaltyLB`. Subtracting that floor from the actual penalty bounds
    the optimality gap from above (`gapQualityPoints`, in public-rubric points).
  `computeQualityConfidence` combines them into an assessment —
  `structurally_limited` (add capacity) / `more_headroom` (run another pass) /
  `near_optimal` (within ~2 quality points of the bound) — plus a recommendation
  string. It is NOT part of the public quality-% rubric and does not change it.
  Backend suite: **112 passed / 0 failed.**

- **Phase 1 background refinement (done):** `_refine.ts::refineSchedule` is the
  heavy out-of-request-path pass: SA (larger deterministic budget) then LNS, on a
  persisted schedule. It is **trust-anchored** — the candidate is re-validated
  against the actual SSOT (`_shared/constraints.ts::violations`) over the full
  block set and accepted ONLY if it has zero violations, no new error warnings,
  and a quality % no lower than the input; otherwise the original is returned
  untouched. Deterministic (seed from the generation id). Reports the Phase-1c
  confidence signal. New thin edge function `refine-schedule/` wires DB I/O around
  it: load a generation → refine → if improved, write a NEW version
  (`refined_from_generation_id`, added by migration `20260628000000`) atomically
  (the source version is never mutated); else return the confidence signal so the
  UI can advise. No LLM involvement — the deterministic engine places + validates.

  **Inline vs background split:** the inline `generate-schedule` path keeps its
  existing (now-deterministic, bounded) SA so it returns a good schedule fast
  under the edge CPU ceiling; the NEW heavy lever (LNS + larger SA budgets) lives
  only in `refine-schedule`, which the client calls after generation. This is the
  additive, low-risk reading of "move heavy work to background": inline behavior
  is unchanged (snapshots byte-identical), background adds the improvement. If a
  very large/contended school ever pressures the inline CPU budget, the inline SA
  budget can now be safely reduced because background refinement compensates.
  Tested: `refineSchedule` never regresses, stays SSOT-legal, deterministic, and
  improves the complaint-school fixture.

- **Phase 2 (done):** minimal-perturbation replanning. `_perturbation.ts` defines
  the objective: a teaching block "matches the baseline" iff its exact placement
  signature (`teacher|specialist|grade|day|start|end|week`) is in the committed
  baseline; `countMovedBlocks` is the moved count, `perturbationAdjust` the
  search hook. SA and LNS gained an optional `objectiveAdjust` folded into the
  ACCEPT comparison (LNS also tracks best by the combined objective). **It is
  additive and default-off, so SA/LNS output is byte-identical when no baseline
  is supplied** (characterization + determinism tests still green). The term is
  **kept entirely out of the public quality-% rubric** — it never touches
  `scoreSchedule`'s breakdown or `scoring-rubric.ts`; it only biases accept
  decisions. `refineSchedule` takes an optional `perturbationBaseline`;
  `replanMinimal(baseline, isDisturbed, ctx)` re-places ONLY the disturbed
  sessions (survivors locked by reference) and reports `movedFromBaseline`,
  degrading gracefully to `ok=false` (caller falls back to full regen) when a
  change can't be absorbed minimally. `refine-schedule` accepts
  `perturbation_baseline_generation_id` to anchor a refine to a committed version
  (replan flows), and returns `moved_from_baseline`.

  **Measured:** a 2-session "room closes" disturbance → `replanMinimal` changes ≤2
  blocks (survivors untouched) vs **102** for a full regenerate, 0 violations; a
  perturbation-anchored re-solve stays measurably closer to the committed baseline
  than a free one (61 vs 84 moved on the complaint-school fixture). Backend suite:
  **122 passed / 0 failed.**

  > Stability metric, not quality: if surfaced to users, `moved_from_baseline` is a
  > separate, clearly-labeled number — never folded into the displayed quality %.

- **Phase 3 (done):** deterministic blast-radius conflict cascade. `_conflict.ts`
  is a pure engine: `detectConflicts` finds REAL conflicts from the blocks via the
  SSOT (not by parsing warning text); `resolveConflict(conflict, blocks, ctx)`
  tries tactics in increasing-perturbation order — **relocate** (same day, then
  any working day), **swap** two same-specialist sessions, **add_session** (for
  no_coverage) — validates EVERY candidate against the SSOT, and returns a ranked
  list of legal options with their **measured** blast radius (the Phase-2 moved
  count — computed, not hardcoded "1, 2–5, 10–50"). When nothing is legal it
  **escalates**: the irreducible reason (the most common blocking constraint), the
  conflicting constraints, and the least-bad options. `resolveConflictsDeterministic`
  applies the smallest-radius option iteratively until conflict-free.
  `resolve-conflicts-ai` is refactored so the **engine resolves and the LLM only
  narrates** — it inverts the old "LLM proposes placements → engine validates"
  flow: now the engine produces SSOT-legal, applied changes (by real block id) and
  the LLM writes the rationale/summary (best-effort; deterministic summary if no
  API key). The LLM never invents or selects placements outside the engine's legal
  set. **Tested:** a forced double-book yields ranked legal options ordered by real
  blast radius (relocate before swap), each SSOT-legal and conflict-clearing; the
  batch resolver clears detected conflicts deterministically; the unresolvable
  case returns a structured escalation, never a crash or illegal fix. Big-Group
  combined classes are correctly NOT treated as conflicts (SSOT exemption holds).
  Backend suite: **127 passed / 0 failed.**

- **Phase 4 (done):** learnable-weights loop, human-gated. `_weightlearning.ts`
  does lightweight inverse optimization: from the original (generated) and edited
  (admin-preferred) score breakdowns — scored with the same weights so
  `|breakdown_k| ∝ count_k` — it computes a gradient
  `(edited[k] − original[k]) / w_k` and steps each weight by
  `lr·|default_k|·sign(gradient)` so the admin's preferred layout would have
  scored higher. Penalties the admin reduced get a LARGER magnitude; penalties
  they accepted get a SMALLER one; rewards they increased get more weight. Every
  weight is clamped to ±50% of its default and hard-constraint terms
  (errors/warnings) are never reweighted. `update-scoring-weights` is now a real
  loop with two human-gated actions: **propose** (observe edits → stage a
  `proposed_weights` proposal; active weights untouched) and **confirm** (copy the
  proposal into active `weights`, bump `sample_count`, clear the proposal). A
  weight change is therefore a new EXPLICIT input to future generations, never
  hidden state. Migration `20260628010000` adds `proposed_weights`/`proposed_at`.
  **Tested:** edits in each direction produce sane, clamped proposals; repeated
  consistent samples converge to the ±50% clamp and stop; nothing auto-applies.
  Full backend: **134 passed / 0 failed**; frontend **27 passed**.

- **Phase 5 (done):** CP-SAT is now the PRIMARY generator for EVERY school — all
  seven conflict strategies, every teacher/specialist input honored, objective =
  the FULL public rubric with the school's learned weights. Branch `cpsat-complete`.

  - **Solver (`solver/solver.py`).** The objective mirrors every `_scoring.ts`
    term, each spec-weighted (learned weights drive it), scaled ×20 to integers:
    per-(grade,specialist) coverage (subject_gap) + a per-(class,specialist)
    placement reward + a *smaller* extra-session reward, teacher_planning,
    subject_day_clustering, k_grade_after_780, full_week_coverage, grade_cohesion,
    contract_min (subject minimums), cart_back_to_back (proxy), spec_dayload_stdev
    (MAD linearized via `AddAbsEquality` around a **free per-spec center** — the
    naïve mean-coupled form left the objective un-provable; the free-center form
    proves OPTIMAL in ~1s), and am_pm / day_pref / planning_target rewards. New:
    a hard `min_sessions_per_pair` floor (the edge sends 1) with a **soft retry**
    that drops the floor and returns `coverage_relaxed:true` on a capacity wall;
    per-duration `slots_by_grade_duration` (quick-30 mixed classes; a specialist
    whose duration has no grid → `MODEL_INVALID` naming it, never a silent hole);
    Big-Group `group_id` on fixed sessions (members sharing an id = ONE specialist
    interval + one teacher interval each, counted once for clustering; same
    slot+specialist WITHOUT a shared id stays INFEASIBLE = a genuine double-book);
    `extra_rotation` via `sessions_per_pair` (≤ N, with day-spacing and the smaller
    2nd-session reward); per-specialist `grade_rotation` candidate filtering. AA/BB
    is a two-timeline solve with opaque labels — the consecutive-week cadence is a
    calendar-mapping concern, not a solver constraint (documented in the docstring).

  - **Edge builder (`generate-cpsat/`).** Extracted pure, testable
    `buildCpsatSpec(...)` (`_spec_builder.ts`): per-duration slot grids, `["AA","BB"]`
    for aa_bb_week / `["A","B"]` for ab_week, Big-Group fixed sessions with group_ids
    derived the same way generate-schedule combines conflict-grade classes,
    `sessions_per_pair` for extra_rotation, grade_rotation / uses_cart / am_pm & day
    prefs / contract minimums / per-spec planning budget, and DEFAULT_WEIGHTS merged
    with the school's learned weights each clamped ±50%. After the solve it appends
    the SAME makeup / lunch_clubs / event_planning post-passes generate-schedule
    appends (those generators are now exported and imported via `_engine`) BEFORE the
    SSOT re-validation + scoring, so those schools stop losing blocks. Every
    non-success path returns a typed 4xx/5xx with a machine-readable `code`
    (`cpsat_unconfigured` / `cpsat_unreachable` / `cpsat_solver_error` /
    `cpsat_model_invalid` / `cpsat_infeasible` / …) — nothing silently degrades.

  - **Guards & tests.** `sync-engine.sh --check` fails CI on engine drift; a new
    `.github/workflows/ci.yml` runs sync-check + Deno tests + vitest + build + solver
    pytest. Migration `20260702000000` adds `UNIQUE(school_id, version)` on
    `schedule_generations` and every generation inserter (generate-schedule,
    generate-cpsat, refine-schedule) retries on the conflict. **Counts: solver
    pytest 17 passed; Deno generate-schedule 118, `_shared` 19 (incl. Big-Group SSOT
    exemption parity), generate-cpsat `_spec_builder` 16 (incl. a
    computeWarnings→scoreSchedule→qualityPercent parity test); vitest 50; build OK.**
    All §3 invariants hold: the SSOT re-validates every persisted block, the
    Big-Group exemption is preserved end-to-end, and the AI never places blocks.

- **Phase 6 (done):** CP-SAT-only async pipeline, moved SERVER-SIDE. Branch
  `cpsat-only-pipeline`. The browser used to orchestrate best-of-N + refine itself
  (dozens of edge calls it had to stay on the page for). Now:
  - **Job queue.** Migration `20260702010000` adds `generation_jobs`
    (status queued|running|polishing|complete|failed|cancelled, phase, progress
    jsonb, best_generation_id, fallback_used/reason, error, attempts, timestamps) +
    RLS (workspace members read/enqueue/cancel; the worker uses the service role) +
    Realtime (REPLICA IDENTITY FULL, added to `supabase_realtime`).
  - **Pure state machine.** `run-generation-job/_stepJob.ts` is I/O-free (every
    effect injected): `stepJob` advances a job ONE bounded step —
    `cpsat` (60s, 120s for > 30 teachers) → on success `refine`; on
    **503/unreachable ONLY** → `fallback_search` (metaheuristic best-of-3) with
    `fallback_used=true`; on a definitive solver verdict (model_invalid/infeasible)
    → `failed`. `refine` loops until improved=false twice OR
    `structurally_limited` OR target. A 10-min wall guard finalizes honestly;
    cancelled is a no-op; `runInvocation` does the atomic queued→running claim +
    optimistic `attempts` guard so a double-fire never double-runs a step. 14 unit
    tests (happy/fallback/cancel/idempotent double-claim/wall/optimistic-guard).
  - **Edge functions.** `enqueue-generation` (validates the user, supersedes any
    in-flight job, inserts queued, kicks the worker) + `run-generation-job`
    (internal-only via the service key; self-chains via `EdgeRuntime.waitUntil`;
    sends the completion notification server-side so it fires even if the page is
    closed). generate-cpsat / generate-schedule / refine-schedule gained an internal
    service-role auth bypass so the worker can call them. **verify-schedule is
    removed from the generation pipeline** (repurposed elsewhere).
  - **Client.** `generateBestSchedule` now just enqueues + subscribes to the job
    over Realtime (same `GenProgress` shape via the pure `mapJobProgress`, unit-tested).
    PrepPage/StepReview show "Safe to close this page", a Cancel button, and an amber
    "Generated with fallback engine — the optimal solver was unreachable" note with a
    retry-with-solver button when `fallback_used`.
  - **Admin.** AdminAICostsPage charts CP-SAT vs fallback runs + fallback rate +
    median solve time from `generation_jobs`.
  - **Hosting.** `solver/deploy-cloudrun.sh` (min-instances=0, cpu=2, 1Gi, timeout
    300, key from Secret Manager); `render.yaml` documents Starter as the always-on
    alternative; `.github/workflows/keep-warm.yml` pings `/health` every 10 min on
    weekday business hours; the Dockerfile is cold-start-tuned (slim, prod-only deps,
    single uvicorn worker, no access log).

## 6. Final state

All phases 0–6 are merged. CP-SAT (`solver/` + `generate-cpsat/`) is the primary
generator for every school when the service is configured; if it isn't (or returns
a typed failure), the client falls back to the deterministic metaheuristic and is
never worse off. Tooling note: edge functions that import the Anthropic SDK only
type-check with `deno check --node-modules-dir=auto` (the SDK is an npm dep); this
is a pre-existing local-tooling quirk, not a code issue. `generate-cpsat` does NOT
import the SDK, so it type-checks plainly (and CI does so).
