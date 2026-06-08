ALTER TABLE public.schedule_generations
  ADD COLUMN IF NOT EXISTS monte_carlo_attempts integer,
  ADD COLUMN IF NOT EXISTS winning_score double precision;