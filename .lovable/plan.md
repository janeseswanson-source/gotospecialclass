## Plan

Two operational steps — no code changes.

### 1. Apply pending migrations

Run any unapplied migrations, including `20260711000000_clean_band_labels.sql`, which normalizes garbage labels (empty, `band_xxx` keys, period names like "AM Recess") in `schools.recess_grade_bands` into readable grade-range names (`K–2`, `K`, or `Group`). Pure data cleanup — no schema change, no RLS/GRANT changes.

Sibling migrations already in the folder that will also apply if not yet run:
- `20260707000000_specialist_meeting.sql`
- `20260707150000_coverage_relaxed.sql`

### 2. Redeploy edge functions

Redeploy so the latest engine copies (shared `_engine/` files) are picked up:

- `generate-schedule`
- `generate-cpsat`
- `run-generation-job`
- `refine-schedule`
- `parse-calendar`

### Technical details

- Migration is executed via the migration tool (approval flow).
- Edge functions are redeployed via `supabase--deploy_edge_functions` with the five names above in one call.
- No frontend or business-logic edits.
