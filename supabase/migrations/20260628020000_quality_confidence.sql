-- Surface the engine's confidence signal to the UI (frontend revamp, power 1).
-- The signal is already computed by _confidence.ts; this column lets the
-- generator + refiner persist it so the Master Schedule page can read it.
ALTER TABLE public.schedule_generations
  ADD COLUMN IF NOT EXISTS quality_confidence jsonb;
