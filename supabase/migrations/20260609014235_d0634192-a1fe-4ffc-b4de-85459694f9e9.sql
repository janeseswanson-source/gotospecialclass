ALTER TABLE public.schedule_generations
  ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS chat_history jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS ai_explanations_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.schedule_blocks
  ADD COLUMN IF NOT EXISTS ai_explanation text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'schedule_generations_review_state_check'
  ) THEN
    ALTER TABLE public.schedule_generations
      ADD CONSTRAINT schedule_generations_review_state_check
      CHECK (review_state IN ('pending', 'accepted', 'rejected'));
  END IF;
END $$;