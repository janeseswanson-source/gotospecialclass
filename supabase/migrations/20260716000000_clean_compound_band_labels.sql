-- Second cleanup pass for schools.recess_grade_bands labels.
--
-- 20260711000000_clean_band_labels.sql fixed BARE garbage (label = key /
-- opaque band_ key / exact period name). But an older wizard hydration bug
-- AMPLIFIED labels — prepending the period name to the stored label on every
-- visit — producing COMPOUND garbage like
--   "AM Recess · AM Recess · … · band_o3re5m"
-- which matched none of the bare-form checks and survived that migration.
--
-- This pass mirrors the frontend's sanitizeBandLabel (src/lib/scheduleGrid.ts):
-- split the label on middots, drop segments that are empty / equal to the key /
-- opaque band_ keys / EXACT period-generic names ("AM Recess", "Lunch",
-- "PM Recess (group 2)" — never substrings, so "Lunch Bunch" survives),
-- dedupe case-insensitively, and rejoin. When nothing meaningful remains,
-- fall back to a grade-range name ("K–2"), a single grade, or 'Group'.
-- Idempotent: a second run finds sanitized == stored and changes nothing.
UPDATE public.schools
SET recess_grade_bands = cleaned.bands
FROM (
  SELECT s.id,
         jsonb_agg(
           CASE
             WHEN fix.sanitized IS DISTINCT FROM trim(coalesce(elem->>'label', ''))
               OR trim(coalesce(elem->>'label', '')) = ''
             THEN jsonb_set(
               elem,
               '{label}',
               to_jsonb(
                 CASE
                   WHEN fix.sanitized <> '' THEN fix.sanitized
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
  FROM public.schools s
  CROSS JOIN LATERAL jsonb_array_elements(s.recess_grade_bands) WITH ORDINALITY AS t(elem, ord)
  CROSS JOIN LATERAL (
    SELECT coalesce(string_agg(seg, ' · ' ORDER BY segord), '') AS sanitized
    FROM (
      SELECT seg, segord,
             row_number() OVER (PARTITION BY lower(seg) ORDER BY segord) AS rn
      FROM (
        SELECT regexp_replace(trim(raw.seg), '\s+', ' ', 'g') AS seg, raw.segord
        FROM unnest(string_to_array(coalesce(elem->>'label', ''), '·')) WITH ORDINALITY AS raw(seg, segord)
      ) trimmed
      WHERE seg <> ''
        AND seg IS DISTINCT FROM trim(coalesce(elem->>'key', ''))
        AND seg !~* '^band_[a-z0-9]+$'
        AND seg !~* '^(am recess|pm recess|recess|lunch)(\s*\(group [0-9]+\))?$'
    ) deduped
    WHERE rn = 1
  ) AS fix
  WHERE jsonb_typeof(s.recess_grade_bands) = 'array'
  GROUP BY s.id
) AS cleaned
WHERE public.schools.id = cleaned.id
  AND public.schools.recess_grade_bands IS DISTINCT FROM cleaned.bands;
