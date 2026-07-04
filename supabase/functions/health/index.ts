// /health — a signed-in dependency probe surfaced on the Admin Settings status
// card. Reports solver reachability + version, whether the Anthropic key is
// present, database reachability, and realtime publication health. Never throws;
// each check is independent so one dependency being down doesn't mask the others.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function checkSolver() {
  const url = Deno.env.get("CPSAT_SOLVER_URL");
  const key = Deno.env.get("CPSAT_SOLVER_KEY");
  if (!url) return { configured: false, ok: false, detail: "CPSAT_SOLVER_URL not set (falls back to JS solver)" };
  try {
    const base = url.replace(/\/$/, "");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const resp = await fetch(`${base}/health`, {
      signal: ctrl.signal,
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
    clearTimeout(timer);
    let version: string | undefined;
    try { const j = await resp.json(); version = j?.version ?? j?.solver_version ?? j?.ortools_version; } catch { /* non-JSON */ }
    return { configured: true, ok: resp.ok, status: resp.status, version };
  } catch (e) {
    return { configured: true, ok: false, error: (e as Error).message };
  }
}

// deno-lint-ignore no-explicit-any
async function checkDatabase(admin: any) {
  try {
    const { error } = await admin.from("schools").select("id", { head: true, count: "exact" }).limit(1);
    return { ok: !error, error: error?.message };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// deno-lint-ignore no-explicit-any
async function checkRealtime(admin: any) {
  // generation_jobs is the realtime-critical table (clients subscribe to job
  // progress). Confirm it's in the supabase_realtime publication.
  try {
    const { data, error } = await admin.rpc("pg_realtime_has_table", { p_table: "generation_jobs" });
    if (error) return { ok: null as boolean | null, detail: "publication check unavailable (client-verified)" };
    return { ok: !!data };
  } catch {
    return { ok: null as boolean | null, detail: "publication check unavailable (client-verified)" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Signed-in only (surfaced on the admin status card).
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });
  const url = Deno.env.get("SUPABASE_URL")!;
  const authed = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return json(401, { error: "Unauthorized" });

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const [solver, database, realtime] = await Promise.all([
    checkSolver(),
    checkDatabase(admin),
    checkRealtime(admin),
  ]);
  const anthropic = { configured: !!Deno.env.get("ANTHROPIC_API_KEY") };
  const sentry = { configured: !!Deno.env.get("SENTRY_DSN") };

  const healthy = database.ok !== false && anthropic.configured && (solver.ok || !solver.configured);

  return json(200, {
    status: healthy ? "ok" : "degraded",
    checked_at: new Date().toISOString(),
    solver,
    anthropic,
    database,
    realtime,
    sentry,
  });
});
