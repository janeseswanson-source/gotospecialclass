-- AI-generated motivational quotes, per school. The old flow froze one static
-- quote per school (a deterministic index) and picked PDF footer quotes by ISO
-- week. This table is the new source: generate-quote appends an ORIGINAL line
-- (never a real person's words), the app reads the latest per school, and
-- exports are reproducible because the chosen line is persisted.

CREATE TABLE IF NOT EXISTS public.quotes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  audience     TEXT NOT NULL DEFAULT 'teachers'
                 CHECK (audience IN ('teachers','students','both')),
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Latest-per-school lookups (QuoteBanner, exports) + the "avoid last 10" query.
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
