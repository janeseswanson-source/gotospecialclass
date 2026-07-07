-- Weekly all-specialists meeting (e.g. "Specialist Meets, Tue 1:15–2:00 PM").
-- Both engines reserve this window for every specialist working that day:
-- the JS engine pre-seeds occupancy + emits a "Specialist Meeting" block per
-- specialist; CP-SAT adds per-specialist busy windows so no class lands there.
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS specialist_meeting jsonb;
COMMENT ON COLUMN public.schools.specialist_meeting IS
  'Weekly all-specialists meeting, e.g. {"day":"Tue","start_time":"13:15","end_time":"14:00"}; null = none.';
