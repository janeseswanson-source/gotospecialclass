## Goal
Land the `coverage_relaxed` migration and redeploy the edge functions so the new quality-floor logic in `run-generation-job` (and the schema-consuming CP-SAT/parse functions) go live. The `specialist_meeting` migration was already applied last turn, so it's a no-op now.

## Steps
1. **Apply migration** `20260707150000_coverage_relaxed.sql` — adds `schedule_generations.coverage_relaxed boolean NOT NULL DEFAULT false`. Additive, no GRANT/RLS changes. Types regenerate after approval.
2. **Redeploy edge functions** in a single `supabase--deploy_edge_functions` call:
   - `generate-cpsat`
   - `generate-schedule`
   - `run-generation-job` (activates the quality floor)
   - `parse-calendar`
   - `parse-contractual-minutes`
   - `parse-recess-nl`
   - `parse-clubs-nl`
   - `parse-coordinator-prep`
   - `parse-specialist-template`
   - `parse-teacher-roster`

## Non-goals
- No code edits. Frontend redeploys automatically from main.
- `specialist_meeting` migration is already applied — skipping.
- Other `_engine/` consumers (refine-schedule, improve-quality, verify-schedule, schedule-chat, resolve-conflicts-ai, update-scoring-weights) were redeployed last turn and aren't in this request; leaving them alone.

Confirm the parse-function list above (I included all `parse-*` functions since you said "the parse functions" — tell me if you meant only the three from last turn).
