import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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
    if (!rows || !Array.isArray(rows) || rows.length < 2) {
      return new Response(JSON.stringify({ error: "No valid Q&A rows provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build Q&A text for AI
    const qaText = rows
      .filter((r: string[]) => r[0]?.trim())
      .map((r: string[]) => `Q: ${r[0]?.trim() || ''}\nA: ${r[1]?.trim() || '[NOT ANSWERED]'}`)
      .join("\n\n");

    const systemPrompt = `You are a school onboarding data extractor. You receive a "Coordinator Prep — Intake Sheet" with questions and answers from a school coordinator. Extract ALL available information into structured data using the provided tool. Be thorough and tolerant of free-form answers:

- "School site URL" → school_info.website. "District calendar URL" → school_info.calendar_url.
- "Weekly early-release day" → school_info.early_release_day (e.g. "Wednesday"). "Early-release end time" → school_info.early_release_end_time (HH:MM 24h).
- "Day preference for specialists" → school_info.default_day_preference. "AM / PM preference" → school_info.default_am_pm_preference.
- "Specialist scheduling preference" → grade_preference ("keep_together" if grades stay together, "waterfall" if grades cascade).
- "How many specialist teachers?", "Specialists using a teaching cart", "Specialists at two schools", "Part-time specialists (with days)", "Specialists with custom grade preferences" → build the specialists array. Each named or counted specialist becomes an entry with subject, uses_cart, two_schools, is_part_time, working_days, grade_preference as appropriate.
- "Are most holidays on Mondays?" and "Other notes about holidays / waiver / PD days" → makeup_policy (concise summary).
- "Special additional rotation (PLUS)?" and "PLUS rotation details (days, time, grades)" → parse into admin_rotation entries (one per day) with day, grades, start_time, end_time, notes including "PLUS".
- For conflict strategies, map any mentioned approaches to these keys: ab_week, aa_bb_week, quick_30, big_group, makeup, lunch_clubs, event_planning, extra_rotation. Order by stated priority.
- Flag unanswered, ambiguous, or "see attached" answers as warnings.`;

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
          { role: "user", content: `Here is the completed onboarding questionnaire:\n\n${qaText}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_onboarding_data",
              description: "Extract structured onboarding data from the school questionnaire",
              parameters: {
                type: "object",
                properties: {
                  school_info: {
                    type: "object",
                    properties: {
                      website: { type: "string", description: "School website URL" },
                      calendar_url: { type: "string", description: "District calendar URL" },
                      early_release_day: { type: "string", description: "Day of week for early release, empty if none" },
                      early_release_end_time: { type: "string", description: "Early release end time in HH:MM format" },
                      default_day_preference: { type: "string", description: "Teacher day preference if specified" },
                      default_am_pm_preference: { type: "string", description: "Teacher AM/PM preference if specified" },
                    },
                    required: ["website"],
                    additionalProperties: false,
                  },
                  admin_rotation: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        day: { type: "string", description: "Day of week" },
                        grades: { type: "array", items: { type: "string" }, description: "Grade levels involved" },
                        start_time: { type: "string", description: "Start time if specified" },
                        end_time: { type: "string", description: "End time if specified" },
                        notes: { type: "string", description: "Additional context like PLC" },
                      },
                      required: ["day", "grades"],
                      additionalProperties: false,
                    },
                    description: "Special admin-requested rotation blocks (PLC, etc.)",
                  },
                  specialists: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "Specialist name if provided" },
                        subject: { type: "string", description: "Subject area" },
                        uses_cart: { type: "boolean" },
                        two_schools: { type: "boolean" },
                        is_part_time: { type: "boolean" },
                        working_days: { type: "array", items: { type: "string" } },
                        grade_preference: { type: "string", enum: ["keep_together", "waterfall", ""], description: "How this specialist prefers to schedule grades" },
                      },
                      required: ["subject"],
                      additionalProperties: false,
                    },
                  },
                  conflict_strategies: {
                    type: "array",
                    items: { type: "string", enum: ["ab_week", "aa_bb_week", "quick_30", "big_group", "makeup", "lunch_clubs", "event_planning", "extra_rotation"] },
                    description: "Ordered list of conflict resolution strategies by priority",
                  },
                  grade_preference: {
                    type: "string",
                    enum: ["keep_together", "waterfall", ""],
                    description: "Overall school preference for grade scheduling",
                  },
                  makeup_policy: {
                    type: "string",
                    description: "School policy for makeup sessions and Monday holidays",
                  },
                  warnings: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        field: { type: "string", description: "Which section the warning relates to" },
                        message: { type: "string", description: "Description of what's missing or ambiguous" },
                        severity: { type: "string", enum: ["error", "warning", "info"] },
                      },
                      required: ["field", "message", "severity"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["school_info", "specialists", "conflict_strategies", "warnings"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_onboarding_data" } },
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

    let extractedData: any = {};
    if (toolCall?.function?.arguments) {
      try {
        extractedData = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        console.error("Failed to parse AI response:", e);
        return new Response(JSON.stringify({ error: "Failed to parse AI extraction results" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Log AI usage
    const tokensUsed = aiResult.usage?.total_tokens || 0;
    const supabaseAdmin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await supabaseAdmin.from("ai_usage_log").insert({
      workspace_id: null,
      feature: "onboarding_template",
      tokens_used: tokensUsed,
      cost_estimate: tokensUsed * 0.000001,
    });

    return new Response(JSON.stringify(extractedData), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("process-onboarding-template error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
