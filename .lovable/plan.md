## Problem

CP-SAT is running on Render fine, but `generate-cpsat` never gets past its own school lookup. Every recent generation job in the DB shows:

- `fallback_reason: "CP-SAT rejected the model (school_not_found): School not found"`
- `error: "Fallback search produced no schedule"`

The "School not found" string is returned by `generate-cpsat` itself before it ever calls Render. The JS fallback (`generate-schedule`) then fails for the same reason.

## Root cause

Both `generate-cpsat` and `generate-schedule` build their Supabase client with the **anon key** and only inject the caller's token as an `Authorization` header:

```ts
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: authHeader } }
});
```

When `run-generation-job` invokes them internally with `SUPABASE_SERVICE_ROLE_KEY`, that token isn't being resolved as the PostgREST `service_role` (the project has both legacy JWT and new `sb_secret_*` keys configured, and the non-JWT format isn't accepted as a bearer JWT by PostgREST). So the query runs as **anon**, RLS on `schools` blocks the row, and both functions bail with "School not found".

## Fix

When the caller is internal (service-role token), build a **real** service-role client instead of layering the token on top of an anon client. That guarantees RLS bypass regardless of the key format.

### Files to change

1. `supabase/functions/generate-cpsat/index.ts` — around line 76-86
2. `supabase/functions/generate-schedule/index.ts` — around line 2337-2359

### Change (same pattern in both)

Replace the current client-construction block with:

```ts
const authHeader = req.headers.get("Authorization");
if (!authHeader?.startsWith("Bearer ")) return fail(401, "unauthorized", "Unauthorized");

const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const token = authHeader.slice(7).trim();
const isInternal = !!serviceKey && token === serviceKey;

const supabase = isInternal
  ? createClient(Deno.env.get("SUPABASE_URL")!, serviceKey!)         // bypasses RLS
  : createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } }
    });

if (!isInternal) {
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return fail(401, "unauthorized", "Unauthorized");
}
```

No other logic changes. User-initiated calls keep going through the anon+JWT path (RLS enforced by `auth.uid()`); internal worker calls get a proper service-role client.

## Deploy & verify

1. Redeploy `generate-cpsat` and `generate-schedule`.
2. Trigger a schedule generation for King Kamehameha 111.
3. Confirm in `generation_jobs`:
   - `status = 'complete'`
   - `fallback_used = false`
   - `best_generation_id` set
4. Confirm the new `schedule_generations` row has `chosen_strategy = 'cpsat_optimal'`.

No DB migrations, no secret changes, no client changes.
