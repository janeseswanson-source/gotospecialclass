ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS lead_specialist_id uuid,
  ADD COLUMN IF NOT EXISTS sessions jsonb NOT NULL DEFAULT '[]'::jsonb;