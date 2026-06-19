## Goal

Use the new **Coordinator Prep — Intake Sheet** (from your PDF) as the official Quick Start template in the Setup Wizard. Coordinators download it, fill it in, upload it, and the AI populates the wizard sections.

## What changes

### 1. New downloadable template
Generate `public/templates/onboarding_template.xlsx` (replaces existing) as a clean two-column intake sheet matching the PDF exactly:

```text
Row 1: Title — "Coordinator Prep — Intake Sheet"
Row 2: Instruction — "Fill this out before the Setup Wizard. Answers will be transferred into the app for quick prefill."
Row 3: Headers — Ask | Answer
Rows 4–20: One row per question, mirroring the PDF:
  - School name
  - School site URL
  - District calendar URL
  - Weekly early-release day
  - Early-release end time
  - Specialist scheduling preference
  - Day preference for specialists
  - AM / PM preference
  - How many specialist teachers?
  - Specialists using a teaching cart
  - Specialists at two schools
  - Part-time specialists (with days)
  - Specialists with custom grade preferences
  - Are most holidays on Mondays?
  - Other notes about holidays / waiver / PD days
  - Special additional rotation (PLUS)?
  - PLUS rotation details (days, time, grades)
```

Styled with the brand navy header row, light banded rows, frozen header, and a wide answer column so it prints/edits nicely. A matching PDF (`coordinator_prep_template.pdf`, copied from your upload) is also placed alongside it so coordinators can print and hand-fill.

### 2. Wizard UI (`StepWelcome.tsx`)
- Rename the panel from “Quick Start with Template” to **“Quick Start — Coordinator Prep”** with copy explaining the intake-sheet workflow.
- “Download Template” button serves the new XLSX (default) with a small secondary link to download the print-friendly PDF.
- “Upload Filled Template” button unchanged — accepts `.xlsx`, `.xls`, `.csv`.

### 3. AI extraction (`supabase/functions/process-onboarding-template/index.ts`)
The function already parses Q&A rows + drives Gemini Flash with structured tool-calling. Light updates so the new questions are mapped cleanly:
- Expand the system prompt with explicit guidance for the new fields: `default_day_preference`, `default_am_pm_preference`, PLUS rotation (mapped into `admin_rotation`), holiday/PD notes (into `makeup_policy`), specialist scheduling preference (into `grade_preference`).
- Add an optional `plus_rotation` array to the tool schema (day, time, grades, notes) and, in the client, merge it into the existing PLUS-rotation context state alongside `admin_rotation`.
- Keep all existing field handling so the previous template still works.

### 4. Client mapping (`StepWelcome.tsx`)
- Map `school_info.calendar_url` → `data.calendarUrl` (currently ignored).
- Map new `plus_rotation` → setup context PLUS rotation entries (same shape used by `StepPlusRotation`).
- Everything else (specialists, admin rotation, conflict strategies, grade preference, makeup policy) already wires through — no change.

## Out of scope
- No DB schema changes.
- No changes to the in-app Coordinator Prep print page (`src/pdf/CoordinatorPrep.tsx` / `src/pages/setup/CoordinatorPrep.tsx`) — they stay as-is.
- Specialist teacher template (separate XLSX) is untouched.

## Files
- `public/templates/onboarding_template.xlsx` (regenerated)
- `public/templates/coordinator_prep_template.pdf` (new — copy of your upload)
- `src/pages/setup/steps/StepWelcome.tsx`
- `supabase/functions/process-onboarding-template/index.ts`
