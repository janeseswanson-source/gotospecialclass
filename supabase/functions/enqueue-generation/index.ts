// enqueue-generation — the client's single entry point for the new async pipeline.
// Validates the user, supersedes any in-flight job for the school, inserts a fresh
// generation_jobs row (status 'queued'), and kicks the server-side worker
// (run-generation-job) which advances + self-chains it. Returns the job_id so the
// client can subscribe to it over Realtime and safely close the page.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json(401, { error: "Unauthorized" });

    const { school_id } = await req.json();
    if (!school_id) return json(400, { error: "school_id required" });

    // RLS-checked: the user must be a member of the school's workspace to see it.
    const { data: school } = await userClient.from("schools").select("id").eq("id", school_id).maybeSingle();
    if (!school) return json(404, { error: "School not found or not accessible" });

    const service = createClient(SUPABASE_URL, SERVICE_KEY);

    // One active job per school: cancel any in-flight predecessor so workers for it
    // no-op on their next step (stepJob treats 'cancelled' as done).
    await service.from("generation_jobs")
      .update({ status: "cancelled", error: "superseded by a new request", updated_at: new Date().toISOString() })
      .eq("school_id", school_id).in("status", ["queued", "running", "polishing"]);

    const initialProgress = { phase: "cpsat", attempt: 0, attempts: 1, currentQuality: 0, bestQuality: 0, searchAttempt: 0, refinePass: 0, noImproveStreak: 0, elapsedMs: 0 };
    const { data: job, error: insErr } = await service.from("generation_jobs").insert({
      school_id, requested_by: user.id, status: "queued", phase: "cpsat", progress: initialProgress,
    }).select("id").single();
    if (insErr || !job) return json(500, { error: `Failed to enqueue: ${insErr?.message}` });

    // Kick the worker (fire-and-forget; the worker self-chains from here).
    const kick = fetch(`${SUPABASE_URL}/functions/v1/run-generation-job`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: job.id }),
    }).catch(() => {});
    // @ts-ignore EdgeRuntime is provided by the Supabase runtime.
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(kick); else await kick;

    return json(200, { job_id: job.id });
  } catch (e: any) {
    return json(500, { error: e?.message ?? "Unknown error" });
  }
});
