## Fix: CP-SAT Unauthorized

The 401 is from a stale tunnel URL, not a key mismatch. Verified locally that the current key works against the new ngrok tunnel.

## Change

- Update the `CPSAT_SOLVER_URL` secret to:
  `https://ayaan-nonnitrogenized-undefinitely.ngrok-free.dev`
- Leave `CPSAT_SOLVER_KEY` unchanged (the `b246…` value).
- No code changes; edge functions read the secret at request time, so no redeploy needed.

## Verify

- Retry Generate from the app.
- If it still fails, pull `generate-cpsat` logs to see whether the solver returns 200 or a different error.

## Note

Ngrok free tunnels change URL every restart. Whenever the tunnel is restarted, `CPSAT_SOLVER_URL` will need to be updated again.
