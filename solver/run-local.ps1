# Run the CP-SAT solver locally on Windows (PowerShell) as a real server that
# Lovable's cloud Supabase can reach through an ngrok tunnel.
#
#   cd solver ; ./run-local.ps1
#
# It serves http://127.0.0.1:8000 (GET /health, POST /solve) with:
#   * a STABLE API key (persisted in .solver-key.local, gitignored) so the
#     CPSAT_SOLVER_KEY you set in Supabase keeps working across restarts;
#   * SOLVER_MEMORY_MB / SOLVER_NUM_WORKERS set from THIS machine's RAM and cores,
#     so the solver uses your full laptop (no 512 MB free-tier limits);
#   * a generous time budget.
#
# Then, in a SEPARATE terminal, expose it:  ngrok http 8000
# and put the printed https URL + the key below into Supabase.
param(
  [int]$Port = 8000,
  [string]$BindHost = "127.0.0.1",
  [int]$MaxTimeS = 300      # generous per-solve cap for local testing
)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# ── Stable API key (create once, reuse across restarts) ──────────────────────
$KeyFile = Join-Path $PSScriptRoot ".solver-key.local"
if (Test-Path $KeyFile) {
  $ApiKey = (Get-Content $KeyFile -Raw).Trim()
} else {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $ApiKey = [Convert]::ToBase64String($bytes)
  Set-Content -Path $KeyFile -Value $ApiKey -NoNewline -Encoding ascii
  Write-Host "Generated a new solver API key -> .solver-key.local" -ForegroundColor Yellow
}

# ── Size the solver to THIS machine (use it all — no cloud constraints) ──────
$ramMb  = [int]([math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB))
$cores  = [int]$env:NUMBER_OF_PROCESSORS
if ($cores -lt 1) { $cores = 4 }
# Leave a little headroom for the OS; tell the solver it has most of the RAM so its
# memory-aware worker cap never throttles on your laptop.
$solverMemMb = [Math]::Max(2048, $ramMb - 1024)

$env:SOLVER_API_KEY   = $ApiKey
$env:SOLVER_MEMORY_MB = "$solverMemMb"
$env:SOLVER_NUM_WORKERS = "$cores"
$env:SOLVER_MAX_TIME_S  = "$MaxTimeS"

Write-Host "Installing solver dependencies (ortools, fastapi, uvicorn)..." -ForegroundColor Cyan
python -m pip install -q -r requirements.txt

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor DarkGray
Write-Host " CP-SAT solver on http://${BindHost}:${Port}" -ForegroundColor Green
Write-Host "   RAM detected : $ramMb MB   ->  SOLVER_MEMORY_MB = $solverMemMb" -ForegroundColor Gray
Write-Host "   CPU cores    : $cores      ->  SOLVER_NUM_WORKERS = $cores" -ForegroundColor Gray
Write-Host "   Max solve    : $MaxTimeS s" -ForegroundColor Gray
Write-Host ""
Write-Host " NEXT: in a SEPARATE terminal run:  ngrok http $Port" -ForegroundColor Cyan
Write-Host " Then set these Supabase Edge Function secrets:" -ForegroundColor Cyan
Write-Host "   CPSAT_SOLVER_URL = the https://xxxx.ngrok-free.app URL ngrok prints" -ForegroundColor White
Write-Host "   CPSAT_SOLVER_KEY = $ApiKey" -ForegroundColor White
Write-Host "=====================================================================" -ForegroundColor DarkGray
Write-Host " (Ctrl+C to stop the solver)" -ForegroundColor DarkGray
Write-Host ""

python -m uvicorn app:app --host $BindHost --port $Port
