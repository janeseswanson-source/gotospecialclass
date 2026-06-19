# Simpler, modern UI for Scheduling Preferences + Recess & Lunch

Two clunky surfaces from the Setup Wizard get a focused rework. No data-model changes, no generator changes — purely UI/UX + label semantics.

---

## 1. Scheduling Preferences (StepSchoolInfo)

File: `src/pages/setup/steps/StepSchoolInfo.tsx`

**Rename** "Suggest extra PLT when feasible" → **"Open time slot"**
- Subtext: *"A shared free block in the week — the coordinator uses this for make-up teaching minutes (e.g. lunch clubs counted toward instructional time)."*
- Keep the toggle + the existing "Target extra minutes / week" field (relabel to "Target minutes / week").

**Add** a third row in the same Scheduling Preferences card: **"Daily sequence"**
- A small segmented selector (3 chips) mirroring the prep-sheet's `grade_preference`:
  - Keep grades together
  - Waterfall (same grade, different blocks/days)
  - Fixed K → 5 sequence
- Bound to `data.gradeSequence` (new wizard-data field, mirrors `coordinator_prep.grade_preference`). Persists alongside the other two prefs in the same auto-save.

Visual: three stacked rows with the same icon-left / toggle-or-chips-right layout used today, so the card feels uniform and not overwhelming.

---

## 2. Recess & Lunch (StepRecessLunch + PeriodCard)

The "Staggered by Grade" mode currently renders 3 wide cards × N rows × grade chips × start/end inputs side-by-side → too much on screen. Replace with a **count-first, auto-fill** flow.

Files: `src/pages/setup/steps/StepRecessLunch.tsx`, `src/pages/setup/steps/recessLunch/PeriodCard.tsx` (the latter gets a simpler row variant; old card retained only for Early-Release overrides which already works).

### New layout — single vertical column, three compact sections

```text
┌─ AM Recess ──────────────────────────────────┐
│  How many AM recess periods?  [ – ] 2 [ + ]  │
│  ─────────────────────────────────────────── │
│  #1   Grades [K] [1] [2]   Start 10:00  →    │
│       End 10:15  (auto)                      │
│  #2   Grades [3] [4] [5]   Start 10:20  →    │
│       End 10:35  (auto)                      │
└──────────────────────────────────────────────┘

┌─ Lunch ──────────────────────────────────────┐
│  How many lunch periods?      [ – ] 3 [ + ]  │
│  Default lunch length          [ 30 ] min    │
│  ─────────────────────────────────────────── │
│  #1   Grades [K] [1]   Start 11:00 → End 11:30 (auto) │
│  ...                                         │
└──────────────────────────────────────────────┘

┌─ PM Recess (auto from lunch) ────────────────┐
│  Follows each lunch group end + 0 min,       │
│  15-minute blocks.                           │
│  #1  Grades [K][1]   12:00 → 12:15           │
│  #2  Grades [2][3]   12:30 → 12:45           │
│  (read-only chips; tap row to override)      │
└──────────────────────────────────────────────┘
```

### Behavior

- **Mode toggle stays** (Whole School / Staggered by Grade) but defaults to Staggered when count > 1.
- **AM Recess**: stepper for count. Each row asks only **grades + start time**; end = start + 15 min, shown as a muted hint, editable on click ("override").
- **Lunch**: stepper for count + single "Default lunch length" input (defaults to 30, persisted to wizard data). Each row: grades + start; end auto = start + default length, editable on click.
- **PM Recess**: auto-derived from Lunch rows — same grade groupings, start = that group's lunch end, end = start + 15. Rendered as read-only chip rows with a small "override" affordance per row that reveals the same compact start/end inputs. If user overrides, that row stops auto-tracking lunch.
- **Grade-coverage warnings** (missing/duplicate) kept, moved to a single inline strip under each section.
- **Early-release overrides** stays exactly as-is in its existing collapsible — out of scope.
- Whole-School mode renders the same compact rows but with the grade chip set hidden and count locked to 1 per period.

### Auto-fill rules (single helper)

A small pure function `deriveRowTimes(startISO, durationMin)` shared by all three sections. PM-Recess auto-derivation reruns whenever lunch rows change unless that PM row's `overridden` flag is true.

### Persisted shape

No DB changes. Existing `recess_lunch_periods` rows still write `start`, `end`, `grades`, `bandKey`. New transient fields (`overridden`, default lunch length) live on wizard-data + are derived on save.

---

## Out of scope

- Generator logic, bell-schedule autopopulation from district calendar, "lunch clubs as make-up minutes" reporting (just a label/copy change here).
- Visual restyle of unrelated wizard steps.
- Migrations.

## Files touched

- `src/pages/setup/steps/StepSchoolInfo.tsx` — rename + new Sequence selector.
- `src/pages/setup/steps/StepRecessLunch.tsx` — new count-first layout, default-lunch-length input, PM auto-derivation.
- `src/pages/setup/steps/recessLunch/PeriodCard.tsx` — slimmer row variant + read-only/override PM mode.
- `src/pages/setup/setupData.ts` (or equivalent wizard-state file) — add `gradeSequence`, `defaultLunchMinutes`.
