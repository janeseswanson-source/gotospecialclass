ALTER TABLE public.schedule_generations
  ADD COLUMN IF NOT EXISTS chosen_strategy text,
  ADD COLUMN IF NOT EXISTS attempted_strategies jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fallback_reason text;