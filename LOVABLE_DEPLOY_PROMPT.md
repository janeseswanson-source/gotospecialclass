# Lovable deploy prompt (paste into Lovable after merging to main)

Copy everything in the block below into Lovable. It tells Lovable to apply the new
database migrations, deploy the new/updated edge functions with the right JWT
settings, and (optionally) wire the secrets.

---

Apply all pending Supabase database migrations and deploy the edge functions for
the changes just merged to main. Specifically:

**1. Run these new migrations (in filename order):**
- `20260703000000_quotes.sql` — `quotes` table + RLS (AI motivational quotes)
- `20260704000000_school_year_dates.sql` — adds `school_year_start` / `school_year_end` to `schools`
- `20260705000000_rate_limits.sql` — adds `user_id` + index to `ai_usage_log` (per-user rate limiting)
- `20260705010000_generation_retention.sql` — `prune_old_generations()` + weekly pg_cron job
- `20260705020000_health_rpc.sql` — `pg_realtime_has_table()` helper for the health check
- `20260705030000_health_rpc_grant.sql` — grants EXECUTE on that helper to `service_role`

If pg_cron isn't enabled on my plan, the retention migration is written to no-op
gracefully — that's expected; I'll schedule `prune_old_generations()` externally.

**2. Deploy these NEW edge functions with the JWT setting shown:**
- `generate-quote` — verify_jwt = true
- `generate-lesson-starter` — verify_jwt = true
- `health` — verify_jwt = true
- `parse-teacher-roster` — verify_jwt = false (self-authenticates via forwarded JWT)
- `parse-recess-nl` — verify_jwt = false

**3. Redeploy these EXISTING edge functions (they were changed):**
`parse-calendar`, `parse-clubs-nl`, `parse-contractual-minutes`,
`parse-specialist-template`, `parse-coordinator-prep`, `schedule-chat`,
`run-generation-job`, `generate-schedule` — they now use the fast model tier,
per-user rate limiting, and Sentry error reporting.

(The exact verify_jwt values are already in `supabase/config.toml` — use those.)

**4. Secrets (set these in the Supabase Edge Function secrets):**
- `SENTRY_DSN` — (optional) my Sentry project DSN, to turn on edge-function error
  reporting. Leave unset to keep it off.
- `CPSAT_SOLVER_URL` and `CPSAT_SOLVER_KEY` — I'll set these later once my Render
  CP-SAT solver is deployed. Until then the app correctly falls back to the JS
  solver, so leave them unset for now.
- Confirm `ANTHROPIC_API_KEY` is already set (all AI features + the new
  generate-quote / lesson-starter / parsers depend on it).

After applying, confirm: the migrations succeeded, all functions are deployed, and
the `health` function returns 200 for a signed-in user.

---
