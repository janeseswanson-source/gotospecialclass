# Turning on the CP-SAT "provably optimal" solver

The app can generate schedules two ways:

1. **In-app metaheuristic** (default, always on) — Monte Carlo + simulated
   annealing + LNS + directed repair, run as many short Edge calls. Fast, no extra
   infra, but it *searches* for a good schedule and can plateau below the true best.
2. **CP-SAT** (this feature, opt-in) — a Python + Google OR-Tools service that runs
   OFF-PLATFORM and returns a schedule that is **provably optimal** against the same
   quality rubric, with a certificate of how close to optimal it is. It clears
   clustering / class-repeats / subject-gaps to their true floor and *proves* what's
   left is a real capacity wall.

When the CP-SAT service is configured, generation tries it first and seeds its
result as the baseline; the metaheuristic then only replaces it if it finds
something strictly better. **If the service isn't configured, nothing changes** —
the app silently uses the metaheuristic.

## One-time setup (~15 min)

### 1. Deploy the solver service
See [`solver/README.md`](solver/README.md). Shortest path (Google Cloud Run):
```sh
cd solver
gcloud run deploy cpsat-solver --source . --region us-central1 \
  --memory 1Gi --cpu 2 --timeout 300 --allow-unauthenticated \
  --set-env-vars SOLVER_API_KEY=$(openssl rand -hex 24)
```
Note the printed `https://…run.app` URL and the key you generated.

### 2. Give the edge function the URL + key
In Supabase → Project Settings → Edge Functions → Secrets (or via Lovable's env UI),
add:
- `CPSAT_SOLVER_URL` = the service URL (e.g. `https://cpsat-solver-xxxx.run.app`)
- `CPSAT_SOLVER_KEY` = the same value you passed as `SOLVER_API_KEY`

### 3. Deploy the new edge function + frontend
`generate-cpsat` is a new Supabase function; redeploy functions + the frontend from
`main` the same way you normally ship (Lovable deploys from `main`). No DB
migrations are required.

## Verify it's working
Generate a schedule. The progress line shows **"Solving for the provably-optimal
schedule… N%"** when CP-SAT ran. The saved generation's `chosen_strategy` is
`cpsat_optimal`. If you never see that line, the secrets aren't set (or the service
is unreachable) and the app fell back to the metaheuristic — check the function logs
for `cpsat_unconfigured` / `cpsat_unreachable`.

## What it guarantees / what it doesn't
- **Guarantees**: legal schedule (re-validated against the SSOT before saving — it
  never persists an illegal block), and *optimal-or-proven-gap* against the FULL
  soft rubric (every `_scoring.ts` term) with the school's learned weights.
- **Honest ceiling**: "optimal" is not always 100%. If your inputs force it (a
  specialist who only works 2 days, or fewer specials slots than a teacher needs for
  prep), the true best is below 100% and CP-SAT proves it — the remaining gap shows
  up as `teacher_planning` and tells you the input to change. When full coverage is
  itself impossible, the solver relaxes the coverage floor and reports
  `coverage_relaxed: true` instead of failing.

## Strategy scope — full coverage (Phase 5)
CP-SAT is now the PRIMARY generator for **every** school and every conflict strategy,
not a single-week special case:

| Strategy        | How CP-SAT handles it |
|-----------------|-----------------------|
| standard        | single rotation week |
| ab_week         | two disjoint timelines, labels `A`/`B` |
| aa_bb_week      | two disjoint timelines, labels `AA`/`BB` (the consecutive-week cadence is calendar-mapping, not a solver constraint) |
| quick_30        | per-duration slot grids — a 30-min specialist gets real 30-min sessions alongside 45-min ones |
| big_group       | selected conflict-grade classes are pinned as taught-together fixed sessions (shared `group_id`) the solver keeps together |
| extra_rotation  | a `(class, specialist)` pair may be scheduled twice, spaced across days, with a smaller reward so extras never crowd out first coverage |
| makeup / lunch_clubs / event_planning | appended as post-passes (the same generators generate-schedule uses) before the SSOT re-validation, so these schools keep their blocks |

Every teacher/specialist input is honored: PLC/admin locks, PLUS rotations, specialist
lunch, grade rotation, `uses_cart`, AM/PM & day preferences, contractual subject
minutes, and planning-time targets all feed the objective or its constraints. If the
service is unconfigured or returns a typed failure (`cpsat_*` code), the client falls
back to the in-app metaheuristic and the school is never worse off.

## Cost / tuning
These schools solve to OPTIMAL in a few seconds. Cloud Run bills per request-second,
so cost is negligible unless you raise `time_limit_s` for very large schools. More
`--cpu` → faster proofs (CP-SAT parallelizes across workers).

## Wheel alignment (engine-only for now)
The grade-wheel objective (`wheel_alignment` in `_scoring.ts` — all specialists service
the same grade's classrooms per time slot, gated by `schools.rotation_wheel_grades`)
is implemented in the in-app metaheuristic engine only. The CP-SAT model does not yet
optimize for it; CP-SAT results are still SSOT-checked and score-compared before
adoption, so a wheel-aligned engine schedule wins when it scores better.
