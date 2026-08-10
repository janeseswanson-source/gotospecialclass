-- Cap on how long a grade's TEACHER TEAM may be out of their classrooms
-- back-to-back (their classes at consecutive specials/wheel blocks).
--
-- PM requirement: teacher planning happens before/after school, so a wheel
-- that pulls (say) all of 5th grade out for most of a day leaves no classroom
-- teacher presence and the principal will object. Cap it — "no more than 90
-- minutes together, or 120". Default 120 (the permissive number) for every
-- school; NULL = no cap. Violations surface as ADVISORY warnings on schedule
-- generation/verification — they never block a schedule.
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS max_team_out_minutes integer DEFAULT 120;

-- PostgREST caches the schema. Without this, the column exists but the API
-- still answers PGRST204 ("Could not find the '...' column ... in the schema
-- cache") and every write carrying it fails. This migration shipped without
-- the NOTIFY and was never applied, which broke the Setup wizard in
-- production. Every column-adding migration must end with this line.
NOTIFY pgrst, 'reload schema';
