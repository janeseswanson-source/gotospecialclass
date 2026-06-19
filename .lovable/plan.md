# Move Coordinator Prep upload to the Coordinator Prep page

## 1. Revert `StepWelcome.tsx`
Remove the entire "📋 Quick Start — Coordinator Prep" block, the file input, all upload state (`aiResult`, `processing`, `fileRef`, `handleTemplateUpload`, `fileToRows`, `Warning`/`AIResult` types), and unused imports (`xlsx`, `supabase`, upload icons). Restore the simple Welcome screen: heading, blurb, School Name input, Get Started button.

## 2. Add upload + AI autofill to `CoordinatorPrep.tsx`
In the header toolbar (next to "Download Prep PDF"), add a new **"Upload Filled Prep (AI Autofill)"** button:
- Accepts `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp` (the user scans/photographs the printed sheet, or re-exports the edited PDF).
- Reads file as base64, calls a new edge function `parse-coordinator-prep` with `{ file_base64, mime_type, school_name }`.
- On success: merges returned fields into local `state` (triggers existing debounced autosave → `coordinator_prep` row). Shows toast with counts + any warnings inline below the toolbar.
- Loading spinner while processing; disabled state.
- Small helper text under header: "Upload your filled-in prep sheet — AI will read it and fill in the sections below."

No changes to wizard prefill logic. Data flows: PDF → AI → `coordinator_prep` table only. The wizard already pulls from this table separately (unchanged).

## 3. New edge function `supabase/functions/parse-coordinator-prep/index.ts`
- `verify_jwt = false` pattern with manual auth (matches existing functions).
- Accepts JSON body: `{ file_base64, mime_type, school_name? }`. Validate with size/type checks (PDF or common images).
- Calls Lovable AI Gateway `google/gemini-2.5-flash` with multimodal input (image_url with data URI for images; PDFs supported by Gemini).
- Tool-calling schema mirrors the `PrepState` shape in `CoordinatorPrep.tsx`:
  - `school_site_url`, `district_calendar_url`, `early_release_day`, `early_release_end_time`, `teacher_union_url`, `teacher_contract_url`
  - `grade_preference` (`keep_together` | `waterfall` | `fixed_sequence` | `""`)
  - `day_preference` (string[]), `am_pm_preference`
  - `specialist_count` (number|null), `cart_users`, `two_school_users`, `part_time_users`, `custom_grade_prefs`
  - `mostly_monday_holidays` (bool|null), `holiday_notes`
  - `has_special_rotation` (bool|null), `plus_mode` (`""|admin|ai_auto_fit`), `plus_days` (string[]), `plus_rationale`, `special_rotation_notes`
  - `warnings: [{field, message, severity}]`
- System prompt: "You are reading a filled-in Coordinator Prep intake sheet. Extract every answer you can read. Leave fields blank when illegible. Add a warning entry for ambiguous answers."
- Returns parsed object directly. Logs to `ai_usage_log` (feature: `coordinator_prep_upload`).
- Same 402/429 error handling pattern as `process-onboarding-template`.

## 4. Cleanup
- Delete `supabase/functions/process-onboarding-template/index.ts` (no longer referenced after StepWelcome revert).
- Delete `public/templates/onboarding_template.xlsx` if present (the xlsx intake template).
- Keep `public/templates/coordinator_prep_template.pdf` — that's the file users print/fill.

## Out of scope
- No changes to wizard step flow, SetupContext, or schema.
- No new DB columns — `coordinator_prep` already has every field used.
- No bulk re-parse, no version history, no diff UI for re-uploads (latest upload overwrites; existing autosave handles persistence).

## Files
- edit `src/pages/setup/steps/StepWelcome.tsx`
- edit `src/pages/setup/CoordinatorPrep.tsx`
- create `supabase/functions/parse-coordinator-prep/index.ts`
- delete `supabase/functions/process-onboarding-template/index.ts`
- delete `public/templates/onboarding_template.xlsx` (if exists)
