Redeploy these edge functions so the latest shared engine changes go live across every consumer:

- generate-schedule (canonical engine)
- refine-schedule
- verify-schedule
- schedule-chat
- improve-quality
- resolve-conflicts-ai
- update-scoring-weights
- generate-cpsat

No migrations, no frontend edits, no secret changes.

## Technical details
Single `supabase--deploy_edge_functions` call with all 8 function names. Each consumer already carries its synced `_engine/` copy via `scripts/sync-engine.sh`, so deploying the folders is sufficient.