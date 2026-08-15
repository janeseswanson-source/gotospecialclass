-- Contract compliance: measure a week against the union contract's buckets.
--
-- The PM supplied the HSTA numbers and asked "Should we add contract info from
-- the district contract here?" Under Article VI Section CC there are two
-- categories with DIFFERENT weekly caps:
--
--   self-contained (classroom):  1415 instructional / 310 "other"
--   departmental  (specialists): 1285 instructional / 440 "other"
--   both: 225 prep, 150 lunch (in blocks of >= 30 continuous minutes)
--
-- Stored per school as JSON rather than hard-coded, because every district's
-- contract differs. Advisory only — nothing here ever blocks a schedule.
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS contract_profile text,
  ADD COLUMN IF NOT EXISTS contract_categories jsonb;

-- Which contract category a person falls under. NULL = use the school default
-- for their role (classroom teachers self-contained, specialists departmental).
ALTER TABLE public.classroom_teachers
  ADD COLUMN IF NOT EXISTS contract_category text;

ALTER TABLE public.specialists
  ADD COLUMN IF NOT EXISTS contract_category text;

COMMENT ON COLUMN public.schools.contract_profile IS
  'Name of the seeded preset, e.g. "hsta". Display only.';
COMMENT ON COLUMN public.schools.contract_categories IS
  'Per-category weekly limits + bucket rules. See src/lib/contractCompliance.ts.';

NOTIFY pgrst, 'reload schema';
