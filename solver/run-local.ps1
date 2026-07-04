# Run the CP-SAT solver locally on Windows (PowerShell).
#   cd solver ; ./run-local.ps1
# Then it serves http://127.0.0.1:8000  (GET /health, POST /solve).
# Leave SOLVER_API_KEY unset for local testing (no auth); set it to require a
# Bearer token, matching the CPSAT_SOLVER_KEY you'd give Supabase.
param(
  [int]$Port = 8000,
  [string]$BindHost = "127.0.0.1"
)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "Installing solver dependencies (ortools, fastapi, uvicorn)..." -ForegroundColor Cyan
python -m pip install -q -r requirements.txt

Write-Host "Starting CP-SAT solver on http://${BindHost}:${Port} (Ctrl+C to stop)" -ForegroundColor Green
python -m uvicorn app:app --host $BindHost --port $Port
