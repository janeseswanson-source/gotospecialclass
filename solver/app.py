"""HTTP wrapper around the CP-SAT solver (deploy this to Cloud Run / Fly / Render).

POST /solve  { ...problem spec... }  -> { status, blocks, objective, ... }
GET  /health -> { ok: true }

Auth: if the env var SOLVER_API_KEY is set, requests must send
`Authorization: Bearer <key>`. Leave it unset only for local testing.
"""
import os
from fastapi import FastAPI, HTTPException, Request
from solver import solve

app = FastAPI(title="GoToSpecialClass CP-SAT solver", version="1.0")

API_KEY = os.environ.get("SOLVER_API_KEY", "").strip()
# CP-SAT can chew a lot of CPU; cap the per-request time so a pathological spec
# can't hold a worker forever. The app also passes its own time_limit_s.
MAX_TIME_LIMIT_S = float(os.environ.get("SOLVER_MAX_TIME_S", "120"))
# CP-SAT parallel search workers. Fewer = lower memory (safer on small/free
# instances); more = faster proofs. The request may still override per-spec.
NUM_WORKERS = int(os.environ.get("SOLVER_NUM_WORKERS", "4"))


def _check_auth(request: Request) -> None:
    if not API_KEY:
        return
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer ") or header[7:].strip() != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/solve")
async def solve_endpoint(request: Request):
    _check_auth(request)
    try:
        spec = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    if not isinstance(spec, dict) or "classes" not in spec or "specialists" not in spec:
        raise HTTPException(status_code=400, detail="spec must include classes + specialists")
    # Clamp the time limit so a request can't run unbounded.
    try:
        spec["time_limit_s"] = min(float(spec.get("time_limit_s", 30)), MAX_TIME_LIMIT_S)
    except (TypeError, ValueError):
        spec["time_limit_s"] = 30.0
    # Default worker count from env unless the request explicitly set one.
    spec.setdefault("num_workers", NUM_WORKERS)
    try:
        return solve(spec)
    except Exception as e:  # never leak a stack trace to the client
        raise HTTPException(status_code=500, detail=f"solve failed: {e}")
