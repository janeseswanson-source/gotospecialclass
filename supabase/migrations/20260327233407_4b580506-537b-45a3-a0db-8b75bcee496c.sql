
ALTER TABLE public.specialists
  ADD COLUMN IF NOT EXISTS planning_type text DEFAULT 'within_school',
  ADD COLUMN IF NOT EXISTS weekly_planning_minutes integer DEFAULT 0;

ALTER TABLE public.classroom_teachers
  ADD COLUMN IF NOT EXISTS planning_minutes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lunch_minutes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS planning_type text DEFAULT 'within_school';
