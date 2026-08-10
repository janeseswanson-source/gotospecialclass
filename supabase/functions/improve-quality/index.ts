// improve-quality — PREVIEW-ONLY engine pass behind the QualityPanel's one-click
// "Fix" buttons. Runs the same deterministic, perturbation-anchored
// improveQualityScoped core the chat's improve_quality tool uses, scoped to one
// penalty key (or one specialist), and returns the move set as proposable ops.
// It NEVER applies anything — the client shows the ghost preview + Apply bar and
// commits via apply-schedule-edits (full SSOT re-validation there).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { improveQualityScoped, qualityReport, type EditBlock, type EditToolContext } from "./_engine/_editTools.ts";
import type { Specialist } from "./_engine/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json(401, { error: "Unauthorized" });

    const body = await req.json() as { generation_id?: string; focus?: string; specialist_id?: string; mode?: "preview" | "report" };
    if (!body?.generation_id) return json(400, { error: "generation_id required" });

    const { data: gen, error: genErr } = await supabase
      .from("schedule_generations").select("id, school_id")
      .eq("id", body.generation_id).maybeSingle();
    if (genErr || !gen) return json(404, { error: "Generation not found" });

    const [blocksRes, specRes, teachRes, recessRes, schoolRes] = await Promise.all([
      supabase.from("schedule_blocks").select("*").eq("generation_id", body.generation_id),
      supabase.from("specialists").select("*").eq("school_id", gen.school_id),
      supabase.from("classroom_teachers").select("id, name, grade, room, am_pm_preference, day_preference, weekly_planning_minutes").eq("school_id", gen.school_id),
      supabase.from("recess_lunch_config").select("*").eq("school_id", gen.school_id),
      // select("*") on purpose: an explicit column list silently 400s the WHOLE
    // row the moment a migration adds a column the live DB lacks, and it also
    // quietly starved the engine of newer settings (rotations_start_time, the
    // teacher duty day). A single school row is cheap to fetch whole.
    supabase.from("schools").select("*").eq("id", gen.school_id).maybeSingle(),
    ]);

    const blocks = (blocksRes.data ?? []) as EditBlock[];
    const school = schoolRes.data ?? {};
    const ctx: EditToolContext = {
      school, recessConfigs: recessRes.data ?? [],
      specialists: (specRes.data ?? []) as unknown as Specialist[],
      teachers: (teachRes.data ?? []) as any,
      grades: (school as any).grades_served ?? [],
    };

    if (body.mode === "report") {
      const r = qualityReport(blocks, ctx);
      return json(200, { quality_percent: r.percent, issues: r.issues, warnings: r.warnings });
    }

    const r = improveQualityScoped(
      { focus: body.focus ?? null, specialist_id: body.specialist_id ?? null, seedKey: `iq:${body.generation_id}:${body.focus ?? body.specialist_id ?? "auto"}` },
      blocks, ctx,
    );
    return json(200, {
      ops: r.ops,
      quality_before: r.quality_before,
      quality_after: r.quality_after,
      quality_delta: r.quality_delta,
      moved_blocks: r.moved_blocks,
      focus: r.focus,
      note: r.note,
    });
  } catch (e: any) {
    return json(500, { error: e?.message ?? "Unknown error" });
  }
});
