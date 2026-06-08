import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Default weights matching _scoring.ts DEFAULT_WEIGHTS
const DEFAULT_WEIGHTS: Record<string, number> = {
  errors: -1000,
  warnings: -50,
  full_week_coverage: 100,
  am_pm_satisfied: 10,
  day_pref_satisfied: 20,
  planning_target_met: 30,
  cart_back_to_back: -5,
  k_grade_after_780: -3,
  spec_dayload_stdev: -1,
  class_repeats: -8,
};

// Clamp weight to ±50% of the original default value
function clampWeight(key: string, value: number): number {
  const def = DEFAULT_WEIGHTS[key];
  if (def === undefined) return value;
  const min = def * (def > 0 ? 0.5 : 1.5);
  const max = def * (def > 0 ? 1.5 : 0.5);
  return Math.max(min, Math.min(max, value));
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

    const body = await req.json() as { school_id: string; generation_id: string };
    if (!body?.school_id || !body?.generation_id) {
      return json(400, { error: "school_id and generation_id required" });
    }

    const { data: gen, error: genErr } = await supabase
      .from("schedule_generations")
      .select("id, school_id, feedback_signal, score_breakdown")
      .eq("id", body.generation_id)
      .maybeSingle();
    if (genErr || !gen) return json(404, { error: "Generation not found" });
    if (gen.school_id !== body.school_id) return json(403, { error: "Forbidden" });

    const feedbackSignal: string | null = gen.feedback_signal ?? null;
    if (!feedbackSignal) return json(200, { updated: false, reason: "No feedback signal" });

    // Load or create weight profile
    const { data: existing } = await supabase
      .from("scoring_weight_profiles")
      .select("*")
      .eq("school_id", body.school_id)
      .maybeSingle();

    const currentWeights: Record<string, number> = {
      ...DEFAULT_WEIGHTS,
      ...(existing?.weights as Record<string, number> ?? {}),
    };
    const sampleCount: number = existing?.sample_count ?? 0;

    // Apply EMA update based on feedback signal
    const updated = { ...currentWeights };
    if (feedbackSignal === "regenerated") {
      // Teacher regenerated — preferences weren't met; boost preference weights, reduce coverage
      updated.full_week_coverage = clampWeight("full_week_coverage", currentWeights.full_week_coverage * 0.98);
      updated.am_pm_satisfied = clampWeight("am_pm_satisfied", currentWeights.am_pm_satisfied * 1.02);
      updated.day_pref_satisfied = clampWeight("day_pref_satisfied", currentWeights.day_pref_satisfied * 1.02);
    } else if (feedbackSignal === "heavily_edited") {
      // Manual edits — distribution wasn't the problem, reduce stdev penalty
      updated.spec_dayload_stdev = clampWeight("spec_dayload_stdev", currentWeights.spec_dayload_stdev * 0.95);
    }
    // "accepted" → no change (current weights produced a good result)

    const { error: upsertErr } = await supabase
      .from("scoring_weight_profiles")
      .upsert({
        school_id: body.school_id,
        weights: updated,
        sample_count: sampleCount + 1,
        last_updated: new Date().toISOString(),
      }, { onConflict: "school_id" });

    if (upsertErr) return json(500, { error: upsertErr.message });

    return json(200, { updated: true, sample_count: sampleCount + 1, feedback_signal: feedbackSignal });
  } catch (e: any) {
    return json(500, { error: e?.message ?? "Unknown error" });
  }
});
