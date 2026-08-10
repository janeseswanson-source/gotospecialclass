-- The TEACHER work day is not the student day.
--
-- PM (Hawaii/HSTA): "Teachers in Hawaii have a 7 hour day. Some teachers start
-- at 7. I start at 7:45 and end at 2:45. 45 minutes at the end of the day is
-- planning time. It is a continuous time block. As per the teacher contract."
-- Students leave at 2:00; the specialist is on duty until 2:45. Measuring
-- planning availability against the STUDENT day therefore understates it by
-- exactly the contractual planning block.
--
-- All four columns are NULLABLE with no default: NULL means "same as the
-- student day", so every existing school keeps its current numbers and no
-- generated schedule shifts until a school fills these in.
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS teacher_day_start_time time,
  ADD COLUMN IF NOT EXISTS teacher_day_end_time time,
  ADD COLUMN IF NOT EXISTS teacher_planning_block_minutes integer,
  ADD COLUMN IF NOT EXISTS teacher_planning_block_when text;

COMMENT ON COLUMN public.schools.teacher_day_start_time IS
  'Contractual start of the teacher duty day (NULL = same as student start_time).';
COMMENT ON COLUMN public.schools.teacher_day_end_time IS
  'Contractual end of the teacher duty day (NULL = same as student end_time).';
COMMENT ON COLUMN public.schools.teacher_planning_block_minutes IS
  'Length of the guaranteed CONTINUOUS planning block, e.g. 45.';
COMMENT ON COLUMN public.schools.teacher_planning_block_when IS
  'Where that block sits: start_of_day | end_of_day | during_rotations.';

-- PostgREST caches the schema; without this the columns exist but the API
-- still answers PGRST204 and every write carrying them fails.
NOTIFY pgrst, 'reload schema';
