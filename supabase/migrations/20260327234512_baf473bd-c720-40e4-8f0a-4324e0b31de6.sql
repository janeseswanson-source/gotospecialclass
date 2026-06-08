ALTER TABLE public.classroom_teachers
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS weekly_planning_minutes integer DEFAULT 0;