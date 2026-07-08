## Root cause
Auto-recommend picks `aa_bb_week` as a rotation strategy. The autosave then writes it to `schools.conflict_strategy`, but the Postgres enum `conflict_strategy` only has `standard, ab_week, quick_30, big_group, makeup, extra_rotation` — `aa_bb_week` is missing. The insert fails with an invalid enum value, the catch swallows the specific error, and you see the generic "Couldn't save order — try again."

All the app code (client + engine + spec builder + tests) already treats `aa_bb_week` as a first-class strategy. The DB enum just never got the value.

## Fix
One migration: add `aa_bb_week` to the `conflict_strategy` enum.

```sql
ALTER TYPE public.conflict_strategy ADD VALUE IF NOT EXISTS 'aa_bb_week';
```

That's it — additive, safe, no data changes, no code edits, no redeploys.

## Non-goals
- Not touching the toast wording or the swallowed-error handling (separate polish).
- Not editing anything in the frontend or edge functions — they're already correct.
