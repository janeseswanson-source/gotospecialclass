# Period-card rewrite of StepRecessLunch

Flip the step's mental model: instead of "pick a band, then fill in AM/Lunch/PM times for it", users see **period cards** (AM Recess, Lunch, PM Recess). Each card lists one row per grade group with start/end times. Staggered lunch becomes "add a second Lunch row". Storage stays on the existing `recess_lunch_config` + `schools.recess_grade_bands` columns — no schema/migration changes.

## New UI shape

Render three top-level period cards (Lucide icons + amber accents matching the master-grid amber rows):

```
┌─ AM Recess ─────────────────────────────────┐
│  Whole school        09:45 → 10:00   [✕]    │
│  + Add staggered row                         │
└──────────────────────────────────────────────┘

┌─ Lunch ─────────────────────────────────────┐
│  Early lunch  K, 1, 2     11:30 → 12:00 [✕] │
│  Late lunch   3, 4, 5, 6  12:00 → 12:30 [✕] │
│  + Add staggered row                         │
└──────────────────────────────────────────────┘

┌─ PM Recess ─────────────────────────────────┐
│  (empty — + Add row)                         │
└──────────────────────────────────────────────┘
```

Each row inside a card has: editable label, grade-chip multi-select, start time, end time, delete. The label is what the master grid will display in the amber bar (e.g. "Late lunch · 3-6").

Mode toggle (Whole School / Staggered) stays at the top:
- **Whole School** → each card collapsed to a single row whose grade chips are read-only and equal "All grades served". Adding a second row auto-flips the mode to Staggered.
- **Staggered** → multiple rows allowed; chip selectors are editable.

Early-Release section becomes one collapsible block below the three cards, mirroring the same three periods but with per-row override times. Auto-shown only when an early-release day exists.

Validation banner (existing) stays — recomputed against the row shape: unassigned grades for any period, overlapping rows that cover the same grade twice in the same period, empty rows.

## Data model bridge (no migrations)

The component owns one in-memory structure derived from the existing tables:

```ts
type PeriodKey = 'amRecess' | 'lunch' | 'pmRecess';
type PeriodRow = {
  rowId: string;          // ui-stable
  bandKey: string;        // existing recess_lunch_config.grade_band
  label: string;          // mirrors schools.recess_grade_bands[i].label
  grades: string[];       // mirrors schools.recess_grade_bands[i].grades
  start: string;
  end: string;
  erStart?: string;       // early-release override
  erEnd?: string;
};
type CardsState = Record<PeriodKey, PeriodRow[]>;
```

**Hydration** (replaces the current `useEffect` loader): for every existing `recess_lunch_config` row, emit up to three `PeriodRow`s (one per period) reusing the same `bandKey`. Pull `label`/`grades` from `schools.recess_grade_bands` by key; fall back to `DEFAULT_BAND_TEMPLATE` if missing.

**Persistence** (replaces current `autoSave`): on debounce, collect every unique `bandKey` across cards. For each one, build a single `recess_lunch_config` row by reading that bandKey's row out of each period card (its start/end → `am_recess_start/end`, `lunch_start/end`, `pm_recess_start/end`, plus the matching `early_release_*` columns). Then upsert/selective-delete that table (keeps stable UUIDs per the project's existing pattern). Update `schools.recess_grade_bands` from the union of distinct `{ key, label, grades }` triples. Reuses the existing `autoSave` debounce timer + `useFlushOnUnmount`.

Because the row's `bandKey` survives edits, the master-grid label map (`recess_grade_bands` → custom labels, already wired last turn) automatically shows the new period labels in the amber bands.

## Files

- **Rewrite** `src/pages/setup/steps/StepRecessLunch.tsx` — full UI swap, new state shape, hydration + autosave bridge as above. Keep all imports (`SaveStatusIndicator`, `useFlushOnUnmount`, `SETUP_STEPS`, `useSetup`, `FieldLabel`, `Collapsible`).
- **Extract** `src/pages/setup/steps/recessLunch/PeriodCard.tsx` — presentational card that renders one period's rows with chip multi-select + time inputs. Keeps the main file under ~350 lines.
- **No changes** to `scheduleGrid.ts`, `MasterSchedulePage.tsx`, the migration, or any other step. The amber label plumbing built last turn keeps working because we're still writing the same `recess_grade_bands` shape.

## Edge cases handled

- Switching Whole School → Staggered keeps existing times; reverse collapses to the first row and warns if data would be lost.
- Deleting the last row of a period clears the corresponding columns in that bandKey's `recess_lunch_config` row but leaves the row intact for other periods.
- New bandKey generated with `band_<rand>` to stay compatible with the existing format used elsewhere.
- A band that ends up with zero rows across all three periods is removed from `recess_grade_bands` on save.

## Out of scope

- Schema changes.
- Engine/generator behavior.
- Any other wizard step.
