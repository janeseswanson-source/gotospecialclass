ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS specialist_meeting jsonb;
COMMENT ON COLUMN public.schools.specialist_meeting IS
  'Weekly all-specialists meeting, e.g. {"day":"Tue","start_time":"13:15","end_time":"14:00"}; null = none.';