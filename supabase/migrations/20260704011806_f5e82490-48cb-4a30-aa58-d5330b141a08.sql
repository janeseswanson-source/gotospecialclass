-- 20260703000000_quotes
CREATE TABLE IF NOT EXISTS public.quotes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  audience     TEXT NOT NULL DEFAULT 'teachers'
                 CHECK (audience IN ('teachers','students','both')),
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.quotes TO authenticated;
GRANT ALL ON public.quotes TO service_role;
CREATE INDEX IF NOT EXISTS idx_quotes_school_recent ON public.quotes (school_id, created_at DESC);
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can read quotes" ON public.quotes;
CREATE POLICY "Members can read quotes" ON public.quotes FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND public.is_workspace_member(s.workspace_id))
);
DROP POLICY IF EXISTS "Members can add quotes" ON public.quotes;
CREATE POLICY "Members can add quotes" ON public.quotes FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND public.is_workspace_member(s.workspace_id))
);

-- 20260704000000_school_year_dates
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS school_year_start DATE,
  ADD COLUMN IF NOT EXISTS school_year_end   DATE;
COMMENT ON COLUMN public.schools.school_year_start IS 'First instructional day of the school year (anchors the week cycle). Nullable; falls back to school_year parsing.';
COMMENT ON COLUMN public.schools.school_year_end   IS 'Last instructional day of the school year (bounds the week cycle). Nullable; falls back to school_year parsing.';

-- 20260705000000_rate_limits
ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_feature_recent
  ON public.ai_usage_log (user_id, feature, created_at DESC);
COMMENT ON COLUMN public.ai_usage_log.user_id IS 'Caller (for per-user rate limiting). Nullable for legacy/service rows.';

-- 20260705010000_generation_retention (parenthesized UNION arms to allow ORDER BY inside DISTINCT ON)
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
    (SELECT id FROM public.schedule_generations WHERE review_state = 'accepted')
    UNION
    (SELECT DISTINCT ON (school_id) id
       FROM public.schedule_generations
       ORDER BY school_id, version DESC NULLS LAST, created_at DESC)
    UNION
    (SELECT refined_from_generation_id
       FROM public.schedule_generations
       WHERE refined_from_generation_id IS NOT NULL)
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
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-old-generations') THEN
      PERFORM cron.unschedule('prune-old-generations');
    END IF;
    PERFORM cron.schedule('prune-old-generations', '0 4 * * 0', 'SELECT public.prune_old_generations();');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (%). Run prune_old_generations() from an external scheduler instead.', SQLERRM;
END
$do$;

-- 20260705020000_health_rpc
CREATE OR REPLACE FUNCTION public.pg_realtime_has_table(p_table text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = p_table
  );
$$;
REVOKE ALL ON FUNCTION public.pg_realtime_has_table(text) FROM PUBLIC, anon, authenticated;

-- 20260705030000_health_rpc_grant
GRANT EXECUTE ON FUNCTION public.pg_realtime_has_table(text) TO service_role;
