-- Helper for the /health edge function: is a table in the supabase_realtime
-- publication? SECURITY DEFINER so the service-role caller can read the catalog.
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
