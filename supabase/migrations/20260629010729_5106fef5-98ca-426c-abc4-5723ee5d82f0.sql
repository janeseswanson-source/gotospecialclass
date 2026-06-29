ALTER TABLE public.schedule_generations
  ADD COLUMN IF NOT EXISTS refined_from_generation_id uuid REFERENCES public.schedule_generations(id) ON DELETE SET NULL;

ALTER TABLE public.scoring_weight_profiles
  ADD COLUMN IF NOT EXISTS proposed_weights jsonb,
  ADD COLUMN IF NOT EXISTS proposed_at timestamptz;

ALTER TABLE public.schedule_generations
  ADD COLUMN IF NOT EXISTS quality_confidence jsonb;