-- 20260702000000_unique_generation_version
WITH dups AS (
  SELECT id, school_id,
         ROW_NUMBER() OVER (PARTITION BY school_id, version ORDER BY generated_at NULLS LAST, id) AS rn
  FROM public.schedule_generations
),
maxv AS (
  SELECT school_id, MAX(version) AS mv FROM public.schedule_generations GROUP BY school_id
),
to_fix AS (
  SELECT d.id, d.school_id,
         ROW_NUMBER() OVER (PARTITION BY d.school_id ORDER BY d.id) AS bump
  FROM dups d
  WHERE d.rn > 1
)
UPDATE public.schedule_generations g
SET version = m.mv + t.bump
FROM to_fix t
JOIN maxv m ON m.school_id = t.school_id
WHERE g.id = t.id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'schedule_generations_school_version_unique'
  ) THEN
    ALTER TABLE public.schedule_generations
      ADD CONSTRAINT schedule_generations_school_version_unique UNIQUE (school_id, version);
  END IF;
END $$;

-- 20260702010000_generation_jobs
CREATE TABLE IF NOT EXISTS public.generation_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id           UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  requested_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','running','polishing','complete','failed','cancelled')),
  phase               TEXT,
  progress            JSONB NOT NULL DEFAULT '{}'::jsonb,
  best_generation_id  UUID REFERENCES public.schedule_generations(id) ON DELETE SET NULL,
  fallback_used       BOOLEAN NOT NULL DEFAULT false,
  fallback_reason     TEXT,
  error               TEXT,
  attempts            INT NOT NULL DEFAULT 0,
  started_at          TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.generation_jobs TO authenticated;
GRANT ALL ON public.generation_jobs TO service_role;
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON public.generation_jobs (status);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_school ON public.generation_jobs (school_id, created_at DESC);
ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can read generation jobs" ON public.generation_jobs;
CREATE POLICY "Members can read generation jobs" ON public.generation_jobs FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND public.is_workspace_member(s.workspace_id))
);
DROP POLICY IF EXISTS "Members can enqueue generation jobs" ON public.generation_jobs;
CREATE POLICY "Members can enqueue generation jobs" ON public.generation_jobs FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND public.is_workspace_member(s.workspace_id))
);
DROP POLICY IF EXISTS "Members can cancel generation jobs" ON public.generation_jobs;
CREATE POLICY "Members can cancel generation jobs" ON public.generation_jobs FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND public.is_workspace_member(s.workspace_id))
);
ALTER TABLE public.generation_jobs REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'generation_jobs'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.generation_jobs;
  END IF;
END $$;
