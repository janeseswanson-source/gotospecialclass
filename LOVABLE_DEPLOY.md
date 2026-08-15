# Lovable deploy prompt

## ⚠️ PENDING MIGRATIONS — apply these before (or with) the next frontend deploy

Migrations in this repo are applied **manually**. A migration that sits here
unapplied is not inert: the frontend ships code that writes the new column, and
every one of those writes fails with PostgREST **PGRST204**
(`Could not find the 'x' column of 'schools' in the schema cache`). That is
exactly how a coordinator lost a full setup session — the School Info step sends
all its settings in one payload, so one unknown column rejected **everything**.

| Migration | Adds | Status |
|---|---|---|
| `20260718000000_add_max_team_out_minutes.sql` | `schools.max_team_out_minutes` (int, default 120) | **NOT APPLIED — apply first** |
| `20260808000000_schema_cache_reload.sql` | no DDL; forces a PostgREST schema reload | **NOT APPLIED** |
| `20260808010000_add_teacher_work_day.sql` | `schools.teacher_day_start_time`, `teacher_day_end_time`, `teacher_planning_block_minutes`, `teacher_planning_block_when` (all nullable — NULL = same as the student day) | **NOT APPLIED** |
| `20260808020000_add_rotations_start_date.sql` | `schools.rotations_start_date` (nullable), `rotations_week_anchor` (default `'school_year'` — existing A/B lettering unchanged) | **NOT APPLIED** |
| `20260808030000_add_teacher_accompanies.sql` | `specialists.teacher_accompanies` (bool, default false) | **NOT APPLIED** |
| `20260808040000_add_grade_pd_window.sql` | `schools.grade_pd_enabled` (default true), `grade_pd_target_minutes` (90), `grade_pd_quorum_pct` (100), `grade_pd_label` | **NOT APPLIED** |
| `20260808060000_add_contract_compliance.sql` | `schools.contract_profile`/`contract_categories`, `classroom_teachers.contract_category`, `specialists.contract_category` (all nullable) | **NOT APPLIED** |

After applying: **regenerate `src/integrations/supabase/types.ts`** in the same
deploy, then confirm the Setup Wizard's School Info step saves with no red toast.

> Please apply **all the migrations listed above**, regenerate the Supabase
> TypeScript types, and deploy the frontend from `main`. No new secrets.
> Also redeploy the edge functions (they carry engine changes for the teacher
> duty day, and each has its own `_engine/` folder — deploy those too).

---

## Standing rule for every schema change

Four things, every time — the outage above happened because of #3 and #4:

1. **Additive only.** New columns, never a rename or a drop. The running
   frontend must keep working against the old schema.
2. **`ADD COLUMN IF NOT EXISTS`,** so re-applying is a no-op.
3. **End the file with `NOTIFY pgrst, 'reload schema';`** — PostgREST caches the
   schema. Without it the column exists but the API still answers PGRST204 and
   every write carrying it fails.
4. **Regenerate `types.ts` in the same deploy** and add the migration to the
   table above until it is applied.

`src/lib/schemaDrift.test.ts` enforces #2, #3 and #4 in CI: it parses every
migration, and fails if a column added by a migration is missing from
`types.ts`, or if a migration is missing the `NOTIFY` line.

The client also defends itself at runtime (`src/lib/supabaseSchemaFallback.ts`):
a write that hits PGRST204 retries without the unknown column and shows one
amber toast, so an unapplied migration costs a single setting instead of the
whole session. That is a safety net, **not** a substitute for applying the
migration.

---

## Previous update — schedule quality (no new migrations)

Earlier commits make schedules reach the true achievable ceiling (AB/AA-BB Week
hit **100%**; see `SCHEDULE_QUALITY_NOTES.md`). They changed ENGINE CODE and the
client only.

> Redeploy the `generate-schedule`, `refine-schedule`, `resolve-conflicts-ai`
> and `update-scoring-weights` edge functions (each carries the shared engine
> under its own `_engine/` folder — deploy those folders too) and the frontend,
> from `main`.

**Engine copies:** the canonical engine lives in
`supabase/functions/generate-schedule/`; `bash scripts/sync-engine.sh` copies it
into all seven consumers' `_engine/` folders. Run `--check` before merging.

**Still pending on the product side:** the school must click **Regenerate** on
the Master Schedule page for wheel-aligned scheduling, the Grade Set-up window
and PD blocks to appear in an existing school's schedule.
