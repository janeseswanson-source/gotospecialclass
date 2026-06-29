## Plan

The secrets are already saved (visible in the secrets list: `CPSAT_SOLVER_URL`, `CPSAT_SOLVER_KEY`) and the `generate-cpsat` edge function source already exists at `supabase/functions/generate-cpsat/`. So this is a deploy-only request.

### Steps
1. **Verify/overwrite the two secrets** with the exact values provided using `secrets--set_secret` (idempotent — confirms current values match).
2. **Deploy `generate-cpsat`** via `supabase--deploy_edge_functions(["generate-cpsat"])`. This creates it if missing or redeploys if present.
3. **Frontend redeploy from main** via `preview_ui--publish` so the updated client that calls `generate-cpsat` goes live. Website-info preflight: already-relevant (no metadata changes this turn).

No code edits, no migrations, no scheduling/scoring logic changes — pure deploy.
