## Problem

The "Generate" button calls `supabase.functions.invoke("enqueue-generation", ...)` (see `src/lib/generateBestSchedule.ts:47`), but the `enqueue-generation` edge function has never been deployed — its logs are empty and it wasn't in the previous deployment batch. Supabase returns "Failed to send a request to the Edge Function" because the function URL 404s.

## Fix

Deploy `enqueue-generation` to Lovable Cloud in one call:

- `supabase--deploy_edge_functions(["enqueue-generation"])`

It already has proper CORS + auth handling and only needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`, which are all present. The `generation_jobs` table it writes to was created in the earlier migration batch, so no schema work is needed.

## Verify

After deploy, ask the user to retry Generate. If it still fails, pull `enqueue-generation` logs to see the real error (auth, schema, or worker chain to `run-generation-job`).

## Out of scope

No code changes, no other function redeploys, no secret changes.
