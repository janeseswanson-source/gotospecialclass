import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { anthropicApiKey, anthropicClient, MODELS, firstToolUse, describeAnthropicError } from "../_shared/anthropic.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!anthropicApiKey()) {
      return new Response(JSON.stringify({ error: "Claude isn't set up yet — add the ANTHROPIC_API_KEY secret." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Per-user rate limit (20/hr) — logs the attempt to ai_usage_log as it checks.
    const supabaseAdmin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const rl = await enforceRateLimit(supabaseAdmin, { userId: user.id, feature: "parse_specialist_template", limit: 20 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

    const { rows } = await req.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return new Response(JSON.stringify({ error: "No rows provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Serialize the raw spreadsheet grid as a compact TSV string for the model.
    const tsv = rows
      .map((r: any[]) => (Array.isArray(r) ? r.map((c) => (c ?? "").toString().replace(/\s+/g, " ").trim()).join("\t") : ""))
      .join("\n");

    const systemPrompt = `You normalize a school's "Specialist Teacher" spreadsheet into structured data.

You will receive the raw cells of a sheet (tab-separated, one row per line). The sheet may start with a title row and instruction row, followed by a header row, then data rows, then a footer row. Find the header row, ignore decorative rows, and extract one entry per real specialist.

Mapping rules:
- subject MUST be one of: Art, Music, PE, Library, STEAM, Technology, Science Lab, Garden, Other. Pick the closest match (e.g. "Phys Ed" -> "PE", "Computer" -> "Technology").
- working_days MUST be a subset of ["Mon","Tue","Wed","Thu","Fri"]. Parse phrases like "Mon-Fri", "MWF", "Tuesdays and Thursdays", "All", blank ("blank" means all five days).
- two_schools: true if the row says Yes / Y / true / checked; false otherwise.
- Omit any row that has no name AND no subject AND no location (decorative/empty row).
- Phone and email may be blank; include them only when present.

Add a warning for anything ambiguous or unmapped.`;

    const EXTRACT_TOOL = {
      name: "extract_specialists",
      description: "Return one entry per real specialist teacher row.",
      input_schema: {
        type: "object",
        properties: {
          specialists: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                phone: { type: "string" },
                email: { type: "string" },
                subject: { type: "string", enum: ["Art", "Music", "PE", "Library", "STEAM", "Technology", "Science Lab", "Garden", "Other"] },
                location: { type: "string" },
                working_days: { type: "array", items: { type: "string", enum: ["Mon", "Tue", "Wed", "Thu", "Fri"] } },
                two_schools: { type: "boolean" },
                second_school_name: { type: "string" },
              },
              required: ["name", "subject", "working_days"],
            },
          },
          warnings: {
            type: "array",
            items: {
              type: "object",
              properties: { row: { type: "number" }, message: { type: "string" } },
              required: ["message"],
            },
          },
        },
        required: ["specialists", "warnings"],
      },
    };

    let extracted: any = { specialists: [], warnings: [] };
    try {
      const resp = await anthropicClient().messages.create({
        model: MODELS.fast,
        max_tokens: 4000,
        system: systemPrompt,
        tools: [EXTRACT_TOOL as any],
        tool_choice: { type: "tool", name: "extract_specialists" },
        messages: [{ role: "user", content: `Specialist sheet:\n\n${tsv}` }],
      });
      extracted = firstToolUse(resp.content as any[], "extract_specialists")?.input ?? extracted;
    } catch (err) {
      const { status, message } = describeAnthropicError(err);
      return new Response(JSON.stringify({ error: message }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(extracted), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("parse-specialist-template error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
