ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS rotations_start_time TIME NULL,
  ADD COLUMN IF NOT EXISTS planning_time_when TEXT NOT NULL DEFAULT 'during_rotations';