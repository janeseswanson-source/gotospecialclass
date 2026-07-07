-- When the CP-SAT solver cannot satisfy the full-coverage floor (a genuine
-- capacity wall) it re-solves without the floor and reports coverage_relaxed.
-- Persist that on the generation so the UI can tell the coordinator honestly
-- instead of just showing a lower quality %.
ALTER TABLE public.schedule_generations
  ADD COLUMN IF NOT EXISTS coverage_relaxed boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.schedule_generations.coverage_relaxed IS
  'True when the solver had to drop the full-coverage floor: not every class could see every specialist this week (capacity-limited school).';
