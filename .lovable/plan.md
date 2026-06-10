## Problem in the new PDF

Every grade is generating its own start-time grid, so the Master Schedule has a row for 7:45, 7:50, 8:05, 8:10, 8:15, 8:30, 8:35, 8:50, 8:55, 9:00, 9:05, 9:10, 9:15… Each class drifts because `buildTimeSlotsForGrade` (in `supabase/functions/generate-schedule/index.ts`) advances its own cursor using that grade's `passing + setup` times, which differ per grade/subject. The result: legitimate placements, but visually chaotic — and drag/drop reports "occupied" because target rows don't line up with source rows.

## Fix

Snap every generated block to a single **school-wide canonical slot grid** so the Master Schedule shows one tidy row per period across all grades and specialists.

1. **Build the canonical grid once per generation run** (not per grade):
   - Start at `school.start_time`.
   - Step = `defaultClassDuration + defaultPassingTime` (school-level defaults).
   - Skip any slot that overlaps a recess/lunch window applicable to anyone.
   - Stop at the day's end (early-release aware).
2. **Per grade, filter (not regenerate)**: take the canonical grid and drop slots that overlap that grade's specific recess/lunch windows or fall outside that grade's hours. Keep `start`/`end` identical to the canonical row so they align across grades.
3. **Per subject/specialist**, allow duration to differ but keep the slot **start** aligned to the canonical grid; end = start + that subject's duration. Reject candidates whose end pushes into the next canonical slot start minus the required passing buffer (existing back-to-back logic already handles this).
4. **Validator/UI** already uses the same scheduleGrid utilities — no change needed there once start times converge.

This is generator-only; the Master Grid page, exports, and drag/drop logic stay as-is and benefit automatically.

## Out of scope

- Drag/drop "occupied" UX (was already patched and will improve once rows align).
- Fix-with-AI timeout (already patched).
- Visual styling of the Master Schedule page.

## Technical detail

- File: `supabase/functions/generate-schedule/index.ts`.
  - Add `buildCanonicalSlotsForDay(day, school, allRecessWindows)` returning the shared `TimeSlot[]`.
  - Refactor `buildTimeSlotsForGrade` to take the canonical list and filter, instead of advancing its own cursor.
  - Keep existing `getEndMinForDay` and recess-window selection.
- Run existing unit/integration tests in `supabase/functions/generate-schedule/_*_test.ts`; they will surface any regression where a per-grade timing previously produced extra slots. Expected effect: slightly fewer total candidate slots → marginally lower density but uniform rows. Acceptable trade-off and what the user asked for.
- After the change, re-generate the King Kamehameha schedule in the app to verify the Master Schedule shows one row per canonical period (7:45, 8:30, 9:15, 10:00 …) instead of 13+ misaligned rows.
