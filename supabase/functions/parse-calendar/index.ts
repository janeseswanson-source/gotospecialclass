import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { anthropicApiKey, anthropicClient, MODELS, firstToolUse, describeAnthropicError } from "../_shared/anthropic.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Find the best PDF link on an HTML page (district calendar landing pages
 *  usually link to the real calendar PDF), fetch it, and return the document
 *  content blocks — or null when there's no good candidate / the fetch fails,
 *  in which case the caller falls back to the page text. One fetch max. */
async function tryFollowPdfLink(
  html: string,
  pageUrl: string,
  toBase64: (buf: ArrayBuffer) => string,
): Promise<any[] | null> {
  try {
    const candidates: Array<{ href: string; score: number }> = [];
    // href + anchor text; matches ".pdf" paths including querystrings.
    const linkRe = /<a\b[^>]*href\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
    const scoreOf = (s: string) => {
      let score = 0;
      if (/calendar/i.test(s)) score += 4;
      if (/school\s*year|academic/i.test(s)) score += 2;
      if (/20\d\d/.test(s)) score += 2;
      if (/amended|official|revised/i.test(s)) score += 1;
      return score;
    };
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null && candidates.length < 40) {
      const href = m[1];
      const anchorText = m[2].replace(/<[^>]+>/g, " ");
      candidates.push({ href, score: scoreOf(href) + scoreOf(anchorText) });
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (best.score <= 0 && candidates.length > 3) return null; // a pile of unrelated PDFs — don't guess
    const resolved = new URL(best.href, pageUrl).toString();
    console.info("parse-calendar: following PDF link", { resolved, score: best.score });
    const resp = await fetch(resolved);
    if (!resp.ok) return null;
    const ct = (resp.headers.get("content-type") ?? "").toLowerCase();
    if (!ct.includes("pdf") && !new URL(resolved).pathname.toLowerCase().endsWith(".pdf")) return null;
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > 20 * 1024 * 1024) return null; // same 20MB cap as uploads
    return [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(buf) } },
      { type: "text", text: "Extract all calendar events from this school calendar PDF." },
    ];
  } catch (err) {
    console.warn("parse-calendar: PDF link follow failed", err);
    return null;
  }
}

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

    // Chunked base64 (btoa on a per-byte string concat is O(n²) and blows the
    // stack on big files; String.fromCharCode over 0x8000-byte slices is safe).
    const toBase64 = (buf: ArrayBuffer): string => {
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return btoa(binary);
    };

    if (calendar_url) {
      // Fetch calendar from URL. Districts commonly link straight to a PDF —
      // reading that with .text() feeds Claude binary garbage and yields
      // "<UNKNOWN>" events, so branch on content-type / extension and send real
      // PDFs as a document block instead.
      try {
        const urlResponse = await fetch(calendar_url);
        if (!urlResponse.ok) throw new Error(`Failed to fetch URL: ${urlResponse.status}`);
        const contentType = (urlResponse.headers.get("content-type") ?? "").toLowerCase();
        const looksPdf = contentType.includes("pdf") || new URL(calendar_url).pathname.toLowerCase().endsWith(".pdf");

        if (looksPdf) {
          const base64 = toBase64(await urlResponse.arrayBuffer());
          contentForAI = [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
            { type: "text", text: "Extract all calendar events from this school calendar PDF." },
          ];
        } else {
          const textContent = await urlResponse.text();
          // District calendar pages are usually LANDING pages that link to the
          // real PDF. Follow the most calendar-looking PDF link automatically
          // (one candidate, verified) before falling back to raw page text.
          const pdfContent = await tryFollowPdfLink(textContent, calendar_url, toBase64);
          contentForAI = pdfContent ?? [
            {
              type: "text",
              text: `Extract all calendar events from this school calendar content:\n\n${textContent.substring(0, 50000)}`,
            },
          ];
        }
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

      const base64 = toBase64(await fileData.arrayBuffer());
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

    // Validate: a real event needs a meaningful title AND a parseable date.
    // Garbage extractions (binary input, unreadable scans) used to insert
    // "<UNKNOWN>" / Invalid Date rows and report success.
    const isValidDate = (d: unknown): d is string =>
      typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
    extractedEvents = extractedEvents.filter((evt) => {
      const title = (evt.title ?? "").trim();
      if (!title || /^<?unknown>?$/i.test(title)) return false;
      if (!isValidDate(evt.event_date)) return false;
      if (evt.end_date && !isValidDate(evt.end_date)) evt.end_date = undefined;
      return true;
    });
    if (extractedEvents.length === 0) {
      return new Response(JSON.stringify({
        error: "Couldn't read any events from this calendar. If you pasted a link, try uploading the PDF directly; scanned/image-only calendars may not parse — you can add events manually.",
        code: "no_valid_events",
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
