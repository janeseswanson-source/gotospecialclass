## Plan: fall back to the JS solver by unsetting the CP-SAT secrets

### Why
The current `CPSAT_SOLVER_URL` points at a placeholder solver that returns "School not found". The cleanest immediate fix is to remove the CP-SAT solver secrets so `generate-cpsat` returns `503 cpsat_unconfigured`, and the client falls back to the proven in-app JS solver (`generate-schedule`). All scheduling constraints stay intact; we just lose the CP-SAT optimality proof until a real solver URL is wired up.

### Change
Delete two runtime secrets via the secrets tool:
- `CPSAT_SOLVER_URL`
- `CPSAT_SOLVER_KEY`

No code, migration, or UI changes. The existing guard in `supabase/functions/generate-cpsat/index.ts` already returns `503 cpsat_unconfigured` when `CPSAT_SOLVER_URL` is missing, which the client treats as the signal to run the JS fallback.

### Verify
1. Retry **Generate** in the app.
2. Confirm the job completes via the JS path (no more "School not found" / `cpsat_model_invalid`).
3. When you're ready to bring CP-SAT back, re-add both secrets pointing at the real `solver/` service and generation will resume using it automatically.
