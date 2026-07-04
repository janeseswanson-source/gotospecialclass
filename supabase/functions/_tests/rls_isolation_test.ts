// Cross-tenant RLS isolation test. Seeds TWO users in TWO workspaces/schools with
// the service role, then — acting as each user's own JWT (RLS applies) — asserts
// that user B can neither READ nor WRITE user A's rows for the security-critical
// tables. Skips gracefully when the DB env isn't present (CI without a project).
//
// Run:  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ANON_KEY=… \
//         deno test --allow-env --allow-net supabase/functions/_tests/rls_isolation_test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL");
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON = Deno.env.get("SUPABASE_ANON_KEY");
const hasEnv = !!(URL && SERVICE && ANON);
const opts = { ignore: !hasEnv, sanitizeResources: false, sanitizeOps: false } as const;

const rand = () => crypto.randomUUID().slice(0, 8);

interface Tenant { userId: string; token: string; workspaceId: string; schoolId: string; email: string }

// deno-lint-ignore no-explicit-any
async function seedTenant(admin: any, label: string): Promise<Tenant> {
  const email = `rls-${label}-${rand()}@example.test`;
  const password = `Pw!${rand()}${rand()}`;
  const { data: created, error: uErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (uErr || !created.user) throw new Error(`createUser failed: ${uErr?.message}`);
  const userId = created.user.id;

  const { data: ws, error: wErr } = await admin.from("workspaces").insert({ name: `WS ${label}`, created_by: userId } as any).select("id").single();
  if (wErr || !ws) throw new Error(`workspace insert failed: ${wErr?.message}`);
  const workspaceId = (ws as any).id;

  await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: userId, role: "owner" } as any);

  const { data: school, error: sErr } = await admin.from("schools").insert({ name: `School ${label}`, workspace_id: workspaceId } as any).select("id").single();
  if (sErr || !school) throw new Error(`school insert failed: ${sErr?.message}`);
  const schoolId = (school as any).id;

  // Sign in to get this user's JWT (RLS-scoped client uses it).
  const auth = createClient(URL!, ANON!);
  const { data: session, error: sinErr } = await auth.auth.signInWithPassword({ email, password });
  if (sinErr || !session.session) throw new Error(`signIn failed: ${sinErr?.message}`);

  return { userId, token: session.session.access_token, workspaceId, schoolId, email };
}

Deno.test("cross-tenant RLS: user B cannot read or write user A's data", opts, async () => {
  const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
  const a = await seedTenant(admin, "a");
  const b = await seedTenant(admin, "b");

  // Seed representative rows in A's school (service role bypasses RLS).
  const gen = await admin.from("schedule_generations").insert({ school_id: a.schoolId } as any).select("id").single();
  const genId = (gen.data as any)?.id;
  assert(genId, `seed generation failed: ${gen.error?.message}`);
  // NOTE: schedule_blocks has NO school_id column — blocks scope through their generation.
  await admin.from("schedule_blocks").insert({ generation_id: genId, day_of_week: "Mon", start_time: "09:00:00", end_time: "09:45:00" } as any);
  await admin.from("quotes").insert({ school_id: a.schoolId, text: "secret A" } as any);
  await admin.from("specialists").insert({ school_id: a.schoolId, name: "A Specialist", subject: "Art" } as any);

  // Client acting as user B (RLS enforced).
  const asB = createClient(URL!, ANON!, { global: { headers: { Authorization: `Bearer ${b.token}` } }, auth: { persistSession: false } });

  // READS: B sees zero of A's rows on every security-critical table.
  for (const table of ["schedule_generations", "quotes", "specialists", "scoring_weight_profiles", "generation_jobs"]) {
    const { data, error } = await asB.from(table).select("*").eq("school_id", a.schoolId);
    // RLS returns an empty set (not an error) for filtered reads.
    assertEquals(error, null, `${table} read errored`);
    assertEquals((data ?? []).length, 0, `LEAK: user B read ${data?.length} ${table} rows from tenant A`);
  }
  // schedule_blocks scopes via generation_id (its RLS resolves school through the generation).
  {
    const { data, error } = await asB.from("schedule_blocks").select("*").eq("generation_id", genId);
    assertEquals(error, null, "schedule_blocks read errored");
    assertEquals((data ?? []).length, 0, `LEAK: user B read ${data?.length} schedule_blocks rows from tenant A`);
  }

  // WRITE: B cannot insert into A's school.
  const wr = await asB.from("quotes").insert({ school_id: a.schoolId, text: "B injecting into A" } as any);
  assert(wr.error, "LEAK: user B inserted a quote into tenant A's school");

  // Sanity: B CAN read its own (empty) school without error.
  const own = await asB.from("quotes").select("*").eq("school_id", b.schoolId);
  assertEquals(own.error, null);

  // Cleanup (service role). schedule_blocks cascade-delete with their generation.
  for (const t of ["schedule_generations", "quotes", "specialists"]) {
    await admin.from(t).delete().eq("school_id", a.schoolId);
  }
  await admin.from("schools").delete().in("id", [a.schoolId, b.schoolId]);
  await admin.from("workspace_members").delete().in("workspace_id", [a.workspaceId, b.workspaceId]);
  await admin.from("workspaces").delete().in("id", [a.workspaceId, b.workspaceId]);
  await admin.auth.admin.deleteUser(a.userId);
  await admin.auth.admin.deleteUser(b.userId);
});
