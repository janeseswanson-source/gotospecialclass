# Finish the wizard rework (3 remaining items)

## 1. Recess & Lunch card rework + matching grid labels

Rework `StepRecessLunch.tsx` from per-grade time tables into **period-grouped cards**, and surface the same labels on the master grid.

**Period cards (instead of per-band time rows)**
- One card per *period*: `AM Recess`, `Lunch` (early), `Lunch` (late), `PM Recess`. Cards are added/removed, not fixed.
- Each card has: editable label, single start/end time pair, grade-chip multi-select, optional Early-Release override times, delete.
- "Whole School" mode = exactly one card per period covering all grades; switching to "Staggered" splits Lunch into Early/Late presets seeded from current bands.
- Keep auto-save + validation (overlap, unassigned grades, empty card) but framed per-card.
- Storage shim: convert period-cards ↔ existing `recess_lunch_config` rows (one row per `grade_band`, where a band is derived from the union of cards covering those grades). No schema change.

**Matching grid-cell labels**
- `MasterSchedulePage` already feeds `recessBands` into `ScheduleGrid`. Update the band label builder to use each card's editable label verbatim (e.g. "Early Lunch · K–2") instead of the raw band key, and render multiple amber rows when staggered groups overlap a slot.
- `ScheduleGrid.tsx` band row stays the same visually; just receives richer labels.

## 2. Persistent wizard shell across all 11 steps

Create `src/components/setup/WizardStepShell.tsx`:
- Two-column inner layout (left rationale rail + right form column) that every step renders inside.
- Props: `title`, `rationale` (short why-this-matters paragraph + bullets), `aiActions?` (slot for "AI fill", "Recommend", "Parse from text" buttons surfaced per step), `footer` (Back / Continue / Save status).
- Sticky save-status indicator and step-level error summary moved out of each step.

Refactor each step to return `<WizardStepShell …>{form}</WizardStepShell>`:
`StepWelcome`, `StepSchoolInfo`, `StepCalendarUpload`, `StepRecessLunch`, `StepSpecialists`, `StepTeachers`, `StepContractualMinutes`, `StepAdminRotation`, `StepClubs`, `StepEvents`, `StepConflict`, `StepReview`.

The outer `SetupWizardContent.tsx` left rail (numbered stepper) stays; the shell sits inside the right column so the rail is always visible and the new per-step rationale rail nests cleanly. Mobile keeps the existing `<Select>` switcher — shell collapses to single column under `sm`.

Per-step AI hooks surfaced in `aiActions` (all already-built functions, just wiring):
- Specialists/Teachers → existing `process-onboarding-template` upload button.
- Contractual Minutes → existing PDF upload flow.
- Conflict → "Recommend strategy" calling existing `analyzeFeasibility`.
- Clubs/Events → the new NL importer (item 3).
- Review → "Schedule readiness" score using existing feasibility helpers.

## 3. Wire `parse-clubs-nl` into Clubs & Events

Add a "Describe in plain English" entry point to both `StepClubs.tsx` and `StepEvents.tsx`.

Flow:
1. Button → opens `<NlImportDialog kind="clubs" | "events">` (new, `src/components/setup/NlImportDialog.tsx`).
2. Textarea (max 5000 chars) + Parse button → `supabase.functions.invoke('parse-clubs-nl', { body: { description, kind } })`.
3. Show returned `rows` in an editable confirm table:
   - Clubs columns: Name, Day, Start, End, Grades (chips), Leader (specialist dropdown), Location.
   - Events columns: Name, Date, Start, End, Grades, Notes.
   - Each row has Include/Exclude toggle; bulk Include-all.
4. **Import selected** → reuses each step's existing `persistClub` / event upsert paths (one call per row) so validation + auto-save behaviour stays identical. Leader strings are matched to existing specialists by case-insensitive name; unmatched → `null` with a small warning chip.
5. Toast with count imported + skipped.

Edge function already deployed; no backend changes. Add a small `parseGrades` helper to normalize `"3-5"` / `"K,1,2"` strings to the grade chip array used by the steps.

## Technical notes

- No DB migrations.
- No new packages.
- Files created: `src/components/setup/WizardStepShell.tsx`, `src/components/setup/NlImportDialog.tsx`, possibly `src/components/setup/recessLunchCards.tsx` to keep `StepRecessLunch` readable.
- Files edited: all 12 step files, `SetupWizardContent.tsx` (minor — shell hosts the right column header), `MasterSchedulePage.tsx` (band label builder), `StepRecessLunch.tsx` (full rewrite of the band/time UI; persistence shim).
- Preserve every existing autosave hook, `useFlushOnUnmount` usage, and step-index navigation.

## Out of scope

- Generator/scheduling engine changes.
- Any new edge functions.
- Billing, exports, lesson planner.
