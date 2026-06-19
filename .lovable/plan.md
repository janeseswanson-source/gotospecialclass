## Goal

1. Clean up the wizard Welcome step — keep only the PDF download for Coordinator Prep.
2. Ship a new branded **Specialist Schedule Planner — Master Admin View** in the app that mirrors your reference image exactly, rendered from the existing `schools` / `classroom_teachers` / `specialists` / `schedule_blocks` / `class_rotations` tables.
3. Add a one-click **Download as Master Admin XLSX** export that produces the 7-sheet workbook from your upload (Master Admin View + 6 data sheets), populated with the current school's data.
4. Support the **Planning & Prep triple rotation** (up to three stacked 30-min sub-rotations per day with A/B-week labels).

No database migration — the existing `class_rotations` table already has `slot_index`, `week_label`, and `rotation_type` columns that cover everything needed.

## 1. Welcome step cleanup (`StepWelcome.tsx`)

- Remove the "Download Template (XLSX)" button.
- Keep "Upload Filled Template" (still accepts `.xlsx`/`.csv` so digitized intake sheets work).
- The "Download printable PDF" link becomes the primary download CTA — promoted from secondary text to a real `<Button variant="outline">` matching the upload button's size.
- Copy updated: "Print the Coordinator Prep sheet, fill it in, then upload (typed or scanned) and the AI will auto-fill the wizard."

## 2. New branded view — `MasterAdminViewPage`

**Route:** `/app/schedule/admin-view` (new sidebar entry "Master Admin View" under Schedule, between "Master Schedule" and "Exports").

**Layout matches the reference image 1:1:**

```text
┌────────────────────────────────────────────────────────────────┐
│ [logo]  Specialist Schedule Planner            School: ______  │
│         Weekly Master View • Specialist Ops!   Year:   ______  │
├────┬────────┬─────────┬───────────┬──────────┬─────────────────┤
│    │ Monday │ Tuesday │ Wednesday │ Thursday │ Friday          │
├────┼────────┴─────────┴───────────┴──────────┴─────────────────┤
│ Planning and Prep   7:45 – 8:05                                │
│   [up to 3 stacked sub-rotation cards per day, A/B label]      │
├────────────────────────────────────────────────────────────────┤
│ Specialist rotation rows (one per schedule_blocks slot)        │
│   each cell: grade group • subject • teacher • A/B week badge  │
├────────────────────────────────────────────────────────────────┤
│ Recess / Lunch / Dismissal rows (banded gray, from blocks)     │
├────────────────────────────────────────────────────────────────┤
│ www.GoToSpecialClass.com    Next Specials Class    info@...    │
└────────────────────────────────────────────────────────────────┘
```

**Branding (matches your uploaded reference, uses existing tokens — no new colors):**

- Header band: `bg-card` with the NSC badge (`src/assets/logo.png`) at left, wordmark to its right in `text-primary` (navy), subtitle in `text-muted-foreground`, School/Year fields right-aligned with a thin underline.
- Day header row: `bg-secondary` with `text-primary font-semibold`, gold underline (`border-b-2 border-accent`).
- "Planning and Prep" band: navy fill (`bg-primary text-primary-foreground`).
- Grade-group banded rows (Recess / Lunch / Dismissal): `bg-muted/60`.
- Cell borders: `border-border` 1px. Subtle hover for editable cells.
- Footer band: light cream (`bg-secondary/60`), navy text, centered "Next Specials Class" with the small gold heart divider.
- Top of each Planning & Prep day cell shows a small `1st` / `3rd` rotation label in the existing gold (`text-accent`), exactly like the reference.

**Data wiring (no schema change):**

| Reference field | Source |
|---|---|
| School / Year | `schools` (school_name, current school_year) |
| Day header times | `schools.start_time` / `schools.end_time` |
| Planning & Prep block | `schedule_blocks` where `subject = 'Planning and Prep'` (or block-name match) |
| Planning & Prep sub-rotations | `class_rotations` where `rotation_type = 'planning_prep'`, ordered by `slot_index` (0/1/2), grouped by `day_of_week` and `week_label` |
| Specialist rotations | `schedule_blocks` joined with `specialists` (subject) and `classroom_teachers` (name) |
| Grade group label per row | derived from the block's `grade` / grade group |
| Recess / Lunch / Dismissal | `schedule_blocks` with matching block name keywords |

