ALTER TABLE public.specialists
  ADD COLUMN IF NOT EXISTS plus_rotation jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS three_schools boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS third_school_name text,
  ADD COLUMN IF NOT EXISTS third_location text,
  ADD COLUMN IF NOT EXISTS days_at_second_school text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS days_at_third_school text[] DEFAULT '{}'::text[];