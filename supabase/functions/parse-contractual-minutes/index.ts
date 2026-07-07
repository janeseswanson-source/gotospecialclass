import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { anthropicApiKey, anthropicClient, MODELS, firstToolUse, describeAnthropicError } from "../_shared/anthropic.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are an expert at reading K-12 school district contracts, collective bargaining agreements, and state mandates. From the provided document, extract the contractual requirements that affect specials/PE/music/art scheduling. Return them via the extract_contractual_minutes tool.

Look for:
- Required weekly instructional minutes per subject and grade level (e.g. PE 90 min/wk Gr K, Music 60 min/wk Gr 3-5).
- Contractual planning / preparation minutes for classroom teachers and specialists.
- Duty-free lunch requirements.
- Any other relevant minute mandates.

If something is not explicit, omit it. Do not invent values.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (!anthropicApiKey()) {
      return new Response(JSON.stringify({ error: "Claude isn't set up yet — add the ANTHROPIC_API_KEY secret." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Manual JWT verification
    const authHeader = req.headers.get("Authorization");
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader ?? "" } },
    });
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const rl = await enforceRateLimit(supabase, { userId: user.id, feature: "parse_contractual_minutes", limit: 20 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

    const { school_id } = await req.json();
    if (!school_id) {
      return new Response(JSON.stringify({ error: "school_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: school, error: schErr } = await supabase
      .from("schools")
      .select("workspace_id, contractual_minutes_url, contractual_minutes_file_path")
      .eq("id", school_id)
      .single();
    if (schErr || !school) {
      return new Response(JSON.stringify({ error: "School not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Confirm the calling user is a member of this workspace.
    const { data: membership } = await supabaseUser
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", school.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let contentForAI: any[];
    if (school.contractual_minutes_file_path) {
      const { data: fileData, error: dlErr } = await supabase.storage
        .from("contractual-docs")
        .download(school.contractual_minutes_file_path);
      if (dlErr || !fileData) {
        return new Response(JSON.stringify({ error: "Could not download contract" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const buf = new Uint8Array(await fileData.arrayBuffer());
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        binary += String.fromCharCode(...buf.subarray(i, Math.min(i + CHUNK, buf.length)));
      }
      const base64 = btoa(binary);
      contentForAI = [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: "Extract contractual minute requirements from this contract." },
      ];
    } else if (school.contractual_minutes_url) {
      const res = await fetch(school.contractual_minutes_url);
      if (!res.ok) {
        return new Response(JSON.stringify({ error: `Could not fetch URL: ${res.status}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("pdf")) {
        const buf = new Uint8Array(await res.arrayBuffer());
        let binary = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < buf.length; i += CHUNK) {
          binary += String.fromCharCode(...buf.subarray(i, Math.min(i + CHUNK, buf.length)));
        }
        const base64 = btoa(binary);
        contentForAI = [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          { type: "text", text: "Extract contractual minute requirements from this contract PDF." },
        ];
      } else {
        const text = await res.text();
        // Strip HTML tags crudely
        const stripped = text.replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ").trim();
        contentForAI = [{ type: "text", text: `Extract contractual minute requirements from this contract:\n\n${stripped.substring(0, 60000)}` }];
      }
    } else {
      return new Response(JSON.stringify({ error: "No contract uploaded" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const EXTRACT_TOOL = {
      name: "extract_contractual_minutes",
      description: "Extract contractual minute requirements",
      input_schema: {
        type: "object",
        properties: {
          subjects: {
            type: "array",
            description: "Required weekly instructional minutes by subject and grade",
            items: {
              type: "object",
              properties: {
                grade: { type: "string", description: "Grade level e.g. K, 1, 2…6" },
                subject: { type: "string", description: "Subject e.g. PE, Music, Art, Library" },
                weekly_minutes: { type: "number", description: "Required minutes per week" },
              },
              required: ["grade", "subject", "weekly_minutes"],
            },
          },
          teachers: {
            type: "array",
            description: "Contractual minute requirements per teacher role",
            items: {
              type: "object",
              properties: {
                role: { type: "string", description: "Role e.g. Classroom Teacher, Specialist, K-2 Teacher" },
                planning_minutes: { type: "number", description: "Required planning minutes per week" },
                duty_free_minutes: { type: "number", description: "Required duty-free lunch minutes per week" },
                notes: { type: "string" },
              },
              required: ["role", "planning_minutes"],
            },
          },
          source_summary: { type: "string", description: "One-sentence summary of where these numbers came from" },
        },
        required: ["subjects", "teachers"],
      },
    };

    let extracted: unknown = null;
    try {
      const resp = await anthropicClient().messages.create({
        model: MODELS.fast,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        tools: [EXTRACT_TOOL as any],
        tool_choice: { type: "tool", name: "extract_contractual_minutes" },
        messages: [{ role: "user", content: contentForAI as any }],
      });
      extracted = firstToolUse(resp.content as any[], "extract_contractual_minutes")?.input ?? null;
    } catch (err) {
      const { status, message } = describeAnthropicError(err);
      // Union contracts routinely exceed the ~100-page / size limit for whole-PDF
      // parsing — translate the opaque API rejection into what to actually do.
      const tooBig = /page|too (large|long|big)|exceed|maximum|request_too_large|413/i.test(message);
      const friendly = tooBig
        ? "This contract is too large to parse whole (about a 100-page limit). Upload just the pages covering planning time / duty-free minutes, or paste that section as text — or skip this step and enter the minutes manually."
        : message;
      return new Response(JSON.stringify({ error: friendly, code: tooBig ? "document_too_large" : undefined }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!extracted) {
      return new Response(JSON.stringify({ error: "The AI couldn't find planning/duty-free minutes in this document. Upload just the relevant contract pages, or skip this step and enter minutes manually." }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("schools").update({
      contractual_minutes_extracted: extracted as any,
      contractual_minutes_status: "parsed",
    }).eq("id", school_id);

    return new Response(JSON.stringify({ extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("parse-contractual-minutes error", err);
    return new Response(JSON.stringify({ error: (err as Error).message ?? "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
