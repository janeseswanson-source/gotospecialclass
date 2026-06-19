ALTER TABLE public.coordinator_prep
  ADD COLUMN IF NOT EXISTS plus_mode text,
  ADD COLUMN IF NOT EXISTS plus_days text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS plus_rationale text;

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS plus_auto_fit boolean NOT NULL DEFAULT false;