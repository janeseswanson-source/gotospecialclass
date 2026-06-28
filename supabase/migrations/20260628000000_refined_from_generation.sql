-- Background refinement (Phase 1): a refined generation records which generation
-- it was derived from, so the UI can show "refined from v3" and compare.
ALTER TABLE public.schedule_generations
  ADD COLUMN IF NOT EXISTS refined_from_generation_id uuid REFERENCES public.schedule_generations(id) ON DELETE SET NULL;
