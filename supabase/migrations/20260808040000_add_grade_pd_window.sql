-- Grade-level PD window: schedule the time a grade's teachers can meet.
--
-- PM: "Try to allow a block of time rotations the grade level is together for
-- PD." and "Out of class cap - principal will ask for 90 minutes for grade
-- levels to meet together. Can call that PD."
--
-- This is the TARGET that pairs with the existing max_team_out_minutes CAP:
-- aim for at least `grade_pd_target_minutes` of simultaneous release, but
-- never let one teacher be out longer than the cap.
--
-- grade_pd_quorum_pct handles over-rotated grades. When a grade has more
-- classes than there are specialists (her 5th grade: 5 classes, 4 specialists)
-- a 100% window is structurally impossible; 80 lets a 4-of-5 window count and
-- the report names the class still in session.
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS grade_pd_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS grade_pd_target_minutes integer NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS grade_pd_quorum_pct integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS grade_pd_label text;

COMMENT ON COLUMN public.schools.grade_pd_target_minutes IS
  'Minutes of simultaneous grade-team release to aim for (90 or 120 typically).';
COMMENT ON COLUMN public.schools.grade_pd_quorum_pct IS
  'Percent of a grade''s classes that must be out at once to count as a window.';
COMMENT ON COLUMN public.schools.grade_pd_label IS
  'What the school calls this block (e.g. "PD", "GLL Meeting"). Display only.';

NOTIFY pgrst, 'reload schema';
