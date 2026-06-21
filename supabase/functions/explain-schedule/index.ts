// Generate one-sentence natural-language explanations per block for a generation.
// Called from the client after generation/replan when blocks lack ai_explanation.
import { createClient } from "npm:@supabase/supabase-js@2";
import { generateText } from "npm:ai";
import { anthropicApiKey } from "../_shared/anthropic.ts";
import { anthropicModel } from "../_shared/anthropic-aisdk.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: "Unauthorized" });

  if (!anthropicApiKey()) return json(500, { error: "Claude isn't set up yet — add the ANTHROPIC_API_KEY secret." });

  let body: { generation_id?: string };
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  if (!body.generation_id) return json(400, { error: "generation_id required" });

  const { data: gen } = await supabase
    .from("schedule_generations")
    .select("id, school_id, chosen_strategy")
    .eq("id", body.generation_id)
    .maybeSingle();
  if (!gen) return json(404, { error: "Generation not found" });

  const { data: school } = await supabase
    .from("schools")
    .select("ai_explanations_enabled, name, conflict_grades")
    .eq("id", gen.school_id)
    .maybeSingle();
  if (!school?.ai_explanations_enabled) return json(200, { skipped: true });

  const [{ data: blocks }, { data: specs }, { data: teachers }] = await Promise.all([
    supabase.from("schedule_blocks").select("id, day_of_week, start_time, end_time, subject, specialist_id, teacher_id, grade, week_label, ai_explanation").eq("generation_id", body.generation_id),
    supabase.from("specialists").select("id, name, subject").eq("school_id", gen.school_id),
    supabase.from("classroom_teachers").select("id, name, grade").eq("school_id", gen.school_id),
  ]);

  const pending = (blocks ?? []).filter((b: any) => !b.ai_explanation);
  if (pending.length === 0) return json(200, { explained: 0, total: blocks?.length ?? 0 });

  const specMap = new Map((specs ?? []).map((s: any) => [s.id, s]));
  const teachMap = new Map((teachers ?? []).map((t: any) => [t.id, t]));

  const compact = pending.slice(0, 250).map((b: any) => ({
    id: b.id,
    line: `${b.day_of_week} ${String(b.start_time).slice(0, 5)}-${String(b.end_time).slice(0, 5)} | ${b.subject} | Gr ${b.grade ?? "—"} | ${b.specialist_id ? specMap.get(b.specialist_id)?.name ?? "?" : "—"} → ${b.teacher_id ? teachMap.get(b.teacher_id)?.name ?? "?" : "—"}${b.week_label ? ` [W${b.week_label}]` : ""}`,
  }));

  const model = anthropicModel();

  const prompt = `You are explaining why each block landed where it did in a K-6 specials schedule.
For each block id, write ONE short sentence (max 18 words) of teacher-friendly reasoning. Mention things like grade-band fit, teacher availability, balance across days, or rotation week if relevant. Be specific, not generic.

Strategy in use: ${gen.chosen_strategy ?? "standard"}. Conflict grades: ${(school as any).conflict_grades?.join(", ") || "none"}.

Return STRICT JSON only, shape: {"explanations": {"<block_id>": "<sentence>", ...}}. No prose, no markdown.

BLOCKS:
${compact.map((c) => `${c.id}: ${c.line}`).join("\n")}`;

  try {
    const { text } = await generateText({ model, prompt });
    // Be defensive: model may add fences.
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let parsed: { explanations?: Record<string, string> } = {};
    try { parsed = JSON.parse(cleaned); } catch { parsed = {}; }
    const explanations = parsed.explanations ?? {};
    let updated = 0;
    for (const [id, sentence] of Object.entries(explanations)) {
      if (typeof sentence !== "string") continue;
      const { error } = await supabase.from("schedule_blocks").update({ ai_explanation: sentence.slice(0, 400) }).eq("id", id);
      if (!error) updated++;
    }
    return json(200, { explained: updated, total: pending.length });
  } catch (err: any) {
    console.error("[explain-schedule] failed", err);
    return json(500, { error: err?.message ?? "Generation failed" });
  }
});
