# Coordinator Prep — Calendar simplification + Teacher Links section

## 1. Add "Teacher Links" section after School Info
**Feedback:** "ADD A SECTION ON TEACHER Union Link and Teacher CONTRACT OPTIONAL LINKs after school info."

New collapsible section between **School Info** and **Schedule Preferences** in the left rail.

- Section id: `teacher-links`, label: **Teacher Links**.
- Two optional URL inputs:
  - **Teacher Union Link** (e.g. https://localunion.org)
  - **Teacher Contract Link** (e.g. https://district.org/contract.pdf)
- Both fields are optional and autosave like the rest of the page.
- Surfaced as two rows in the printable Prep PDF.

## 2. Slim down the "Calendar & Holidays" section
**Feedback:** "This should be just adding the calendar maybe."

The District Calendar URL already lives in School Info, so this section currently duplicates that intent with two text questions. Replace the noisy Q&A with one focused action: attach the calendar.

- Rename section to **Calendar** (drop "& Holidays") with id `calendar`.
- **Remove** the "Are most holidays on Mondays?" radio and the "Other notes about holidays / waiver / PD days" textarea from the UI and the PDF.
- Add **Upload calendar (PDF or image)** — a single file picker that stores the file in the existing Lovable Cloud storage bucket used by Calendar Upload elsewhere in the wizard, plus shows the file name + a Remove button after upload.
- Keep a small helper line: "We'll pull holidays from this calendar during setup." linking to the wizard's Calendar Upload step.

Existing DB columns `mostly_monday_holidays` and `holiday_notes` stay in the table (no migration to drop them) so old rows are preserved — the page just stops reading/writing them.

## Technical notes
- **DB migration** on `public.coordinator_prep`:
  - Add `teacher_union_url text`
  - Add `teacher_contract_url text`
  - Add `calendar_file_path text` (storage object path)
- **File upload**: reuse the existing storage bucket already used by `StepCalendarUpload` (will confirm bucket name when implementing — likely `school-calendars` or similar; will read `useCalendarUpload` to match).
- **Files touched**: `src/pages/setup/CoordinatorPrep.tsx` only on the UI side (plus the migration). No changes to wizard, generator, or other pages.
- **PDF**: `buildRows` gets two new rows for the teacher links; the two holiday rows are removed.

## Out of scope
- Auto-parsing the uploaded calendar (that already happens in the wizard's Calendar Upload step).
- Migrating data out of the deprecated `mostly_monday_holidays` / `holiday_notes` columns.
- Restyling the section cards.
