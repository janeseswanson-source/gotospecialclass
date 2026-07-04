-- Data lifecycle: prune stale schedule generations so a busy school's history
-- doesn't grow without bound. schedule_blocks cascade-delete with their generation.
--
-- We KEEP:
--   • any ACCEPTED generation (review_state = 'accepted'),
--   • the CURRENT (highest-version) generation per school,
--   • any generation referenced as a refined-from parent (the refinement chain),
--   • anything newer than 60 days.
-- Everything else — old, non-current, non-accepted drafts — is removed.

CREATE OR REPLACE FUNCTION public.prune_old_generations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  deleted_count integer;
BEGIN
  WITH keep AS (
    -- Accepted schedules are never pruned.
    SELECT id FROM public.schedule_generations WHERE review_state = 'accepted'
    UNION
    -- The current (latest version) generation per school.
    SELECT DISTINCT ON (school_id) id
      FROM public.schedule_generations
      ORDER BY school_id, version DESC NULLS LAST, created_at DESC
    UNION
    -- Any generation another one was refined FROM (preserve the chain).
    SELECT refined_from_generation_id
      FROM public.schedule_generations
      WHERE refined_from_generation_id IS NOT NULL
  ),
  del AS (
    DELETE FROM public.schedule_generations g
    WHERE g.created_at < now() - interval '60 days'
      AND g.id NOT IN (SELECT id FROM keep WHERE id IS NOT NULL)
    RETURNING g.id
  )
  SELECT count(*) INTO deleted_count FROM del;

  RAISE NOTICE 'prune_old_generations: deleted % generation(s)', deleted_count;
  RETURN deleted_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.prune_old_generations() FROM PUBLIC, anon, authenticated;

-- Best-effort weekly schedule via pg_cron. No-ops (with a NOTICE) where the
-- extension isn't available, so this migration is safe on any environment.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-old-generations') THEN
      PERFORM cron.unschedule('prune-old-generations');
    END IF;
    -- Sundays at 04:00 UTC.
    PERFORM cron.schedule('prune-old-generations', '0 4 * * 0', 'SELECT public.prune_old_generations();');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (%). Run prune_old_generations() from an external scheduler instead.', SQLERRM;
END
$do$;
