## Goal

Apply the pending `20260707000000_specialist_meeting.sql` migration (adds `schools.specialist_meeting jsonb`) and redeploy every edge function that needs to pick up the current engine/schema.

## Steps

1. **Run migration** `20260707000000_specialist_meeting.sql` via the migration tool. It only adds one nullable JSONB column to `public.schools` — no new table, so no GRANT/RLS changes needed. After approval Supabase types regenerate automatically.

2. **Redeploy edge functions** (single `supabase--deploy_edge_functions` call, all names in one array):
   - Schema/engine consumers referenced in the request:
     - `generate-schedule`
     - `generate-cpsat`
     - `run-generation-job`
     - `parse-calendar`
     - `parse-contractual-minutes`
     - `parse-recess-nl`
   - Other `_engine/` copy consumers (per `scripts/sync-engine.sh`):
     - `refine-schedule`
     - `improve-quality`
     - `verify-schedule`
     - `schedule-chat`
     - `resolve-conflicts-ai`
     - `update-scoring-weights`

## Notes / non-goals

- No code edits. Engine copies under each function's `_engine/` are assumed already in sync (canonical source: `supabase/functions/generate-schedule/`). If you also want me to run `bash scripts/sync-engine.sh` first to guarantee no drift before redeploy, say so and I'll add it as step 0.
- No frontend changes. Wiring a UI to read/write `schools.specialist_meeting` and the engine logic to honor it are separate follow-ups — this plan only lands the column + redeploys.
