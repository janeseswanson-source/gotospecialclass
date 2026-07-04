// Parse a free-text description of clubs/events into structured rows.
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
  const rl = await enforceRateLimit(admin, { userId: userData.user.id, feature: "parse_clubs_nl", limit: 20 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  if (!anthropicApiKey()) return json(500, { error: "Claude isn't set up yet — add the ANTHROPIC_API_KEY secret." });

  let body: { description?: string; kind?: "clubs" | "events" };
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  const desc = (body.description ?? "").trim();
  const kind = body.kind === "events" ? "events" : "clubs";
  if (!desc) return json(400, { error: "description required" });
  if (desc.length > 5000) return json(400, { error: "description too long (max 5000 chars)" });

  const model = anthropicModel(MODELS.fast);

  const schemaHint = kind === "clubs"
    ? `Each row: { "name": string, "day_of_week": "Mon"|"Tue"|"Wed"|"Thu"|"Fri"|null, "start_time": "HH:MM"|null, "end_time": "HH:MM"|null, "grades": string[] (e.g. ["3","4","5"]), "leader": string|null, "location": string|null }`
    : `Each row: { "name": string, "date": "YYYY-MM-DD"|null, "start_time": "HH:MM"|null, "end_time": "HH:MM"|null, "grades": string[], "notes": string|null }`;

  const prompt = `Extract a list of ${kind} from the user's description. Be lenient — only fill what's plausible from the text, use null for missing fields.

${schemaHint}

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
    console.error("[parse-clubs-nl] failed", err);
    return json(500, { error: err?.message ?? "Generation failed" });
  }
});
