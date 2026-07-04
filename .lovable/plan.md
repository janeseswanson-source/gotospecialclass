## Plan

1. **Keep the existing solver key**
   - Do not change `CPSAT_SOLVER_KEY`, since you verified the current `b246…` key works against the local solver through ngrok.

2. **Set the solver URL secret to the fresh tunnel**
   - Update the backend runtime secret `CPSAT_SOLVER_URL` to:
     ```text
     https://ayaan-nonnitrogenized-undefinitely.ngrok-free.dev
     ```
   - This is the only required configuration change if the code already reads `CPSAT_SOLVER_URL` and `CPSAT_SOLVER_KEY` at request time.

3. **Retry generation**
   - Run Generate again from the app.
   - If it still fails, inspect the latest `generate-cpsat` / generation job logs for the exact downstream response.

4. **If Unauthorized persists**
   - Confirm the ngrok tunnel is still alive and still points to `127.0.0.1:8000`.
   - Confirm the local solver still accepts the same key on `/solve`.
   - If ngrok was restarted, update `CPSAT_SOLVER_URL` again because free tunnel URLs can change.

## Technical details

- No app code or database schema changes are needed for this fix.
- The likely failure mode is runtime configuration drift: the backend is calling an old tunnel URL, or the local solver/tunnel no longer matches the configured URL.
- Existing logs do not currently show a matching `Unauthorized` line, so the next failed Generate attempt will be the useful signal if the secret update alone does not resolve it.