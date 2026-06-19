import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { file_base64, mime_type, school_name } = await req.json();
    if (!file_base64 || !mime_type || !ALLOWED_MIME.has(mime_type)) {
      return new Response(JSON.stringify({ error: "Invalid file. Upload a PDF or image (PNG/JPG/WEBP)." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Rough size cap ~15MB encoded
    if (file_base64.length > 20_000_000) {
      return new Response(JSON.stringify({ error: "File too large (max ~15MB)." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dataUri = `data:${mime_type};base64,${file_base64}`;
    const isPdf = mime_type === "application/pdf";

    const systemPrompt = `You are reading a filled-in "Coordinator Prep" intake sheet for an elementary school scheduling tool. Extract every answer the coordinator wrote. Be tolerant of handwriting and free-form responses.

Mapping rules:
- "School site URL" -> school_site_url. "District calendar URL" -> district_calendar_url.
- "Weekly early-release day" -> early_release_day (Mon/Tue/Wed/Thu/Fri or empty). "Early-release end time" -> early_release_end_time (HH:MM 24h).
- "Teacher union link" -> teacher_union_url. "Teacher contract link" -> teacher_contract_url.
- "Specialist scheduling style" -> grade_preference: "keep_together" | "waterfall" | "fixed_sequence" | "".
- Day-of-week preference checks -> day_preference (array of Mon/Tue/Wed/Thu/Fri). AM/PM preference -> am_pm_preference.
- "How many specialist teachers?" -> specialist_count (number or null).
- "Specialists using a teaching cart" -> cart_users (free text). "Specialists at two schools" -> two_school_users. "Part-time specialists (with days)" -> part_time_users. "Specialists with custom grade preferences" -> custom_grade_prefs.
- "Are most holidays on Mondays?" -> mostly_monday_holidays (bool|null). "Other notes about holidays / waiver / PD days" -> holiday_notes.
- "Special additional rotation (PLUS)?" -> has_special_rotation (bool|null).
- PLUS handling -> plus_mode: "admin" if coordinator specified day(s); "ai_auto_fit" if they said let AI choose / no extra day; "" if blank.
- "PLUS day(s) selected" -> plus_days (array). "PLUS rationale" -> plus_rationale. "PLUS time block & grades" / notes -> special_rotation_notes.
- Leave any field blank/null when illegible. Add a warning entry for ambiguous answers.`;

    const userContent: any[] = [
      { type: "text", text: `Extract the coordinator prep data from this filled sheet${school_name ? ` for ${school_name}` : ""}.` },
    ];
    if (isPdf) {
      userContent.push({ type: "file", file: { filename: "coordinator_prep.pdf", file_data: dataUri } });
    } else {
      userContent.push({ type: "image_url", image_url: { url: dataUri } });
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_coordinator_prep",
            description: "Extract structured coordinator prep data",
            parameters: {
              type: "object",
              properties: {
                school_site_url: { type: "string" },
                district_calendar_url: { type: "string" },
                early_release_day: { type: "string" },
                early_release_end_time: { type: "string" },
                teacher_union_url: { type: "string" },
                teacher_contract_url: { type: "string" },
                grade_preference: { type: "string", enum: ["keep_together", "waterfall", "fixed_sequence", ""] },
                day_preference: { type: "array", items: { type: "string" } },
                am_pm_preference: { type: "string" },
                specialist_count: { type: ["number", "null"] },
                cart_users: { type: "string" },
                two_school_users: { type: "string" },
                part_time_users: { type: "string" },
                custom_grade_prefs: { type: "string" },
                mostly_monday_holidays: { type: ["boolean", "null"] },
                holiday_notes: { type: "string" },
                has_special_rotation: { type: ["boolean", "null"] },
                plus_mode: { type: "string", enum: ["", "admin", "ai_auto_fit"] },
                plus_days: { type: "array", items: { type: "string" } },
                plus_rationale: { type: "string" },
                special_rotation_notes: { type: "string" },
                warnings: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      field: { type: "string" },
                      message: { type: "string" },
                      severity: { type: "string", enum: ["error", "warning", "info"] },
                    },
                    required: ["field", "message", "severity"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["warnings"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "extract_coordinator_prep" } },
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
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to your workspace." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI processing failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await aiResponse.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    let extracted: any = {};
    if (toolCall?.function?.arguments) {
      try { extracted = JSON.parse(toolCall.function.arguments); }
      catch (e) {
        console.error("Parse error", e);
        return new Response(JSON.stringify({ error: "Failed to parse AI response" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const tokensUsed = aiResult.usage?.total_tokens || 0;
    const supabaseAdmin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await supabaseAdmin.from("ai_usage_log").insert({
      workspace_id: null,
      feature: "coordinator_prep_upload",
      tokens_used: tokensUsed,
      cost_estimate: tokensUsed * 0.000001,
    });

    return new Response(JSON.stringify(extracted), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("parse-coordinator-prep error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
