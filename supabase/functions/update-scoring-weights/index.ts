// Learnable-weights loop (Phase 4) — human-gated.
//
// "propose" (default): observe the admin's manual edits to a generation, infer a
//   CLAMPED weight nudge via inverse optimization (_weightlearning.ts), and STAGE
//   it in `proposed_weights`. Active weights are NOT changed. The admin reviews
//   the proposal and confirms it.
// "confirm": copy the staged proposal into the active `weights` (a new explicit
//   input to future generations — not hidden state), bump sample_count, clear the
//   proposal.
//
// Weights stay within ±50% of their defaults and hard-constraint terms
// (errors/warnings) are never reweighted. Nothing is auto-applied.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { proposeWeightDeltas } from "./_engine/_weightlearning.ts";
import { scoreSchedule, DEFAULT_WEIGHTS, type ScoreableInput, type ScoreBreakdown } from "./_engine/_scoring.ts";
import { computeWarnings, type Block, type Specialist, type Teacher } from "./_engine/index.ts";

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

    const body = await req.json() as { school_id: string; generation_id?: string; action?: "propose" | "confirm" };
    if (!body?.school_id) return json(400, { error: "school_id required" });
    const action = body.action ?? "propose";

    const { data: existing } = await supabase
      .from("scoring_weight_profiles")
      .select("*")
      .eq("school_id", body.school_id)
      .maybeSingle();

    const currentWeights: Record<string, number> = { ...DEFAULT_WEIGHTS, ...(existing?.weights as Record<string, number> ?? {}) };
    const sampleCount: number = existing?.sample_count ?? 0;

    // ── CONFIRM: apply the staged proposal as a new explicit input ──────────
    if (action === "confirm") {
      const proposed = existing?.proposed_weights as Record<string, number> | null | undefined;
      if (!proposed) return json(400, { error: "No staged weight proposal to confirm." });
      const { error } = await supabase.from("scoring_weight_profiles").upsert({
        school_id: body.school_id,
        weights: proposed,
        sample_count: sampleCount + 1,
        proposed_weights: null,
        proposed_at: null,
        last_updated: new Date().toISOString(),
      }, { onConflict: "school_id" });
      if (error) return json(500, { error: error.message });
      return json(200, { applied: true, sample_count: sampleCount + 1, weights: proposed });
    }

    // ── PROPOSE: infer a clamped nudge from the admin's edits ───────────────
    if (!body.generation_id) return json(400, { error: "generation_id required for propose" });

    const { data: gen, error: genErr } = await supabase
      .from("schedule_generations")
      .select("id, school_id, score_breakdown")
      .eq("id", body.generation_id)
      .maybeSingle();
    if (genErr || !gen) return json(404, { error: "Generation not found" });
    if (gen.school_id !== body.school_id) return json(403, { error: "Forbidden" });

    const originalBreakdown = (gen.score_breakdown ?? null) as Record<string, number> | null;
    if (!originalBreakdown) return json(200, { proposed: false, reason: "Generation has no original score_breakdown to compare against." });

    const [blocksRes, specRes, teachRes, schoolRes] = await Promise.all([
      supabase.from("schedule_blocks").select("*").eq("generation_id", body.generation_id),
      supabase.from("specialists").select("*").eq("school_id", body.school_id),
      supabase.from("classroom_teachers").select("*").eq("school_id", body.school_id),
      supabase.from("schools").select("*").eq("id", body.school_id).maybeSingle(),
    ]);
    const editedBlocks = (blocksRes.data ?? []) as Block[];
    const specialists = (specRes.data ?? []) as Specialist[];
    const teachers = (teachRes.data ?? []) as Teacher[];
    const school = schoolRes.data ?? {};
    const grades: string[] = (school as any).grades_served ?? [];

    const scoringInput: ScoreableInput = {
      school: {
        start_time: (school as any).start_time, end_time: (school as any).end_time,
        early_release_day: (school as any).early_release_day, early_release_end_time: (school as any).early_release_end_time,
        keep_grades_together: (school as any).keep_grades_together ?? true,
        contractual_minutes_extracted: (school as any).contractual_minutes_extracted ?? null,
      },
      specialists: specialists.map((s) => ({ id: s.id, subject: s.subject, working_days: s.working_days })),
      teachers: teachers.map((t) => ({ id: t.id, am_pm_preference: t.am_pm_preference, day_preference: t.day_preference, weekly_planning_minutes: t.weekly_planning_minutes })),
      grades,
    };
    // Edited (admin-preferred) breakdown, scored with the SAME current weights as
    // the original so |breakdown_k| ∝ count_k and the inverse-opt gradient is valid.
    const editedWarnings = computeWarnings(editedBlocks, specialists, grades, teachers);
    const editedBreakdown = scoreSchedule({ blocks: editedBlocks, warnings: editedWarnings, preferenceViolations: [] }, scoringInput, currentWeights as Partial<Record<keyof ScoreBreakdown, number>>).breakdown as unknown as Record<string, number>;

    const proposal = proposeWeightDeltas(originalBreakdown, editedBreakdown, currentWeights, DEFAULT_WEIGHTS);
    if (proposal.deltas.length === 0) {
      return json(200, { proposed: false, reason: "Your edits did not change any soft-quality trade-off.", summary: proposal.summary });
    }

    // Stage the proposal — DO NOT touch active weights.
    const { error: upsertErr } = await supabase.from("scoring_weight_profiles").upsert({
      school_id: body.school_id,
      weights: existing?.weights ?? DEFAULT_WEIGHTS,
      sample_count: sampleCount,
      proposed_weights: proposal.proposedWeights,
      proposed_at: new Date().toISOString(),
      last_updated: existing?.last_updated ?? new Date().toISOString(),
    }, { onConflict: "school_id" });
    if (upsertErr) return json(500, { error: upsertErr.message });

    return json(200, {
      proposed: true,
      summary: proposal.summary,
      deltas: proposal.deltas,
      proposed_weights: proposal.proposedWeights,
      // The admin confirms with: POST { school_id, action: "confirm" }
      confirm_hint: "Review the deltas; POST action=confirm to apply to future generations.",
    });
  } catch (e: any) {
    return json(500, { error: e?.message ?? "Unknown error" });
  }
});
