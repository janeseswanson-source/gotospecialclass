## Plan

1. **Add safe solver-call diagnostics**
   - Update `generate-cpsat` to log non-secret credential metadata before calling `/solve`:
     - solver URL origin/host only
     - whether `CPSAT_SOLVER_KEY` is present
     - key length and first/last 4 characters only
   - Never log the full key.

2. **Log the solver response shape**
   - When `/solve` returns an error-like response or `MODEL_INVALID`, log:
     - HTTP status
     - returned solver `status`
     - first 300 characters of the solver message/body
   - This will confirm whether the local service is receiving the expected key or returning `MODEL_INVALID` for another validation path.

3. **Make solver-auth failures explicit**
   - If the solver returns `MODEL_INVALID` with message `Unauthorized`, return a backend error like:
     ```text
     CP-SAT solver authorization failed
     ```
   - This avoids mislabeling it as a model/spec validation problem.

4. **Deploy and retest the function**
   - Deploy `generate-cpsat` so the diagnostics and error classification are live.
   - Ask you to retry Generate once.
   - Then inspect fresh logs to determine the exact mismatch.

5. **Apply the final auth fix from the log signal**
   - If the key metadata shows the wrong/missing value: update `CPSAT_SOLVER_KEY` through the secure secret form.
   - If the URL host is wrong: update `CPSAT_SOLVER_URL` again to the active ngrok URL.
   - If the solver expects a different auth header on `/solve`: update the request header format in `generate-cpsat` and redeploy.

## Technical details

- The app already sends `Authorization: Bearer <CPSAT_SOLVER_KEY>` to `/solve`.
- The current user-facing error is produced when the solver returns JSON with:
  ```text
  status = MODEL_INVALID
  message = Unauthorized
  ```
- That means the backend is reaching something at `/solve`; the remaining issue is whether it is the right tunnel, the right key value, or the exact header format expected by the local solver.