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

**Google Cloud Run** (simplest):
```sh
cd solver
gcloud run deploy cpsat-solver --source . --region us-central1 \
  --memory 1Gi --cpu 2 --timeout 300 --allow-unauthenticated \
  --set-env-vars SOLVER_API_KEY=YOUR_LONG_RANDOM_KEY
# → prints a https URL
```

**Fly.io**:
```sh
cd solver && fly launch --no-deploy   # creates fly.toml from the Dockerfile
fly secrets set SOLVER_API_KEY=YOUR_LONG_RANDOM_KEY
fly deploy
```

**Render**: New → Web Service → repo, Root Directory `solver`, Runtime Docker, add
env var `SOLVER_API_KEY`. Render injects `$PORT` automatically.

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
The model covers a single rotation week (`week_labels: [null]`) plus fixed
Big-Group sessions. A/B and AA/BB two-week demand is a documented extension: pass
`week_labels: ["A","B"]` and split the per-pair demand across weeks (TODO in the
spec builder). The single-week solver already drives class_repeats, subject_gap,
and clustering to their true floor — the dominant quality levers.
