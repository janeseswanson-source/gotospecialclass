# Special Rotations (PLUS) — two modes + generator flag

Make the PLUS section on Coordinator Prep customizable, with the choice mapping to a school-level flag the generator already (or will soon) respect.

## UX changes — `src/pages/setup/CoordinatorPrep.tsx`

Replace the current Yes/No + free-text textarea with:

1. **Top question**: "Is there a special additional rotation beyond the normal routine?" — Yes / No (unchanged).
2. **When Yes**, show a sub-radio: **How should we handle PLUS?**
   - **I'll specify the day(s)** — admin owns it. Shows the existing structured fields: days (Mon–Fri checkboxes), time block, grades involved, "why this day?" rationale.
   - **Let AI fit it in** — no extra day. Shows a short helper: "We'll absorb PLUS into the regular weekly rotation. If it can't fit, we'll warn you before generating."
3. Save status / autosave behavior unchanged.

PDF (`buildRows`) gets:
- "PLUS rotation handling" → "Admin-specified" / "AI auto-fit" / "—"
- (When admin-specified) days, time block, grades, rationale rows.

## Data — `coordinator_prep`

Add three columns via migration:
- `plus_mode text` — `'admin' | 'ai_auto_fit' | null`
- `plus_days text[]` — selected weekday short codes
- `plus_rationale text` — optional "why this day"

(Existing `special_rotation_notes` keeps the time-block + grades free text, so no breakage.)

## Generator flag — `schools.plus_auto_fit`

Add `plus_auto_fit boolean default false` to `public.schools`. Whenever `plus_mode` is saved on `coordinator_prep` for that school, mirror it: `'ai_auto_fit'` → true, otherwise false. Persistence happens in the same `persist()` call (one extra `schools.update`).

## Generator behavior — `supabase/functions/generate-schedule/index.ts`

Read `school.plus_auto_fit` once at the top of generation:
- **false (default)** — current behavior; PLUS sessions come from the wizard's `PlusRotationMatrix` step and slot into the matrix-specified day/time as today.
- **true** — skip the dedicated PLUS day. Instead, when building candidates for each PLUS-eligible grade, add **one extra weekly visit** of the PLUS subject into the normal grid alongside the regular specials. If the canonical grid has no room after all other constraints, emit a non-blocking warning (`type: 'plus_no_fit', severity: 'warning'`) so the user knows to switch back to admin-specified.

No changes to the wizard's `PlusRotationMatrix` step — admins who pick "I'll specify" still go there for the matrix; admins who pick "Let AI fit it in" can skip it.

## Out of scope

- Editing the wizard's `PlusRotationMatrix` UI.
- Backfilling `plus_auto_fit` on existing schools (defaults to false, matching today's behavior).
- A separate "warn me before generating" preview step — the warning surfaces in the existing post-generation warnings list.

## Files touched

- Migration: add 3 cols to `coordinator_prep` + 1 col to `schools`.
- `src/pages/setup/CoordinatorPrep.tsx` — UI + persist mirror to `schools`.
- `src/pdf/CoordinatorPrep.tsx` — no signature change (`PrepRow` reused).
- `supabase/functions/generate-schedule/index.ts` — branch on `school.plus_auto_fit`, add candidate inflation + warning.
- Tests: add one case to the generator test suite covering the `plus_auto_fit` true branch and the no-fit warning.
