## Goal
Apply the six pending migrations and (re)deploy the listed edge functions from main. No code changes.

## Steps

1. **Apply migrations** (in order) via `supabase--migration`, one call per file, using the SQL already in `supabase/migrations/`:
   - `20260703000000_quotes.sql`
   - `20260704000000_school_year_dates.sql`
   - `20260705000000_rate_limits.sql`
   - `20260705010000_generation_retention.sql` (no-ops if pg_cron absent)
   - `20260705020000_health_rpc.sql`
   - `20260705030000_health_rpc_grant.sql`

   Note: the migration tracker also shows a gap for `20260628*`, `20260702*` files. I'll check whether those already ran (tables exist) before touching them — out of scope unless the user wants them included.

2. **Deploy edge functions** in one `supabase--deploy_edge_functions` call:
   - New: `generate-quote`, `generate-lesson-starter`, `health`, `parse-teacher-roster`, `parse-recess-nl`
   - Redeploy: `parse-calendar`, `parse-clubs-nl`, `parse-contractual-minutes`, `parse-specialist-template`, `parse-coordinator-prep`, `schedule-chat`, `run-generation-job`, `generate-schedule`
   
   `verify_jwt` values already live in `supabase/config.toml` and will be picked up automatically.

3. **Secrets**
   - `ANTHROPIC_API_KEY` — already present (confirmed in project secrets list). No action.
   - `SENTRY_DSN` — optional; I'll skip unless you say to add it (needs a value from you via `add_secret`).
   - `CPSAT_SOLVER_URL` / `CPSAT_SOLVER_KEY` — leave as-is per your instructions.

4. **Verify**
   - Query `information_schema` to confirm `quotes` table, `schools.school_year_start`, `ai_usage_log.user_id`, and `pg_realtime_has_table` function exist.
   - Call the `health` edge function with an anon key — a 401 confirms JWT verification is on and it deployed cleanly (a signed-in 200 requires a real user session I don't have here; I'll note this for you to spot-check).

## Out of scope
No scheduling/scoring logic changes. No frontend redeploy (backend-only request). No CPSAT secret changes.
