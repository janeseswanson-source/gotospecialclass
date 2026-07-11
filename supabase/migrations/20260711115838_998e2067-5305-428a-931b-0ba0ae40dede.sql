-- One-time cleanup of garbage labels in schools.recess_grade_bands.
UPDATE public.schools
SET recess_grade_bands = cleaned.bands
FROM (
  SELECT s.id,
         jsonb_agg(
           CASE
             WHEN coalesce(elem->>'label', '') = ''
               OR elem->>'label' = elem->>'key'
               OR elem->>'label' ~* '^band_[a-z0-9]+$'
               OR lower(elem->>'label') IN ('am recess', 'lunch', 'pm recess')
             THEN jsonb_set(
               elem,
               '{label}',
               to_jsonb(
                 CASE
                   WHEN jsonb_typeof(elem->'grades') = 'array' AND jsonb_array_length(elem->'grades') > 1
                     THEN (elem->'grades'->>0) || '–' || (elem->'grades'->>(jsonb_array_length(elem->'grades') - 1))
                   WHEN jsonb_typeof(elem->'grades') = 'array' AND jsonb_array_length(elem->'grades') = 1
                     THEN elem->'grades'->>0
                   ELSE 'Group'
                 END
               )
             )
             ELSE elem
           END
           ORDER BY ord
         ) AS bands
  FROM public.schools s,
       jsonb_array_elements(s.recess_grade_bands) WITH ORDINALITY AS t(elem, ord)
  WHERE jsonb_typeof(s.recess_grade_bands) = 'array'
  GROUP BY s.id
) AS cleaned
WHERE public.schools.id = cleaned.id;