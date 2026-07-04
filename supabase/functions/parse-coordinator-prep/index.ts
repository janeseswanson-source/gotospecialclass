import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { anthropicApiKey, extractFromFile, describeAnthropicError, MODELS } from "../_shared/anthropic.ts";

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
    if (!anthropicApiKey()) {
      return new Response(JSON.stringify({ error: "Claude isn't set up yet — add the ANTHROPIC_API_KEY secret." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const EXTRACT_TOOL = {
      name: "extract_coordinator_prep",
      description: "Extract structured coordinator prep data from the filled intake sheet.",
      input_schema: {
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
            },
          },
        },
        required: ["warnings"],
      },
    };

    let extracted: Record<string, any> = {};
    try {
      extracted = await extractFromFile({
        fileBase64: file_base64,
        mimeType: mime_type,
        system: systemPrompt,
        userText: `Extract the coordinator prep data from this filled sheet${school_name ? ` for ${school_name}` : ""}.`,
        tool: EXTRACT_TOOL,
        model: MODELS.fast,
      });
    } catch (err) {
      const { status, message } = describeAnthropicError(err);
      return new Response(JSON.stringify({ error: message }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await supabaseAdmin.from("ai_usage_log").insert({
      workspace_id: null,
      feature: "coordinator_prep_upload",
      tokens_used: 0,
      cost_estimate: 0,
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
