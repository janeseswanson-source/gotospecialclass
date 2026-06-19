# Coordinator Prep — Feedback Fixes

Three small changes to `src/pages/setup/CoordinatorPrep.tsx` based on your sticky-note annotations.

## 1. Active section indicator on the left rail
**Feedback:** "Keep the light on when at the area. Maybe add a triangle to show it as well."

Today the left-rail buttons highlight on hover only — no persistent "you are here" state. Add scroll-spy so the section the user is currently viewing stays highlighted and gets a small triangle pointer on its right edge.

- Add an `activeSection` state, default `'school-info'`.
- Use an `IntersectionObserver` on each `<section id=…>` to set `activeSection` when it enters the upper portion of the viewport.
- Style the active rail button with the cream/gold accent background, dark navy text, and a right-pointing triangle (▶ via a small absolutely-positioned `border` triangle) so the eye snaps to it.
- Clicking a rail button still scrolls and immediately marks that section active.

## 2. Clarify the "Waterfall" option
**Feedback:** "Waterfall = a rolling rotation of mismatched lessons" with the Period 1 (3A intro) → Period 3 (3B mid-unit) → Period 5 (3C end) example.

Today: `Waterfall — go K → 5 in order each day.` That description is misleading — Waterfall actually means same grade, different lesson days across each time block.

- Rewrite the Waterfall radio description to: **"Waterfall"** — *same grade, same day, totally different lesson days in each time block (e.g. Period 1 = 3A intro, Period 3 = 3B mid-unit, Period 5 = 3C wrap-up).*
- Add a third option **"Fixed Daily Sequence"** — *go K → 5 in order each day* (this is what the old "Waterfall" copy actually described — preserving the option, just under the right name).
- Update the PDF row label mapping in `buildRows` to match the three options.

## 3. Remove global Day / AM-PM preference from Schedule Preferences
**Feedback:** "REMOVE as this maybe a feature of each specialist not all."

The "Day preference for specialists" and "AM / PM preference" controls under Schedule Preferences treat all specialists as one. These already live per-specialist in the Specialists step of the wizard.

- Remove both controls from the Schedule Preferences section.
- Remove their rows from the PDF (`Day preference for specialists`, `AM / PM preference` in `buildRows`).
- Leave the underlying `day_preference` and `am_pm_preference` columns alone (no migration) so existing rows stay intact; the page just stops reading/writing them.

## Technical notes
- File: `src/pages/setup/CoordinatorPrep.tsx` only (plus its PDF doc `src/pdf/CoordinatorPrep.tsx` if `PrepRow` shape changes — it won't; we just drop rows).
- No DB schema change. No new dependencies. No changes to wizard/generator code.
- Triangle indicator: pure CSS via Tailwind (`after:` pseudo with border tricks) — no new icon import needed.

## Out of scope
- Per-specialist day/AM-PM editing UI (already exists in StepSpecialists).
- Visual redesign of the rail beyond the active state.
- Wiring the new "Fixed Daily Sequence" choice into the generator (it can read the same `grade_preference` column with the new value; generator-side handling is a follow-up if you confirm semantics).
