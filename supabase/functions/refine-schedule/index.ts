// Background refinement endpoint (Phase 1).
//
// The inline generate-schedule path returns a fast, valid schedule under the edge
// ~2s CPU ceiling. THIS function runs the heavy SA + LNS refinement out of that
// path: it loads a persisted generation, pushes its soft quality further with the
// deterministic engine, and — only if the result is strictly better AND SSOT-legal
// — writes it as a NEW version. Otherwise it returns the confidence signal so the
// UI can say "near-optimal" / "more headroom" / "structurally limited".
//
// The client calls this after generation (and may call again for another pass).
// No LLM involvement: this is the deterministic engine placing + validating.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { refineSchedule, type RefineTeacher } from "../generate-schedule/_refine.ts";
import { computePlacementReason, type Block, type Specialist } from "../generate-schedule/index.ts";
import type { ScoreBreakdown } from "../generate-schedule/_scoring.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json(401, { error: "Unauthorized" });

    const body = await req.json() as { generation_id?: string; lns_rounds?: number; sa_iterations?: number };
    if (!body?.generation_id) return json(400, { error: "generation_id required" });

    const { data: gen, error: genErr } = await supabase
      .from("schedule_generations")
      .select("id, school_id, version, quote, score_breakdown")
      .eq("id", body.generation_id)
      .maybeSingle();
    if (genErr || !gen) return json(404, { error: "Generation not found" });

    const schoolId = gen.school_id;

    const [schoolRes, specRes, teachRes, recessRes, blocksRes, weightProfileRes] = await Promise.all([
      supabase.from("schools").select("*").eq("id", schoolId).single(),
      supabase.from("specialists").select("*").eq("school_id", schoolId),
      supabase.from("classroom_teachers").select("*").eq("school_id", schoolId),
      supabase.from("recess_lunch_config").select("*").eq("school_id", schoolId),
      supabase.from("schedule_blocks").select("*").eq("generation_id", body.generation_id),
      supabase.from("scoring_weight_profiles").select("*").eq("school_id", schoolId).maybeSingle(),
    ]);

    const school = schoolRes.data;
    if (!school) return json(404, { error: "School not found" });

    const specialists: Specialist[] = (specRes.data ?? []).map((s: any) => ({
      id: s.id, name: s.name, subject: s.subject, working_days: s.working_days,
      planning_minutes: s.planning_minutes, lunch_minutes: s.lunch_minutes,
      uses_cart: s.uses_cart ?? false, two_schools: s.two_schools ?? false,
      is_part_time: s.is_part_time ?? false, part_time_planning_minutes: s.part_time_planning_minutes,
      part_time_lunch_minutes: s.part_time_lunch_minutes, grade_rotation: s.grade_rotation,
      location: s.location, second_location: s.second_location,
      weekly_planning_minutes: s.weekly_planning_minutes, class_duration: s.class_duration ?? null,
      plus_rotation: s.plus_rotation ?? null,
    }));
    const teachers: RefineTeacher[] = (teachRes.data ?? []).map((t: any) => ({
      id: t.id, grade: t.grade, am_pm_preference: t.am_pm_preference,
      day_preference: t.day_preference, weekly_planning_minutes: t.weekly_planning_minutes,
    }));
    const recessConfigs = recessRes.data ?? [];
    const grades: string[] = school.grades_served ?? [];
    const persistedBlocks = (blocksRes.data ?? []) as Block[];

    if (persistedBlocks.length === 0) return json(400, { error: "Generation has no blocks to refine" });

    // Learned weights (same gate as generate-schedule): only after >= 5 samples.
    const weightProfile = weightProfileRes.data;
    const weightOverrides: Partial<Record<keyof ScoreBreakdown, number>> | undefined =
      weightProfile && (weightProfile.sample_count ?? 0) >= 5
        ? (weightProfile.weights as Partial<Record<keyof ScoreBreakdown, number>>)
        : undefined;

    const result = refineSchedule(persistedBlocks, { specialists, teachers, grades, school, recessConfigs }, {
      seedKey: `${body.generation_id}:v${gen.version}`,
      lnsRounds: typeof body.lns_rounds === "number" ? body.lns_rounds : 150,
      saMaxIterations: typeof body.sa_iterations === "number" ? body.sa_iterations : 1500,
      weightOverrides,
    });

    // Not improved → no new version; just report confidence so the UI can advise.
    if (!result.improved) {
      return json(200, {
        improved: false,
        generation_id: body.generation_id,
        quality_percent: result.qualityPercent,
        previous_quality_percent: result.previousQualityPercent,
        confidence: result.confidence,
      });
    }

    // Improved → write a NEW version (atomic: the old version is never mutated).
    const { data: lastGen } = await supabase
      .from("schedule_generations")
      .select("version")
      .eq("school_id", schoolId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (lastGen?.version ?? gen.version) + 1;

    const { data: newGen, error: newGenErr } = await supabase
      .from("schedule_generations")
      .insert({
        school_id: schoolId,
        version: nextVersion,
        status: "complete",
        quote: gen.quote,
        generated_at: new Date().toISOString(),
        score_breakdown: result.scoreBreakdown,
        winning_score: result.score,
        refined_from_generation_id: body.generation_id,
      })
      .select("id")
      .single();
    if (newGenErr || !newGen) return json(500, { error: `Failed to create refined generation: ${newGenErr?.message}` });

    const specById = Object.fromEntries(specialists.map((s) => [s.id, s]));
    // Full teacher rows (name/room/etc.) for placement-reason narration.
    const teacherById: Record<string, any> = Object.fromEntries((teachRes.data ?? []).map((t: any) => [t.id, t]));
    const conflictGrades: string[] = school.conflict_grades ?? [];

    // Re-key blocks onto the new generation, dropping ids; recompute placement
    // reasons for moved blocks but keep any carried annotation.
    const rows = result.blocks.map((b: any) => ({
      generation_id: newGen.id,
      day_of_week: b.day_of_week,
      start_time: b.start_time,
      end_time: b.end_time,
      subject: b.subject,
      specialist_id: b.specialist_id || null,
      teacher_id: b.teacher_id,
      grade: b.grade,
      room: b.room,
      week_label: b.week_label,
      notes: b.notes ?? null,
      is_override: b.is_override ?? false,
      placement_reason: b.placement_reason ?? computePlacementReason(b as Block, {
        specialist: b.specialist_id ? specById[b.specialist_id] : null,
        teacher: b.teacher_id ? teacherById[b.teacher_id] : null,
        school,
        conflictGrades,
        chosenStrategy: "refined",
      }),
      ai_explanation: b.ai_explanation ?? null,
    }));

    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const { error: insErr } = await supabase.from("schedule_blocks").insert(rows.slice(i, i + batchSize));
      if (insErr) return json(500, { error: `Block insert failed: ${insErr.message}` });
    }

    return json(200, {
      improved: true,
      generation_id: newGen.id,
      refined_from_generation_id: body.generation_id,
      version: nextVersion,
      blocks_count: rows.length,
      quality_percent: result.qualityPercent,
      previous_quality_percent: result.previousQualityPercent,
      score_breakdown: result.scoreBreakdown,
      confidence: result.confidence,
      sa_iterations: result.saIterations,
      lns_rounds: result.lnsRounds,
      lns_accepted: result.lnsAccepted,
    });
  } catch (e: any) {
    console.error("refine-schedule error:", e);
    return json(500, { error: e?.message ?? "Unknown error" });
  }
});
