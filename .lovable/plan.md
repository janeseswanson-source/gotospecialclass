## Deploy frontend-revamp backend changes

The three migration files exist locally but haven't been applied to the live database, and the new/updated edge functions need redeployment. Plan below.

### 1. Apply 3 additive migrations (single combined migration call)

All `ADD COLUMN IF NOT EXISTS` — safe and reversible:

- `schedule_generations.refined_from_generation_id uuid` → FK to `schedule_generations(id)` ON DELETE SET NULL (background-refinement lineage).
- `scoring_weight_profiles.proposed_weights jsonb` + `proposed_at timestamptz` (staged weight proposals, human-gated).
- `schedule_generations.quality_confidence jsonb` (engine confidence signal for QualityPanel).

No RLS/policy changes — both tables already have member-scoped policies covering the new columns.

### 2. Regenerate Supabase TypeScript types

Approving the migration triggers regeneration of `src/integrations/supabase/types.ts` so `quality_confidence`, `refined_from_generation_id`, `proposed_weights`, and `proposed_at` are typed on the client. The existing frontend casts continue to work; no code changes required.

### 3. Redeploy 4 edge functions

The shared modules under `supabase/functions/generate-schedule/` (`_annealing`, `_occupancy`, `_lns`, `_confidence`, `_refine`, `_perturbation`, `_conflict`, `_weightlearning`, `_scoring`) are imported by the others and ship together when their folder is deployed:

- `generate-schedule` — finalize() now persists `quality_confidence`.
- `refine-schedule` — NEW background SA+LNS pass that writes a strictly-better version linked via `refined_from_generation_id`.
- `resolve-conflicts-ai` — deterministic resolver with `mode: "preview" | "apply"`.
- `update-scoring-weights` — `action: "propose" | "confirm"` (staged, never auto-applied).

`refine-schedule` and `update-scoring-weights` validate the JWT inside the function, so no `supabase/config.toml` changes needed (defaults already match). No new secrets required.

### Verification after deploy

- `\d schedule_generations` and `\d scoring_weight_profiles` show the new columns.
- Generate a schedule → confirm `quality_confidence` is populated.
- Call `refine-schedule` with a generation_id → confirm it returns `improved: true/false` without 500s.

### Out of scope

No solver, SSOT validator, scoring-rubric, or UI behavior changes in this deploy — purely backend rollout of work already in the repo.
