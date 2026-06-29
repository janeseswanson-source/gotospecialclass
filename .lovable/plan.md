## Plan

1. **Store secrets** via `secrets--set_secret` (values provided, no user form needed):
   - `CPSAT_SOLVER_URL` = `https://contained-shorter-charter-corporations.trycloudflare.com`
   - `CPSAT_SOLVER_KEY` = `b246df70973824ac5163bcf5fb8011e1e7a33fa25123b57c`

2. **Deploy edge function** `generate-cpsat` via `supabase--deploy_edge_functions`.

3. **Frontend** auto-deploys from main on next publish; no code changes required.

No scheduling/scoring logic touched. If secrets were ever unset, `generate-cpsat` returns 503 and the client falls back to the existing generator.