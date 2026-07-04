// generate-quote — an ORIGINAL 1–2 sentence motivational line for elementary
// educators/students, attributed to the product (never a real person, never
// copyrighted text). Uses the cheap/fast model tier. Persists to the quotes
// table so exports are reproducible and the next call can avoid recent lines.
// No ANTHROPIC_API_KEY → rotate a small built-in original fallback set.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { anthropicClient, anthropicApiKey, MODELS, firstToolUse } from "../_shared/anthropic.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ATTRIBUTION = "— Specialist Ops!";

// Original, in-house fallback lines (no real-person quotes, no copyrighted text).
const FALLBACK: Record<string, string[]> = {
  teachers: [
    "A thoughtful schedule is the quiet gift you give every teacher's week.",
    "When specialists have room to breathe, whole classrooms feel it.",
    "Great weeks aren't lucky — they're planned with care.",
    "Every protected planning minute is a promise kept to a teacher.",
  ],
  students: [
    "Every child deserves a week with room to wonder.",
    "The best days are the ones where curiosity gets its turn.",
    "Art, music, movement — the parts of the day that make school sing.",
    "A steady schedule gives every learner a place to shine.",
  ],
  both: [
    "When the schedule works, teachers teach and students soar.",
    "Structure on the outside, freedom on the inside — that's a good school day.",
    "A calm, well-planned week is the foundation everyone builds on.",
    "The little details of a schedule add up to a school that feels like home.",
  ],
};

function seasonOf(dateIso?: string | null): string {
  const d = dateIso ? new Date(dateIso) : new Date();
  const m = d.getMonth();
  if (m <= 1 || m === 11) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "autumn (back-to-school season)";
}

function pickFallback(audience: string, avoid: string[]): string {
  const list = FALLBACK[audience] ?? FALLBACK.teachers;
  const fresh = list.filter((q) => !avoid.includes(q));
  const pool = fresh.length ? fresh : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

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

    const body = await req.json() as { school_id?: string; audience?: string; date?: string };
    const schoolId = body.school_id;
    const audience = (["teachers", "students", "both"].includes(body.audience ?? "") ? body.audience : "teachers") as string;
    if (!schoolId) return json(400, { error: "school_id required" });

    // RLS-gated: the user must be able to see the school.
    const { data: school } = await supabase.from("schools").select("id, name, workspace_id").eq("id", schoolId).maybeSingle();
    if (!school) return json(404, { error: "School not found" });

    // Per-user rate limit (20/hr).
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const rl = await enforceRateLimit(admin, { userId: user.id, workspaceId: (school as any).workspace_id, feature: "generate_quote", limit: 20 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

    // Avoid the last 10 lines for this school.
    const { data: recent } = await supabase.from("quotes")
      .select("text").eq("school_id", schoolId).order("created_at", { ascending: false }).limit(10);
    const avoid = (recent ?? []).map((r: any) => r.text as string);

    let text: string;
    if (anthropicApiKey()) {
      try {
        const QUOTE_TOOL = {
          name: "write_quote",
          description: "Return ONE original, uplifting 1-2 sentence line for an elementary school. It must be YOUR OWN words — never a quotation from a real person, never copyrighted or famous text, no attribution, no author name, no quotation marks.",
          input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        };
        const sys = "You write short, warm, ORIGINAL motivational lines for an elementary-school scheduling product. Never quote or paraphrase a real person or any known quotation. No author names, no quote marks. One or two sentences, plain and heartfelt.";
        const usr = `Audience: ${audience === "both" ? "teachers and students" : audience}. School: ${school.name ?? "an elementary school"}. Season: ${seasonOf(body.date)}.
${avoid.length ? `Do NOT repeat or closely echo any of these recent lines:\n- ${avoid.join("\n- ")}` : ""}
Write one fresh, original line.`;
        const resp = await anthropicClient().messages.create({
          model: MODELS.fast,
          max_tokens: 160,
          system: sys,
          tools: [QUOTE_TOOL as any],
          tool_choice: { type: "tool", name: "write_quote" },
          messages: [{ role: "user", content: usr }],
        });
        const out = firstToolUse(resp.content as any[], "write_quote")?.input as { text?: string } | undefined;
        text = (out?.text ?? "").trim().replace(/^["']|["']$/g, "");
        if (!text) text = pickFallback(audience, avoid);
      } catch (e) {
        console.warn("[generate-quote] model failed, using fallback:", e);
        text = pickFallback(audience, avoid);
      }
    } else {
      text = pickFallback(audience, avoid);
    }

    const { data: inserted } = await supabase.from("quotes")
      .insert({ school_id: schoolId, text, audience, created_by: user.id })
      .select("id, text, audience, created_at").single();

    return json(200, { id: inserted?.id ?? null, text, audience, attribution: ATTRIBUTION });
  } catch (e: any) {
    return json(500, { error: e?.message ?? "Unknown error" });
  }
});
