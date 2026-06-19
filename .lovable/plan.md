## Goal

Replace the current CSV specialist template with the user-provided `SpecialistOps_SpecialistTeacher_Template.xlsx`, serve it as the official download, and make the upload flow accept that filled-in `.xlsx` so AI auto-populates every specialist field without re-keying.

## New template columns (locked to this layout)

| Col | Field | Maps to |
|---|---|---|
| A | Specialist Teacher Name | `name` |
| B | Phone (Optional) | `phone` *(new optional field, UI-only for now)* |
| C | Email (Optional) | `email` *(new optional field, UI-only for now)* |
| D | Specialist Subject | `subject` |
| E | Location (Room # or other) | `location` |
| F | Working Days at School | `workingDays` (parsed: `Mon,Tue,Wed,Thu,Fri`, `Mon-Fri`, `MWF`, `All`, blank → all five) |
| G | Two School Sites? (Yes/No) | `twoSchools` |
| H | Second Site Name | `secondSchoolName` |

Fields absent from the new template (planning minutes, lunch minutes, cart, part-time, second-location) keep their existing defaults from `defaultSpecialist()`.

## Changes

### 1. Ship the new template file
- Add `public/templates/specialists_template.xlsx` (copy of the uploaded file).
- Keep the old `specialists_template.csv` + README on disk for backward compatibility, but stop linking to them.

### 2. Download buttons → new XLSX
In `src/pages/setup/steps/StepSpecialists.tsx`:
- Change both `downloadTemplate('specialists', '/templates/specialists_template.csv')` calls (lines 572, 996) to `downloadTemplate('specialists', '/templates/specialists_template.xlsx')`.
- Remove the "Format help" link pointing to the old README; the new sheet has a header row that documents itself.
- Update button labels: "Quick Update (CSV)" → "Upload Filled Template" and update `accept` to `.xlsx,.xls,.csv` so the existing CSV path still works.

### 3. Parse the uploaded `.xlsx`
- Add `xlsx` (SheetJS) dependency.
- In `handleCSVUpload` (rename to `handleTemplateUpload`):
  - Detect extension; for `.xlsx`/`.xls`, read with `XLSX.read(arrayBuffer)`, take the first sheet, convert with `sheet_to_json({ header: 1, defval: '' })`.
  - Skip the title row (A1) and instruction row (A2); treat row 3 as the header; data starts at row 4. Stop at the footer row (`A19` content begins with "Specialist Ops!").
  - Reuse the existing column-detection logic (case-insensitive `includes` on header text, e.g. `name`, `subject`, `working days`, `two school`, `second site`, `location`, `phone`, `email`).
  - Drop fully-empty rows (only the F/G defaults filled with no name + no subject).
- CSV path stays as-is for the legacy template.

### 4. AI auto-fill fallback
- After local parsing, if a row has any data but is missing required mappings (no detected `name`/`subject` headers, free-form working days like "Tuesdays and Thursdays", odd subject spellings), POST the raw 2-D array to a new edge function `parse-specialist-template`:
  - Reuses the existing `process-onboarding-template` pattern (verify user, call Lovable AI Gateway with `google/gemini-2.5-flash`, single tool call).
  - Tool schema returns `specialists: [{ name, phone, email, subject, location, working_days[], two_schools, second_school_name }]` plus `warnings[]`.
  - System prompt: "Normalize subject names to one of: Art, Music, PE, Library, STEM, Spanish, Science Lab, Technology, Other. Convert working-days phrases to `Mon|Tue|Wed|Thu|Fri` arrays. Empty cells → omit."
- Merge AI rows into `setSpecialists` the same way as parsed rows.
- Show toast: "AI auto-filled N rows from your template."

### 5. New optional `phone` / `email` fields
- Add `phone?: string` and `email?: string` to the local `Specialist` type and `defaultSpecialist()` so import doesn't drop them.
- Display them as optional inputs inside the specialist card header (small two-column row under the name). No DB migration in this change — values persist in `specialists.notes` JSON or are ignored on save until a follow-up adds columns; flag this in the warnings list so we revisit.

### 6. Admin template slot
`AdminSettingsPage` already drives the `specialists` template key via `downloadTemplate`. No code change; admins can replace the bundled XLSX by uploading their own through Admin Settings (the new fallback path also points to the XLSX).

## Out of scope
- DB migration to persist `phone` / `email` on `specialists` (call out as follow-up).
- Reworking the onboarding `process-onboarding-template` function.
- Changes to the teachers template or the bulk onboarding template.
- Visual redesign of the Specialists step beyond the small phone/email inputs.

## Files touched
- `public/templates/specialists_template.xlsx` (new)
- `src/pages/setup/steps/StepSpecialists.tsx` (download links, upload handler, optional inputs)
- `src/lib/templateDownload.ts` (no change; just used)
- `supabase/functions/parse-specialist-template/index.ts` (new edge function)
- `supabase/config.toml` (register the new function with `verify_jwt = false` per existing pattern)
- `package.json` (add `xlsx`)
