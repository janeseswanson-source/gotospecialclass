// parse-recess-nl — turn a plain-English recess/lunch description into structured
// grade-band windows the Recess & Lunch step can quick-fill. Mirrors parse-clubs-nl
// (AI-SDK generateText + strict JSON), on MODELS.fast.
//   e.g. "K-2 recess 10:00-10:20, lunch 11:30-12:00. 3-5 lunch 12:00, PM recess 2:00."
import { createClient } from "npm:@supabase/supabase-js@2";
import { generateText } from "npm:ai";
import { anthropicApiKey, MODELS } from "../_shared/anthropic.ts";
import { anthropicModel } from "../_shared/anthropic-aisdk.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

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

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const rl = await enforceRateLimit(admin, { userId: userData.user.id, feature: "parse_recess_nl", limit: 20 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  if (!anthropicApiKey()) return json(500, { error: "Claude isn't set up yet — add the ANTHROPIC_API_KEY secret." });

  let body: { description?: string };
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  const desc = (body.description ?? "").trim();
  if (!desc) return json(400, { error: "description required" });
  if (desc.length > 5000) return json(400, { error: "description too long (max 5000 chars)" });

  const model = anthropicModel(MODELS.fast);

  const prompt = `Extract recess & lunch windows per grade band from the user's description. Be lenient — fill only what's stated, use null for missing fields. Use 24-hour "HH:MM".

Each row: {
  "grade_band": string  (e.g. "K-2", "3-5", or "all" if it applies to the whole school),
  "am_recess_start": "HH:MM"|null, "am_recess_end": "HH:MM"|null,
  "lunch_start": "HH:MM"|null, "lunch_end": "HH:MM"|null,
  "pm_recess_start": "HH:MM"|null, "pm_recess_end": "HH:MM"|null
}

If only a start time is given for a window, infer a sensible end (recess ~15 min, lunch ~30 min). Merge mentions of the same band into one row.

Return STRICT JSON only, shape: {"rows": [ ... ]}. No prose, no markdown fences.

USER DESCRIPTION:
${desc}`;

  try {
    const { text } = await generateText({ model, prompt });
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let parsed: { rows?: unknown[] } = {};
    try { parsed = JSON.parse(cleaned); } catch { return json(502, { error: "AI returned invalid JSON", raw: text.slice(0, 400) }); }
    return json(200, { rows: Array.isArray(parsed.rows) ? parsed.rows : [] });
  } catch (err: any) {
    console.error("[parse-recess-nl] failed", err);
    return json(500, { error: err?.message ?? "Generation failed" });
  }
});
