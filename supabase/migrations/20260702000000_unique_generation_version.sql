-- One schedule version number per school. generate-schedule / generate-cpsat /
-- refine-schedule each allocate the next version as MAX(version)+1; under
-- concurrent runs two could pick the same number. This UNIQUE(school_id, version)
-- makes the collision a hard DB error the inserters catch and retry (re-reading the
-- max), so versions never silently overwrite or duplicate.

-- First heal any pre-existing collisions (from before this constraint) by bumping
-- the extra rows in each duplicate (school_id, version) group to fresh trailing
-- versions, so the constraint can be added safely without renumbering good rows.
WITH dups AS (
  SELECT id, school_id,
         ROW_NUMBER() OVER (PARTITION BY school_id, version ORDER BY generated_at NULLS LAST, id) AS rn
  FROM public.schedule_generations
),
maxv AS (
  SELECT school_id, MAX(version) AS mv FROM public.schedule_generations GROUP BY school_id
),
to_fix AS (
  SELECT d.id, d.school_id,
         ROW_NUMBER() OVER (PARTITION BY d.school_id ORDER BY d.id) AS bump
  FROM dups d
  WHERE d.rn > 1
)
UPDATE public.schedule_generations g
SET version = m.mv + t.bump
FROM to_fix t
JOIN maxv m ON m.school_id = t.school_id
WHERE g.id = t.id;

-- Add the constraint idempotently (ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'schedule_generations_school_version_unique'
  ) THEN
    ALTER TABLE public.schedule_generations
      ADD CONSTRAINT schedule_generations_school_version_unique UNIQUE (school_id, version);
  END IF;
END $$;
