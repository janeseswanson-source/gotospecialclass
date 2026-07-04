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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!anthropicApiKey()) {
      return new Response(JSON.stringify({ error: "Claude isn't set up yet — add the ANTHROPIC_API_KEY secret." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader ?? "" } },
    });
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const rl = await enforceRateLimit(supabase, { userId: user.id, feature: "parse_calendar", limit: 20 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

    const body = await req.json();
    const { file_path, calendar_url, school_id, upload_id } = body;

    if (!school_id || !upload_id) {
      return new Response(JSON.stringify({ error: "school_id and upload_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!file_path && !calendar_url) {
      return new Response(JSON.stringify({ error: "file_path or calendar_url is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let contentForAI: any[];

    if (calendar_url) {
      // Fetch calendar from URL
      try {
        const urlResponse = await fetch(calendar_url);
        if (!urlResponse.ok) throw new Error(`Failed to fetch URL: ${urlResponse.status}`);
        const textContent = await urlResponse.text();

        contentForAI = [
          {
            type: "text",
            text: `Extract all calendar events from this school calendar content:\n\n${textContent.substring(0, 50000)}`,
          },
        ];
      } catch (fetchErr) {
        console.error("URL fetch error:", fetchErr);
        return new Response(JSON.stringify({ error: "Failed to fetch calendar from URL" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      // Download PDF from storage
      const { data: fileData, error: downloadError } = await supabase.storage
        .from("calendar-uploads")
        .download(file_path);

      if (downloadError || !fileData) {
        console.error("Download error:", downloadError);
        return new Response(JSON.stringify({ error: "Failed to download calendar file" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const arrayBuffer = await fileData.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      contentForAI = [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: "Extract all calendar events from this school calendar PDF." },
      ];
    }

    const systemPrompt = `You are a school calendar parser. Extract ALL important dates from the school calendar provided. Return structured data using the extract_calendar_events tool. Include: holidays, teacher workdays, no-school days, early release days, closures, first/last day of school, and any other significant events. For multi-day events, include both start and end dates. Be thorough — extract every date mentioned.`;

    const EXTRACT_TOOL = {
      name: "extract_calendar_events",
      description: "Extract structured calendar events from the school calendar",
      input_schema: {
        type: "object",
        properties: {
          events: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Name of the event" },
                event_type: {
                  type: "string",
                  enum: ["holiday", "teacher_workday", "no_school", "early_release", "closure", "event", "first_day", "last_day"],
                  description: "Category of the event",
                },
                event_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
                end_date: { type: "string", description: "End date in YYYY-MM-DD format (same as event_date if single day)" },
              },
              required: ["title", "event_type", "event_date"],
            },
          },
        },
        required: ["events"],
      },
    };

    let extractedEvents: Array<{ title: string; event_type: string; event_date: string; end_date?: string }> = [];
    try {
      const resp = await anthropicClient().messages.create({
        model: MODELS.fast,
        max_tokens: 8000,
        system: systemPrompt,
        tools: [EXTRACT_TOOL as any],
        tool_choice: { type: "tool", name: "extract_calendar_events" },
        messages: [{ role: "user", content: contentForAI as any }],
      });
      const input = firstToolUse(resp.content as any[], "extract_calendar_events")?.input;
      extractedEvents = (input?.events as any[]) || [];
    } catch (err) {
      const { status, message } = describeAnthropicError(err);
      return new Response(JSON.stringify({ error: message }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log AI usage
    const { data: school } = await supabase.from("schools").select("workspace_id").eq("id", school_id).single();

    if (school?.workspace_id) {
      await supabase.from("ai_usage_log").insert({
        workspace_id: school.workspace_id,
        feature: "calendar_parsing",
        tokens_used: 0,
        cost_estimate: 0,
      });
    }

    // Insert parsed events into database server-side
    if (extractedEvents.length > 0) {
      const eventsToInsert = extractedEvents.map((evt) => ({
        upload_id,
        school_id,
        title: evt.title,
        event_type: evt.event_type,
        event_date: evt.event_date || null,
        end_date: evt.end_date || null,
        approved: false,
      }));

      const { error: insertError } = await supabase
        .from("parsed_calendar_events")
        .insert(eventsToInsert);

      if (insertError) {
        console.error("Failed to insert parsed events:", insertError);
      }
    }

    // Update calendar_uploads record
    await supabase
      .from("calendar_uploads")
      .update({ parsed: true, parsed_at: new Date().toISOString() })
      .eq("id", upload_id);

    return new Response(JSON.stringify({ events: extractedEvents }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("parse-calendar error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
