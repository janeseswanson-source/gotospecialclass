## Plan: point CP-SAT at the Render solver and redeploy

### Change
1. Set two runtime secrets via `secrets--set_secret`:
   - `CPSAT_SOLVER_URL` = `https://cpsat-solver.onrender.com`
   - `CPSAT_SOLVER_KEY` = `lTrcNomrPEH7Ew/Pb0JZMS07hPPAjyAJM/uXaEhaAP8=`
   
   Note: `set_secret` only creates new secrets. Since we just deleted both, this will create them fresh. No trailing slash / `/solve` — `generate-cpsat` appends `/solve` itself.

2. Redeploy `generate-cpsat` and `run-generation-job` via `supabase--deploy_edge_functions` so they pick up the new secrets and the latest fallback code.

### Verify
Retry **Generate** in the app — it should route through CP-SAT (`chosen_strategy: "cpsat_optimal"`). If Render's free instance is cold or unreachable, the client automatically falls back to the JS solver (`generate-schedule`).

### Notes
No code, migration, or UI changes.