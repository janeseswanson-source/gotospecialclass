// generate-lesson-starter — an OPTIONAL draft objective/materials/activities for
// a single scheduled specialist session. Uses the cheap/fast model tier. The
// client PROPOSES this into the editor; it is never auto-saved. No key → a plain
// generic template so the button still does something useful offline.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { anthropicClient, anthropicApiKey, MODELS, firstToolUse } from "../_shared/anthropic.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface Starter {
  objective: string;
  materials: string;
  activities: string[];
}

function fallback(subject: string, grade: string, minutes: number): Starter {
  const g = grade ? `Grade ${grade}` : "the class";
  return {
    objective: `Students will explore a core ${subject || "specials"} skill and practice it with guidance.`,
    materials: `Standard ${subject || "specials"} supplies for ${g}.`,
    activities: [
      `Warm-up (5 min): quick review to focus ${g}.`,
      `Mini-lesson (${Math.max(10, Math.round(minutes * 0.3))} min): introduce today's ${subject || "skill"} focus.`,
      `Guided practice (${Math.max(10, Math.round(minutes * 0.4))} min): students try it with support.`,
      `Share & reflect (5 min): a few students share; recap the goal.`,
    ],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = await req.json() as { subject?: string; grade?: string; duration_minutes?: number };
    const subject = (body.subject ?? "").toString().slice(0, 60);
    const grade = (body.grade ?? "").toString().slice(0, 12);
    const minutes = Math.min(180, Math.max(15, Number(body.duration_minutes) || 45));

    // Per-user rate limit (20/hr). Signed-in only (verify_jwt = true).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json(401, { error: "Unauthorized" });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const rl = await enforceRateLimit(admin, { userId: user.id, feature: "generate_lesson_starter", limit: 20 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

    if (!anthropicApiKey()) {
      return json(200, { ...fallback(subject, grade, minutes), source: "fallback" });
    }

    const TOOL = {
      name: "write_lesson_starter",
      description: "Return a concise, age-appropriate starter for one elementary specials session: a single measurable objective, a short materials line, and 3–5 timed activities that fit the session length.",
      input_schema: {
        type: "object",
        properties: {
          objective: { type: "string", description: "One 'Students will be able to…' objective." },
          materials: { type: "string", description: "A short comma-friendly materials line." },
          activities: { type: "array", items: { type: "string" }, description: "3–5 timed steps, e.g. 'Warm-up (5 min): …'." },
        },
        required: ["objective", "materials", "activities"],
      },
    };

    const sys = "You are an experienced elementary specials teacher (art, music, PE, library, STEM, etc.). Write practical, encouraging, age-appropriate lesson starters. Keep it concrete and brief — a teacher will edit it. Never invent specific copyrighted curricula.";
    const usr = `Draft a lesson starter for a ${minutes}-minute ${subject || "specials"} session${grade ? ` with Grade ${grade}` : ""}. One measurable objective, a short materials line, and 3–5 timed activities that add up to about ${minutes} minutes.`;

    try {
      const resp = await anthropicClient().messages.create({
        model: MODELS.fast,
        max_tokens: 500,
        system: sys,
        tools: [TOOL as any],
        tool_choice: { type: "tool", name: "write_lesson_starter" },
        messages: [{ role: "user", content: usr }],
      });
      const out = firstToolUse(resp.content as any[], "write_lesson_starter")?.input as Starter | undefined;
      if (!out?.objective) return json(200, { ...fallback(subject, grade, minutes), source: "fallback" });
      return json(200, {
        objective: out.objective,
        materials: out.materials ?? "",
        activities: Array.isArray(out.activities) ? out.activities.filter((a) => typeof a === "string") : [],
        source: "ai",
      });
    } catch (e) {
      console.warn("[generate-lesson-starter] model failed, using fallback:", e);
      return json(200, { ...fallback(subject, grade, minutes), source: "fallback" });
    }
  } catch (e: any) {
    return json(500, { error: e?.message ?? "Unknown error" });
  }
});
