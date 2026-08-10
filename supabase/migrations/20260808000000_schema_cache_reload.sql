-- No DDL. Forces PostgREST to drop a stale schema cache.
--
-- Belt-and-braces companion to 20260718000000_add_max_team_out_minutes.sql:
-- if that migration was applied at some point WITHOUT its NOTIFY (the version
-- that shipped originally had none), the column exists in Postgres but the
-- REST API still rejects writes with PGRST204. Running this fixes that without
-- touching any table.
--
-- Idempotent and safe to re-run at any time.
NOTIFY pgrst, 'reload schema';
