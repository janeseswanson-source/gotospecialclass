ALTER TABLE public.schedule_generations
  ADD COLUMN IF NOT EXISTS coverage_relaxed boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.schedule_generations.coverage_relaxed IS
  'True when the solver had to drop the full-coverage floor: not every class could see every specialist this week (capacity-limited school).';