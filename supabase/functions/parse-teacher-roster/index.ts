// parse-teacher-roster — normalize a classroom-teacher roster (pasted text OR an
// uploaded spreadsheet's raw cells) into structured rows the Teachers step can
// review + commit. Mirrors parse-specialist-template: TSV in, forced tool out,
// MODELS.fast, friendly error surface via describeAnthropicError.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { anthropicApiKey, anthropicClient, MODELS, firstToolUse, describeAnthropicError } from "../_shared/anthropic.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";
import { reportEdgeError } from "../_shared/observability.ts";

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

    const supabaseAdmin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const rl = await enforceRateLimit(supabaseAdmin, { userId: user.id, feature: "parse_teacher_roster", limit: 20 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

    // Accept a spreadsheet grid (`rows`) OR pasted free text (`text`).
    const body = await req.json();
    const rows = body?.rows;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    let payload = "";
    if (Array.isArray(rows) && rows.length > 0) {
      payload = rows
        .map((r: any[]) => (Array.isArray(r) ? r.map((c) => (c ?? "").toString().replace(/\s+/g, " ").trim()).join("\t") : ""))
        .join("\n");
    } else if (text) {
      payload = text.slice(0, 12000);
    } else {
      return new Response(JSON.stringify({ error: "Provide roster rows or pasted text" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You normalize a school's classroom-teacher roster into structured data.

You'll receive either a spreadsheet's raw cells (tab-separated, one row per line) or pasted text. It may include a title, instructions, and a header row before the data, and a footer after. Find the real teacher rows and extract one entry each.

Mapping rules:
- name: the teacher's full name (required). Skip rows with no name.
- grade MUST be one of: "PreK","K","1","2","3","4","5","6","7","8", or a combo like "K-1". Parse "Kindergarten"->"K", "First"->"1", "1st Grade"->"1". If a row is a specials/PE/admin teacher (not a homeroom), set grade to "" and add a warning.
- room: classroom/room number if present, else "".
- preferences: any scheduling notes in free text (e.g. "no specials before 9", "team teaches with Ms. Lee", "AM planning"). "" if none.
- Omit decorative/empty rows.

Add a warning for anything ambiguous or unmapped.`;

    const EXTRACT_TOOL = {
      name: "extract_teachers",
      description: "Return one entry per real classroom teacher row.",
      input_schema: {
        type: "object",
        properties: {
          teachers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                grade: { type: "string" },
                room: { type: "string" },
                preferences: { type: "string" },
              },
              required: ["name"],
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
        required: ["teachers", "warnings"],
      },
    };

    let extracted: any = { teachers: [], warnings: [] };
    try {
      const resp = await anthropicClient().messages.create({
        model: MODELS.fast,
        max_tokens: 4000,
        system: systemPrompt,
        tools: [EXTRACT_TOOL as any],
        tool_choice: { type: "tool", name: "extract_teachers" },
        messages: [{ role: "user", content: `Teacher roster:\n\n${payload}` }],
      });
      extracted = firstToolUse(resp.content as any[], "extract_teachers")?.input ?? extracted;
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
    console.error("parse-teacher-roster error:", error);
    reportEdgeError(error, { function: "parse-teacher-roster" });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
