-- Rotations begin on a DATE, not on the first day of school.
--
-- PM: "1st day of school refers to students. Teachers go back before the first
-- day. Rotations may start at different times, usually the second week of
-- school. Probably need to set up a date entry for when rotations begin."
--
-- schools.school_year_start is the first STUDENT day; the specials wheel
-- typically starts a week or two later. Without this, week A/B labels were
-- anchored to a week in which no rotation ran.
--
-- rotations_week_anchor decides what Week A means:
--   'school_year'    - unchanged behaviour: labels count from the first
--                      instructional week (the default, so nothing shifts for
--                      any existing school).
--   'rotations_start'- Week A is the first week rotations actually run.
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS rotations_start_date date,
  ADD COLUMN IF NOT EXISTS rotations_week_anchor text NOT NULL DEFAULT 'school_year';

COMMENT ON COLUMN public.schools.rotations_start_date IS
  'First day the specials rotation runs (NULL = same as the first student day).';
COMMENT ON COLUMN public.schools.rotations_week_anchor IS
  'school_year | rotations_start — which week counts as Week A.';

NOTIFY pgrst, 'reload schema';
