// run-generation-job — the server-side worker that advances a generation_jobs row
// by ONE bounded step and self-chains until the job is complete/failed/cancelled.
//
// INTERNAL ONLY: callers must present the service-role key (enqueue-generation and
// this function's own self-chain do). It builds real deps (fetch to generate-cpsat /
// generate-schedule / refine-schedule, DB claim/load/save) around the PURE state
// machine in _stepJob.ts, so the flow logic is unit-tested there without any I/O.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { qualityPercent } from "../_shared/scoring-rubric.ts";
import { reportEdgeError } from "../_shared/observability.ts";
import {
  runInvocation, pickTimeLimitS, isSolverUnavailable,
  type InvocationDeps, type JobRow, type CpsatOutcome, type SearchOutcome, type RefineOutcome,
} from "./_stepJob.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function callFn(name: string, body: unknown): Promise<{ status: number; body: any }> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = await resp.json().catch(() => ({}));
    return { status: resp.status, body: parsed };
  } catch (e) {
    return { status: 0, body: { error: e instanceof Error ? e.message : String(e), code: "transport" } };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // Internal-only: must present the service-role key.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!SERVICE_KEY || token !== SERVICE_KEY) return json(401, { error: "Unauthorized (internal only)" });

  const { job_id } = await req.json().catch(() => ({}));
  if (!job_id) return json(400, { error: "job_id required" });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Resolve the CP-SAT time budget from the school's size (60s, 120s for > 30 teachers).
  const { data: jobHead } = await supabase.from("generation_jobs").select("school_id").eq("id", job_id).maybeSingle();
  if (!jobHead) return json(404, { error: "job not found" });
  const [{ count: teacherCount }, { data: schoolRow }] = await Promise.all([
    supabase.from("classroom_teachers").select("id", { count: "exact", head: true }).eq("school_id", jobHead.school_id),
    supabase.from("schools").select("conflict_strategies, conflict_strategy").eq("id", jobHead.school_id).maybeSingle(),
  ]);
  const timeLimitS = pickTimeLimitS(teacherCount ?? 0);
  // The school's resolved strategies — drives the rescue strategy probe's
  // "lacks a rotation" entry condition (stepJob stays pure).
  const schoolStrategies: string[] = (schoolRow?.conflict_strategies as string[] | null)?.length
    ? (schoolRow!.conflict_strategies as string[])
    : [(schoolRow as any)?.conflict_strategy ?? "standard"];

  const mapRow = (r: any): JobRow => ({
    id: r.id, school_id: r.school_id, status: r.status, phase: r.phase, progress: r.progress ?? {},
    best_generation_id: r.best_generation_id, fallback_used: r.fallback_used, fallback_reason: r.fallback_reason,
    error: r.error, attempts: r.attempts ?? 0, started_at: r.started_at,
  });

  const deps: InvocationDeps = {
    schoolStrategies,
    now: () => Date.now(),
    timeLimitS,

    runCpsat: async (schoolId, tl): Promise<CpsatOutcome> => {
      const { status, body } = await callFn("generate-cpsat", { school_id: schoolId, time_limit_s: tl });
      if (status === 200 && body?.generation_id) {
        return { ok: true, generationId: body.generation_id, quality: Number(body.quality_percent ?? 0), solverStatus: body.solver_status ?? "" };
      }
      return { ok: false, unavailable: isSolverUnavailable(status, body?.code ?? null), code: body?.code ?? `http_${status}`, error: body?.error ?? `HTTP ${status}` };
    },

    runSearch: async (schoolId, strategiesOverride): Promise<SearchOutcome> => {
      const { status, body } = await callFn("generate-schedule",
        strategiesOverride?.length ? { school_id: schoolId, strategies_override: strategiesOverride } : { school_id: schoolId });
      if (status === 200 && body?.generation_id && !body?.error) {
        return { ok: true, generationId: body.generation_id, quality: qualityPercent(body.score_breakdown ?? null) };
      }
      return { ok: false, error: body?.error ?? `HTTP ${status}` };
    },

    runRefine: async (generationId, seedSalt): Promise<RefineOutcome> => {
      const { status, body } = await callFn("refine-schedule", { generation_id: generationId, seed_salt: seedSalt });
      if (status === 200 && !body?.error) {
        return {
          ok: true, improved: !!body?.improved, generationId: body?.generation_id ?? null,
          quality: typeof body?.quality_percent === "number" ? body.quality_percent : null,
          structurallyLimited: body?.confidence?.assessment === "structurally_limited",
        };
      }
      return { ok: false, error: body?.error ?? `HTTP ${status}` };
    },

    deleteGeneration: async (id) => { try { await supabase.from("schedule_generations").delete().eq("id", id); } catch { /* best-effort */ } },

    claimIfQueued: async (id) => {
      const nowIso = new Date().toISOString();
      const { data } = await supabase.from("generation_jobs")
        .update({ status: "running", phase: "cpsat", started_at: nowIso, updated_at: nowIso })
        .eq("id", id).eq("status", "queued").select("*").maybeSingle();
      return data ? mapRow(data) : null;
    },

    load: async (id) => {
      const { data } = await supabase.from("generation_jobs").select("*").eq("id", id).maybeSingle();
      return data ? mapRow(data) : null;
    },

    save: async (id, expectedAttempts, update) => {
      const { data } = await supabase.from("generation_jobs")
        .update({ ...update, attempts: expectedAttempts + 1, updated_at: new Date().toISOString() })
        .eq("id", id).eq("attempts", expectedAttempts).select("id").maybeSingle();
      return !!data;
    },

    reinvoke: (id) => {
      // Fire-and-forget the next step; keep the function alive until it's dispatched.
      const p = fetch(`${SUPABASE_URL}/functions/v1/run-generation-job`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: id }),
      }).catch(() => {});
      // @ts-ignore EdgeRuntime is provided by the Supabase runtime.
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p);
    },
  };

  try {
    const result = await runInvocation(deps, job_id);
    // Server-side completion notification, so it fires even if the user closed the
    // page (the whole point of the async pipeline).
    if (result.done && result.status === "complete") {
      try {
        const { data: j } = await supabase.from("generation_jobs").select("requested_by, fallback_used").eq("id", job_id).maybeSingle();
        if (j?.requested_by) {
          await supabase.from("notifications").insert({
            user_id: j.requested_by, type: "schedule_generated", title: "Schedule ready",
            message: `Your schedule is ready${j.fallback_used ? " (generated with the fallback engine)" : ""} — open the Master Schedule to review.`,
          });
        }
      } catch { /* notification is best-effort */ }
    }
    return json(200, result);
  } catch (e: any) {
    // Never leave a job wedged: record the error so the client stops waiting.
    await supabase.from("generation_jobs").update({ status: "failed", error: e?.message ?? "worker crashed", updated_at: new Date().toISOString() }).eq("id", job_id).neq("status", "complete");
    reportEdgeError(e, { function: "run-generation-job", generation_id: job_id });
    return json(500, { error: e?.message ?? "worker error" });
  }
});
