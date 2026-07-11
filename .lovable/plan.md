## Plan

Redeploy edge functions so the latest engine improvements go live.

### Redeploy edge functions

Single call to `supabase--deploy_edge_functions` with:

- `generate-schedule`
- `generate-cpsat`
- `run-generation-job`
- `refine-schedule` (engine copy under `_engine/` changed)
- `parse-calendar` (PDF-following calendar parser)

### Not included

- No migrations this round — the `clean_band_labels` cleanup already ran last turn.
- No frontend or business-logic edits.
- No secrets changes.

### Technical details

- Deploys pick up the shared engine files that were synced into each function's `_engine/` folder via `scripts/sync-engine.sh`.
- Engine improvements shipping: grade adjacency, rescue probe (scheduler), PDF-following calendar parsing.
