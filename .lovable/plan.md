## Plan: resolve "CP-SAT rejected the model: School not found"

### Diagnosis
- The `Unauthorized` error is gone — the solver is now authenticating our requests.
- The external CP-SAT solver at `CPSAT_SOLVER_URL` returned `MODEL_INVALID` with message `"School not found"`.
- This message is produced by the **external solver service**, not by our edge function. Our function is correctly sending the school's data in the spec payload.
- The active school id is `8f9b400b-b235-49fa-870c-103bd2027afe`. The solver's registry does not include it.

### Action (no code change required)
1. **You**: register school id `8f9b400b-b235-49fa-870c-103bd2027afe` in the CP-SAT solver service (the process at your ngrok URL).
2. **You**: retry **Generate** from the app.
3. **If it still fails**: come back with the new error string and I'll investigate the next layer (spec payload shape, solver logs, etc.).

### Fallback if registration isn't possible right now
If registering the school on the solver isn't feasible in the short term, tell me and I'll switch the app to the non-CP-SAT heuristic generation path until the solver is provisioned. That would be a small code change gated behind a feature flag or a `CPSAT_ENABLED` secret.

### Why no code change now
The app is behaving correctly:
- Auth header is being sent.
- The spec includes the school payload the solver needs.
- The error is being surfaced clearly to the user (`cpsat_model_invalid` → visible message).

Editing our function won't teach the external solver about a school it hasn't been told about.