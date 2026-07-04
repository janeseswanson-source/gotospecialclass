## Plan: redeploy the three schedule-generation edge functions

### Change
Redeploy from main via `supabase--deploy_edge_functions`:
- `generate-cpsat`
- `run-generation-job`
- `generate-schedule`

### About `SUPABASE_SERVICE_ROLE_KEY`
It's platform-injected into every edge function automatically — it does not appear in the user-managed secrets list (`fetch_secrets` only shows user secrets). It's confirmed present in the project's Supabase configuration, so `run-generation-job` and `generate-cpsat` can use it. No action needed.

### Verify
Retry Generate — should complete via CP-SAT (`chosen_strategy: "cpsat_optimal"`), with JS fallback if the Render solver is cold/unreachable.