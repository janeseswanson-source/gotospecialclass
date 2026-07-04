# Cold-start-optimized image for the CP-SAT solver (Cloud Run / Render / Fly).
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Production deps only (pytest is intentionally NOT in requirements.txt) — a smaller
# image pulls + starts faster. Dep layer is cached across code-only changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code copied last so the (slow) dependency layer stays cached.
COPY solver.py app.py _memory.py ./

ENV PORT=8080
# Single uvicorn worker — CP-SAT already parallelizes internally via num_workers, so
# extra web workers only add memory + cold-start cost. --no-access-log trims per-request
# overhead. app.py imports solver (and ortools) at module load, so the FIRST request
# after a cold start is already warm; a keep-warm ping (see .github/workflows/keep-warm.yml)
# holds an instance during business hours when min-instances=0.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT} --workers 1 --no-access-log"]
