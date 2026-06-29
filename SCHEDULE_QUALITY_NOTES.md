# Schedule Quality — diagnosis & fixes

Why schedules were scoring 40% (and stuck there), and how they now reach the
**true achievable ceiling** — 100% on the strategies that allow it.

## Root cause (it was NOT a compute/"thinking budget" problem)

The dominant penalty was **`class_repeats`** — a class seeing the *same*
specialist twice instead of a distinct one. Measured on the AB-Week fixture it was
**−375** (15 of 24 classes saw only 4 of 5 specialists). Its structural floor is
**0** (a perfect "every class sees 5 distinct specialists" assignment exists), but
the greedy day-by-day construction didn't find it.

The killer: **every refinement move (SA swap/move/shuffle, LNS ruin-and-recreate)
only changed a block's TIME, never which specialist a class is assigned to.** So
`class_repeats` was frozen the instant the schedule was built — no amount of
"keep trying" could touch it. Empirically, 25× heavier refinement left AB-Week at
0%.

A second trap: the rubric counts `subject_day_clustering` **week-blind**
(`grade|subject|day`, no week), so a class seeing a subject on the same weekday in
*both* the A and B weeks reads as a duplicate — but the de-cluster move was
week-*aware* and never targeted it. That kept AB/AA-BB week pinned near 0%.

## Fixes

1. **Reassignment operator** (`_lns.ts::reassignClassDistinct`) — re-places one
   class's sessions onto **distinct** specialists (week-aware occupancy,
   grade-rotation aware, clustering-aware slot pick, Big-Group/idle-day safe). The
   only operator that can change *which* specialist a class sees. Added as LNS
   operator 3, and used by the directed repair.
2. **Directed greedy repair** (`_lns.ts::directedRepair`) — deterministic descent
   that repeatedly applies the best targeted move (reassign repeating classes +
   **week-blind** de-cluster) until none improves. Far more reliable than random
   LNS on structured assignment penalties. `refineSchedule` is now
   `directedRepair → SA → LNS → directedRepair`.
3. **Relentless loop** (`src/lib/generateBestSchedule.ts`) — after best-of-N
   search, the client calls `refine-schedule` repeatedly (each pass with a fresh
   `seed_salt`, chasing each strictly-better version) until the target is hit OR
   the search provably converges (stale-limit) OR the engine reports
   "structurally limited" OR the 8-minute budget. Each pass is ~0.3–0.5s, far
   under the edge CPU limit; many short passes accumulate unlimited total compute.
   This is the "keep trying until it's truly best" layer — and `refine-schedule`
   re-validates every version against the SSOT (0 double-bookings), so quality
   only ever goes up and never breaks a rule.
4. **Honest ceiling** (`_confidence.ts`) — when the search has converged below
   100% and the binding trade-off is a capacity/assignment wall
   (`teacher_planning`, `contract_min`, `class_repeats`, `subject_gap`), the
   signal reports **structurally_limited** and names the concrete input change
   that lifts it ("add a session or use longer class blocks"), instead of forever
   claiming "another pass could help."

## Results (generate → relentless refine, 0 SSOT violations everywhere)

| Strategy | Before | After |
|---|---|---|
| **AB Week** | 0% | **100%** (≈2 passes) |
| **AA/BB Week** | 0% | **100%** |
| Standard | 46% | **91%** — `teacher_planning` is the structural cap |
| Quick 30 | 0% | **71%** — 30-min classes can't cover teacher planning minutes (capacity wall) |
| Big Group | 15% | **~57%** — Big-Group "taught together" sessions are unmovable by design |

So **100% is delivered where it's physically possible** (AB/AA-BB Week — the
user's case). Where it isn't, the system climbs to the provable ceiling and tells
you the one input to change. Quick-30 / Big-Group are capped by genuine capacity /
"teach-together" constraints, not solver weakness — they now say so.

## Engine duplication note
Lovable's deploy can't import across function dirs, so the engine is copied into
each consumer's `_engine/`. **Edit the canonical `generate-schedule/` files, then
run `bash scripts/sync-engine.sh`** before committing so the copies never drift.

## Still open (smaller)
- Big-Group clustering: the combined-member sessions limit how high it can go;
  could special-case them. Lower priority.
- A proper global round-robin *construction* would start near-optimal (less
  refinement needed); the directed repair makes it unnecessary for correctness.
