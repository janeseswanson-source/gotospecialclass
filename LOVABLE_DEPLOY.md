# Lovable deploy prompt

The `scheduler-upgrade` + `frontend-revamp` work adds **3 database migrations** (new
columns only — no destructive changes), updates/adds **4 edge functions**, and
needs the **Supabase TypeScript types regenerated** so the frontend sees the new
columns. Everything is additive and backward-compatible.

---

## Paste this to Lovable

> Please deploy the latest changes from the `frontend-revamp` branch. Specifically:
>
> **1. Apply these 3 new migrations (additive columns, safe to run; all use
> `IF NOT EXISTS`):**
> - `supabase/migrations/20260628000000_refined_from_generation.sql` — adds
>   `schedule_generations.refined_from_generation_id uuid` (FK → schedule_generations).
> - `supabase/migrations/20260628010000_weight_proposals.sql` — adds
>   `scoring_weight_profiles.proposed_weights jsonb` and `proposed_at timestamptz`.
> - `supabase/migrations/20260628020000_quality_confidence.sql` — adds
>   `schedule_generations.quality_confidence jsonb`.
>
> **2. Deploy these edge functions** (they import shared modules from
> `supabase/functions/generate-schedule/`, so deploy that whole folder too):
> - `generate-schedule` (updated — now persists `quality_confidence`)
> - `refine-schedule` (**new** — background SA+LNS refinement → improved version)
> - `resolve-conflicts-ai` (updated — deterministic engine resolves; `preview`/`apply` modes)
> - `update-scoring-weights` (updated — `propose`/`confirm` actions)
>
> **3. Regenerate the Supabase TypeScript types** (`src/integrations/supabase/types.ts`)
> from the updated schema, so the new columns above are typed on the client.
>
> After deploying, the Master Schedule page reads `quality_confidence`,
> `refined_from_generation_id`, and `scoring_weight_profiles.proposed_weights`.

---

## Reference (what changed and why)

### Migrations → new columns
| Migration | Table | New column(s) | Used by |
|---|---|---|---|
| `20260628000000_refined_from_generation.sql` | `schedule_generations` | `refined_from_generation_id uuid` | background refinement: links a refined version to its parent (power 6) |
| `20260628010000_weight_proposals.sql` | `scoring_weight_profiles` | `proposed_weights jsonb`, `proposed_at timestamptz` | learnable-weights propose/confirm (power 7) |
| `20260628020000_quality_confidence.sql` | `schedule_generations` | `quality_confidence jsonb` | confidence signal shown in `QualityPanel` (power 1) |

### Edge functions
| Function | Status | Notes |
|---|---|---|
| `generate-schedule` | updated | background `finalize()` now computes + persists `quality_confidence`; engine refactored into focused modules (`_annealing`, `_occupancy`, `_lns`, `_confidence`, `_refine`, `_perturbation`, `_conflict`, `_weightlearning`) — all in the function folder, deploy together |
| `refine-schedule` | **new** | heavy SA+LNS pass that writes a strictly-better version (`refined_from_generation_id`), re-validated against the SSOT; client polls it after generation |
| `resolve-conflicts-ai` | updated | deterministic engine resolves (smallest blast radius) + LLM narrates; new `mode: "preview" \| "apply"` for pick-one-of-N |
| `update-scoring-weights` | updated | now `action: "propose"` (stage a clamped proposal) and `"confirm"` (apply) — human-gated, never auto-applies |

### Why type regen is needed
The frontend currently casts around the three new columns (`quality_confidence`,
`refined_from_generation_id`, `proposed_weights`/`proposed_at`) because the locally
generated `src/integrations/supabase/types.ts` predates them. After Lovable
regenerates types from the live schema, those casts are still harmless but no
longer strictly necessary.

### Safety
- All migrations are additive (`ADD COLUMN IF NOT EXISTS`) — no data loss, safe to
  re-run, and old code keeps working (the columns are nullable).
- No solver / SSOT validator / scoring-rubric behavior changed by the deploy.
- Secrets: no new secrets required. `resolve-conflicts-ai` uses the existing
  `ANTHROPIC_API_KEY` (only for optional narration; it degrades gracefully without it).
