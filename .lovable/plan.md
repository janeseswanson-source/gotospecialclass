## Plan: send the solver the body it actually expects

### Root cause
The external CP-SAT solver at `CPSAT_SOLVER_URL` expects a minimal body:
```json
{ "school_id": "…", "time_limit_s": 60 }
```
…and looks the school up in its own datastore. Our `generate-cpsat` edge function is instead POSTing the fully-built `spec` object (which has no top-level `school_id`), so the solver returns `MODEL_INVALID: "School not found"`.

### Change (single file)
`supabase/functions/generate-cpsat/index.ts`, in the `/solve` fetch call:

- Replace the body `JSON.stringify(spec)` with `JSON.stringify({ school_id, time_limit_s: typeof time_limit_s === "number" ? time_limit_s : 60 })`.
- Leave everything else untouched:
  - Local data loading (school, specialists, teachers, recess, clubs, weights) — still required for post-passes, mapping, validation, and persistence downstream.
  - `buildCpsatSpec(...)` call — still needed because the returned `adminBlocks`, `plusBlocks`, `lunchBlocks`, `strategies` feed the post-pass logic.
  - Auth header, response handling, `MODEL_INVALID` classification, block mapping, persistence, `schedule_generations` write.

### Not doing
- Secrets: `CPSAT_SOLVER_URL` and `CPSAT_SOLVER_KEY` are already set correctly per your message — no secret changes.
- No changes to the spec builder, post-passes, or persistence.
- No client/UI changes.

### Verify after implementation
1. Retry **Generate** from the app.
2. Check `generation_jobs` latest row — expect `status: complete` or, if the solver can't fit, an INFEASIBLE/NO_SOLUTION classification instead of "School not found".
3. Tail `generate-cpsat` logs for the new `solver request` / `solver http error` / `solver model invalid` entries added earlier.