-- Async schedule-generation job queue. The client used to orchestrate best-of-N +
-- refine from the browser (dozens of edge calls it had to stay on the page for).
-- The CP-SAT-first pipeline moves that orchestration server-side: the client
-- ENQUEUES a job and subscribes to it over Realtime, so it can close the page while
-- the job runs. run-generation-job advances the job one bounded step per invocation
-- and self-chains, so no single request exceeds the edge CPU/wall limits.

CREATE TABLE IF NOT EXISTS public.generation_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id           UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  requested_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','running','polishing','complete','failed','cancelled')),
  -- Fine-grained step within status (client maps it to a progress label):
  --   cpsat | fallback_search | refine | done
  phase               TEXT,
  progress            JSONB NOT NULL DEFAULT '{}'::jsonb,
  best_generation_id  UUID REFERENCES public.schedule_generations(id) ON DELETE SET NULL,
  fallback_used       BOOLEAN NOT NULL DEFAULT false,
  fallback_reason     TEXT,
  error               TEXT,
  -- Monotonic step counter — powers the optimistic-concurrency guard (a step write
  -- only lands if `attempts` still matches what the worker read) so a double-fired
  -- continuation can never double-run a step.
  attempts            INT NOT NULL DEFAULT 0,
  started_at          TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Claim query filters on status; listing filters on school + recency.
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON public.generation_jobs (status);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_school ON public.generation_jobs (school_id, created_at DESC);

ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;

-- Workspace members of the job's school may read (to subscribe), enqueue, and cancel
-- their own jobs. The step worker uses the service role and bypasses RLS, so all
-- claim/step writes are unaffected by these policies.
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

-- Realtime: emit full row images on UPDATE so the client sees progress/status change,
-- and add the table to the supabase_realtime publication (idempotent).
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
