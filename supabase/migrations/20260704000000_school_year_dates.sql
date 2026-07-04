-- Explicit school-year bounds for the dated week-cycle module (src/lib/weekCycle.ts).
-- Previously the cycle was inferred heuristically from the `school_year` TEXT
-- (e.g. "2025-2026" → Aug 25 … Jun 15). These columns let coordinators set the
-- real first/last instructional day so A/B and AA/BB week labels line up with the
-- calendar. Both are nullable; weekCycle falls back to parsing `school_year` when
-- they're absent, so this migration is backward-compatible.

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS school_year_start DATE,
  ADD COLUMN IF NOT EXISTS school_year_end   DATE;

COMMENT ON COLUMN public.schools.school_year_start IS 'First instructional day of the school year (anchors the week cycle). Nullable; falls back to school_year parsing.';
COMMENT ON COLUMN public.schools.school_year_end   IS 'Last instructional day of the school year (bounds the week cycle). Nullable; falls back to school_year parsing.';