**Read flow:** A single `useQuery` loads schools, specialists, classroom_teachers, schedule_blocks (latest generation), and class_rotations for the active school. View is read-only this turn (editing already exists in `MasterSchedulePage`).

**Print-friendly:** dedicated `print:` Tailwind classes so `Cmd+P` reproduces the reference layout (hide sidebar, force landscape, page-break before footer).

## 3. Planning & Prep triple-rotation support

Existing `class_rotations` already has `slot_index` (0–2), `week_label` ("A" / "B" / null), and `rotation_type`. So no migration.

**Authoring (wizard):**

- New step section in `StepPlusRotation` (renamed in-section header to "Planning & Prep rotation"): per day-of-week, allow 1–3 sub-rotation rows. Each row has rotation label (e.g. "1st", "3rd"), start/end time, optional A/B week label, and 4 specialist→teacher pairings (Art/Tech/PE/Library by default, configurable).
- Persisted as 1–3 `class_rotations` rows per day with `rotation_type='planning_prep'`, `slot_index` 0/1/2, and `week_label`.

**Scheduler:** the generator already respects `class_rotations`; we just make sure the planning_prep type is treated as a fixed pre-block (passes through `generation_id`-aware insert).

**Master Admin View:** stacks up to 3 sub-rotation cards in the Planning & Prep cell per day with the gold rotation label and an "A/B" badge when present.

## 4. Master Admin XLSX export

New utility `src/lib/exportMasterAdminXlsx.ts` using the `xlsx` package (already in deps). Triggered from:

- A "Download Master Admin XLSX" button on the new view's toolbar.
- The existing `ExportsPage` (new card).

**Sheets produced (1:1 with your uploaded workbook):**

1. **Master Admin View** — full grid with merged cells, navy/gold styling, formulas-free, references baked in. Generated from the same data as the on-screen view.
2. **Schools** — one row, columns: `school_id, school_name, site_url, district, principal_name, principal_email, admin_contact, admin_email, phone, address, city, state, zip, timezone, regular_dismissal_time, early_dismissal_time, early_dismissal_day, notes`.
3. **Specialists** — `specialist_id, school_id, first_name, last_name, email, subject, room_number, uses_cart, is_part_time, part_time_days, serves_multiple_schools, second_school_id, grades_served, custom_grade_preference, notes`.
4. **Schedule Blocks** — `block_id, school_id, block_name, start_time, end_time, block_type, days_active, grade_group, notes`.
5. **Rotations** — `rotation_id, school_id, block_id, specialist_id, rotation_label, grade_group, classroom_teacher, day_of_week, room_or_location, week_pattern, start_date, end_date, notes`.
6. **Classrooms** — `classroom_id, school_id, teacher_first_name, teacher_last_name, teacher_email, grade, room_number, homeroom_label, student_count, special_notes`.
7. **PLUS Rotations** — `plus_id, school_id, plus_name, days_active, start_time, end_time, grades_included, specialist_id, notes` (sourced from any `class_rotations` rows where `rotation_type='plus'` plus any clubs marked as PLUS).

Field-name mapping where our DB columns differ from the workbook (e.g. `classroom_teachers.name` → split into `teacher_first_name` / `teacher_last_name`) is handled in the exporter — DB stays as-is.

## 5. Sidebar + routing

- Add `MasterAdminViewPage` route in `App.tsx`.
- Add sidebar item "Master Admin View" (icon: `LayoutGrid`) in `AppSidebar.tsx`.

## Out of scope

- No new database tables, no migration.
- No changes to the existing `MasterSchedulePage` editor — the new view is read-only and additive.
- No XLSX *import* path for the Admin View workbook (the Coordinator Prep upload remains the import flow).
- No edits to the scheduling engine beyond making sure planning_prep `class_rotations` survive into `schedule_blocks` for the generated week.

## Files

- `src/pages/setup/steps/StepWelcome.tsx` (remove XLSX button, promote PDF)
- `src/pages/schedule/MasterAdminViewPage.tsx` (new)
- `src/components/admin-view/*` (new — header, grid, prep-cell, footer)
- `src/lib/exportMasterAdminXlsx.ts` (new)
- `src/pages/setup/steps/StepPlusRotation.tsx` (extend authoring UI for triple rotation + A/B)
- `src/pages/schedule/ExportsPage.tsx` (add export card)
- `src/components/layouts/AppSidebar.tsx` (sidebar entry)
- `src/App.tsx` (route)
- Remove `public/templates/onboarding_template.xlsx` from the wizard UI references (file can stay on disk so old links don't 404).
