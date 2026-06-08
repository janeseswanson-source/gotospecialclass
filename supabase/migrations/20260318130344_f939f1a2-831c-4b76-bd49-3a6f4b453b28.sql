ALTER TABLE public.schools 
  ALTER COLUMN setup_time SET DEFAULT 15,
  ADD COLUMN IF NOT EXISTS grade_time_config jsonb DEFAULT '{}'::jsonb;