import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

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

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Specialist sheet:\n\n${tsv}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_specialists",
              description: "Return one entry per real specialist teacher row.",
              parameters: {
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
                      additionalProperties: false,
                    },
                  },
                  warnings: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        row: { type: "number" },
                        message: { type: "string" },
                      },
                      required: ["message"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["specialists", "warnings"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_specialists" } },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errText);
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please contact support." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI processing failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await aiResponse.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    let extracted: any = { specialists: [], warnings: [] };
    if (toolCall?.function?.arguments) {
      try {
        extracted = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        console.error("Parse error:", e);
      }
    }

    const tokensUsed = aiResult.usage?.total_tokens || 0;
    const supabaseAdmin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await supabaseAdmin.from("ai_usage_log").insert({
      workspace_id: null,
      feature: "parse_specialist_template",
      tokens_used: tokensUsed,
      cost_estimate: tokensUsed * 0.000001,
    });

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
