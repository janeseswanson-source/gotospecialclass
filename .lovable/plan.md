## Redeploy edge functions

Per `LOVABLE_DEPLOY.md`, the latest commits are engine/client-only — **no migrations, no new secrets**. The three migrations from the prior deploy (`refined_from_generation_id`, `proposed_weights`/`proposed_at`, `quality_confidence`) are already in place, and `ANTHROPIC_API_KEY` is already configured.

### Action

Redeploy these 4 edge functions so the latest `_engine/` copies (kept in sync by `scripts/sync-engine.sh`) go live:

1. `generate-schedule`
2. `refine-schedule`
3. `resolve-conflicts-ai`
4. `update-scoring-weights`

Each function's bundled `_engine/` folder ships with it automatically (Lovable can't cross-import between function dirs, which is why the engine is vendored per function).

### Not doing

- No database migrations (already applied last deploy).
- No secret changes.
- No frontend code edits — frontend changes go live when you click **Update** in the Publish dialog.
- No Supabase types regeneration needed (no schema change this round).

### Verification

After deploy, I'll tail `generate-schedule` and `refine-schedule` logs to confirm clean boots with no import errors.