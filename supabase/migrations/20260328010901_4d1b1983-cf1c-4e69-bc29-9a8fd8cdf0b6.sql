ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS default_am_pm_preference text DEFAULT NULL;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS default_day_preference text DEFAULT NULL;