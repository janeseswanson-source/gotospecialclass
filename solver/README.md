# CP-SAT solver (the "provably optimal" path)

A small Python + Google OR-Tools (CP-SAT) HTTP service that solves the school
specials-rotation problem to **provable optimality** against the same soft rubric
the app uses. It runs OFF-PLATFORM (Lovable/Supabase edge can't host OR-Tools), so
it can compute as long as needed without the ~2 s edge CPU limit.

The app calls it, then **re-validates every result against the SSOT** before
persisting — so even if this model ever drifts, it can never write an illegal
schedule. If the service is unreachable, the app falls back to the in-app
metaheuristic.

## Files
- `solver.py` — the CP-SAT model (pure JSON in/out). Objective mirrors
  `src/lib/scoringConstants.ts` exactly (scaled ×20 for integer objective).
- `app.py` — FastAPI wrapper (`POST /solve`, `GET /health`).
- `test_solver.py` — self-contained validation (optimality + no double-booking +
  no class repeats + capacity walls respected + Big-Group fixed sessions honored).
- `Dockerfile`, `requirements.txt`.

## Run locally
```sh
pip install -r requirements.txt
python test_solver.py                 # validate the model
uvicorn app:app --port 8080           # serve
curl localhost:8080/health
```

## Deploy (pick one)

All three build the `Dockerfile`. Set `SOLVER_API_KEY` to a long random string and
give the same value to the Supabase edge function (below).

**Google Cloud Run** (recommended) — one command:
```sh
cd solver && ./deploy-cloudrun.sh
```
It creates a Secret Manager API key, deploys from source (`min-instances=0`, `cpu=2`,
`memory=1Gi`, `timeout=300`), and prints the `CPSAT_SOLVER_URL` / `CPSAT_SOLVER_KEY`
to paste into Supabase. (Manual equivalent: `gcloud run deploy cpsat-solver --source .
--region us-central1 --cpu 2 --memory 1Gi --timeout 300 --min-instances 0
--allow-unauthenticated --set-env-vars SOLVER_API_KEY=YOUR_LONG_RANDOM_KEY`.)

**Render** — Blueprint: New + → Blueprint → this repo → Apply (reads `render.yaml`,
auto-generates `SOLVER_API_KEY`). Or New → Web Service → Root Directory `solver`,
Runtime Docker.

**Fly.io**:
```sh
cd solver && fly launch --no-deploy   # creates fly.toml from the Dockerfile
fly secrets set SOLVER_API_KEY=YOUR_LONG_RANDOM_KEY
fly deploy
```

### Cloud Run vs Render Starter — which host?

| | **Cloud Run** (`min-instances=0`) | **Render Starter** |
|---|---|---|
| Idle cost | ~$0 (scales to zero) | ~$7/mo (always on) |
| Cold start | ~10–15 s on the first solve after idle | none (always warm) |
| Scaling | automatic, per-request (`cpu=2`) | fixed single instance |
| RAM | 1 GiB (configurable) | 512 MB (free) / 512 MB+ (starter) |
| Setup | `./deploy-cloudrun.sh` | `render.yaml` Blueprint, one click |
| Best when | bursty/occasional generation (most schools) | steady all-day use, or you want zero cold starts |

Either way, `.github/workflows/keep-warm.yml` pings `/health` every 10 min on
weekday business hours (set the GitHub secret `CPSAT_SOLVER_URL`), so even the
scale-to-zero Cloud Run path is warm before the first real generation of the day.
Render **free** also spins down when idle — the same keep-warm covers it; **starter**
never spins down, so it's the pick if you never want a cold start.

## Wire it to the app
The new `generate-cpsat` edge function reads two Supabase secrets:
- `CPSAT_SOLVER_URL` = the deployed service URL (e.g. `https://cpsat-solver-xxxx.run.app`)
- `CPSAT_SOLVER_KEY` = the same `SOLVER_API_KEY`

Set them in Supabase → Project Settings → Edge Functions → Secrets (or via Lovable).
Without them, the app silently uses the metaheuristic path.

## Tuning
- `time_limit_s` (per request, clamped by `SOLVER_MAX_TIME_S`, default 120): how long
  CP-SAT searches before returning the best-so-far. These schools solve to OPTIMAL
  in a few seconds; raise it for very large/contended schools.
- More CPU (`--cpu`) → faster proofs (CP-SAT parallelizes across workers).

## Scope note
The solver is now the PRIMARY generator for every school and all seven conflict
strategies (standard, A/B, AA/BB, quick-30 per-duration grids, Big-Group `group_id`
taught-together, extra-rotation `sessions_per_pair`, plus makeup/lunch-club/event
post-passes appended by the edge builder). It drives class_repeats, subject_gap, and
clustering to their true floor and proves the remaining gap. "Optimal in a few
seconds" holds for small/medium schools; a large school (≈40+ teachers) returns a
fully-covered, bounded-gap FEASIBLE schedule within `time_limit_s` rather than a
certified optimum — still legal and fully covered (the hard min-sessions floor),
just not proven optimal on the soft-preference terms.
