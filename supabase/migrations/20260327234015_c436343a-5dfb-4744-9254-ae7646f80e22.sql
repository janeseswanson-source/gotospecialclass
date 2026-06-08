ALTER TABLE public.specialists
  ADD COLUMN IF NOT EXISTS is_part_time boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS part_time_planning_minutes integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS part_time_lunch_minutes integer DEFAULT 20;