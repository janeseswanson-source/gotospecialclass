-- Some specials are attended WITH the classroom teacher.
--
-- PM: "Also can opt for a class teacher to go with their class to that
-- specialist. IE Tech, Library or Garden." and "A teacher may be asked to go to
-- the class with students so it is not a prep minutes unequal use of time
-- (Library or Garden)."
--
-- When the classroom teacher stays with the class, the block is NOT their
-- planning time — counting it as prep overstates their contractual planning
-- and hides a real shortfall. It also means the grade's teachers are not free,
-- so the block cannot count toward a grade-level PD window.
ALTER TABLE public.specialists
  ADD COLUMN IF NOT EXISTS teacher_accompanies boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.specialists.teacher_accompanies IS
  'True when the classroom teacher stays with their class for this specialist. '
  'Such blocks do not count as teacher planning time and do not free the grade team.';

NOTIFY pgrst, 'reload schema';
