import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";
import { anthropicApiKey, anthropicClient, MODELS, firstToolUse, describeAnthropicError } from "../_shared/anthropic.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are an expert at reading K-12 school district contracts, collective bargaining agreements, and state mandates. From the provided document (or excerpt), extract the contractual requirements that affect specials/PE/music/art scheduling. Return them via the extract_contractual_minutes tool.

Look for:
- Required weekly instructional minutes per subject and grade level (e.g. PE 90 min/wk Gr K, Music 60 min/wk Gr 3-5).
- Contractual planning / preparation minutes for classroom teachers and specialists.
- Duty-free lunch requirements.
- Any other relevant minute mandates.

If the excerpt contains no such requirements, return empty arrays. Never invent values.`;

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
      source_summary: { type: "string", description: "One-sentence summary of where these numbers came from in this excerpt" },
    },
    required: ["subjects", "teachers"],
  },
};

// Signals that a page might mention scheduling-relevant contractual minutes.
const RELEVANT_RE = /planning|prep(?:aration)?\b|duty[- ]?free|instructional minutes|minutes? per week|specials?|physical education|\bPE\b|\bmusic\b|\bart\b|\blibrary\b|recess/i;

// ~40k chars per chunk keeps us well under Haiku's context even with system prompt + tool schema.
const CHUNK_CHAR_BUDGET = 40_000;
const MAX_CONCURRENCY = 4;

type Subject = { grade: string; subject: string; weekly_minutes: number };
type Teacher = { role: string; planning_minutes: number; duty_free_minutes?: number; notes?: string };
type Extracted = { subjects: Subject[]; teachers: Teacher[]; source_summary?: string };

async function extractPagesFromPdf(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(bytes);
  // mergePages: false → returns { text: string[] } with one entry per page.
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).map((t) => (t ?? "").trim());
}

function selectRelevantPages(pages: string[]): { text: string; pageNo: number }[] {
  const matched = pages
    .map((t, i) => ({ text: t, pageNo: i + 1 }))
    .filter((p) => p.text && RELEVANT_RE.test(p.text));
  if (matched.length > 0) return matched;
  // No signal — send everything with text (skip blank pages).
  return pages
    .map((t, i) => ({ text: t, pageNo: i + 1 }))
    .filter((p) => p.text.length > 0);
}

function chunkPages(pages: { text: string; pageNo: number }[]): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const p of pages) {
    const block = `\n--- Page ${p.pageNo} ---\n${p.text}\n`;
    if (current.length + block.length > CHUNK_CHAR_BUDGET && current.length > 0) {
      chunks.push(current);
      current = "";
    }
    // If a single page is larger than the budget, hard-split it.
    if (block.length > CHUNK_CHAR_BUDGET) {
      const header = `\n--- Page ${p.pageNo} (split) ---\n`;
      for (let i = 0; i < p.text.length; i += CHUNK_CHAR_BUDGET - header.length) {
        chunks.push(header + p.text.slice(i, i + CHUNK_CHAR_BUDGET - header.length));
      }
      continue;
    }
    current += block;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function extractFromChunk(chunk: string): Promise<Extracted | null> {
  const resp = await anthropicClient().messages.create({
    model: MODELS.fast,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    tools: [EXTRACT_TOOL as any],
    tool_choice: { type: "tool", name: "extract_contractual_minutes" },
    messages: [{ role: "user", content: [{ type: "text", text: `Extract contractual minute requirements from this contract excerpt:\n${chunk}` }] }],
  });
  const input = firstToolUse(resp.content as any[], "extract_contractual_minutes")?.input as Extracted | undefined;
  return input ?? null;
}

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function mergeExtracted(parts: Extracted[]): Extracted {
  const subjectMap = new Map<string, Subject>();
  const teacherMap = new Map<string, Teacher>();
  const summaries: string[] = [];
  for (const p of parts) {
    for (const s of p.subjects ?? []) {
      if (!s || !s.grade || !s.subject || typeof s.weekly_minutes !== "number") continue;
      const key = `${String(s.grade).trim().toLowerCase()}::${String(s.subject).trim().toLowerCase()}`;
      const prev = subjectMap.get(key);
      if (!prev || s.weekly_minutes > prev.weekly_minutes) subjectMap.set(key, { ...s });
    }
    for (const t of p.teachers ?? []) {
      if (!t || !t.role || typeof t.planning_minutes !== "number") continue;
      const key = String(t.role).trim().toLowerCase();
      const prev = teacherMap.get(key);
      if (!prev) {
        teacherMap.set(key, { ...t });
      } else {
        prev.planning_minutes = Math.max(prev.planning_minutes, t.planning_minutes);
        if (typeof t.duty_free_minutes === "number") {
          prev.duty_free_minutes = Math.max(prev.duty_free_minutes ?? 0, t.duty_free_minutes);
        }
        if (t.notes && !(prev.notes ?? "").includes(t.notes)) {
          prev.notes = prev.notes ? `${prev.notes}; ${t.notes}` : t.notes;
        }
      }
    }
    if (p.source_summary) summaries.push(p.source_summary);
  }
  return {
    subjects: Array.from(subjectMap.values()),
    teachers: Array.from(teacherMap.values()),
    source_summary: summaries.length > 0 ? Array.from(new Set(summaries)).join("; ") : undefined,
  };
}

async function loadPdfBytes(school: { contractual_minutes_file_path: string | null; contractual_minutes_url: string | null }, supabase: any): Promise<{ bytes: Uint8Array | null; textFallback?: string; error?: { status: number; message: string } }> {
  if (school.contractual_minutes_file_path) {
    const { data: fileData, error: dlErr } = await supabase.storage
      .from("contractual-docs")
      .download(school.contractual_minutes_file_path);
    if (dlErr || !fileData) return { bytes: null, error: { status: 500, message: "Could not download contract" } };
    return { bytes: new Uint8Array(await fileData.arrayBuffer()) };
  }
  if (school.contractual_minutes_url) {
    const res = await fetch(school.contractual_minutes_url);
    if (!res.ok) return { bytes: null, error: { status: 400, message: `Could not fetch URL: ${res.status}` } };
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("pdf")) return { bytes: new Uint8Array(await res.arrayBuffer()) };
    const text = await res.text();
    const stripped = text.replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ").trim();
    return { bytes: null, textFallback: stripped };
  }
  return { bytes: null, error: { status: 400, message: "No contract uploaded" } };
}

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

    // Load source: PDF bytes or (URL-only) already-stripped HTML text.
    const loaded = await loadPdfBytes(school, supabase);
    if (loaded.error) {
      return new Response(JSON.stringify({ error: loaded.error.message }), {
        status: loaded.error.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build the text chunks we'll parse.
    let chunks: string[];
    let totalPages = 0;
    let relevantPages = 0;
    if (loaded.bytes) {
      let pages: string[];
      try {
        pages = await extractPagesFromPdf(loaded.bytes);
      } catch (e) {
        return new Response(JSON.stringify({ error: "Couldn't read this PDF (it may be a scan or corrupted). Paste the relevant contract section as text instead, or upload a text-based PDF." }), {
          status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      totalPages = pages.length;
      const kept = selectRelevantPages(pages);
      relevantPages = kept.length;
      if (kept.length === 0) {
        return new Response(JSON.stringify({ error: "This PDF has no readable text (likely a scanned image). Paste the relevant contract section as text, or upload a text-based PDF." }), {
          status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      chunks = chunkPages(kept);
    } else {
      // URL text fallback: chunk the stripped text directly.
      const raw = loaded.textFallback ?? "";
      chunks = [];
      for (let i = 0; i < raw.length; i += CHUNK_CHAR_BUDGET) {
        chunks.push(raw.slice(i, i + CHUNK_CHAR_BUDGET));
      }
      if (chunks.length === 0) {
        return new Response(JSON.stringify({ error: "No content at that URL." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Parse chunks in parallel (bounded), collect the ones that succeeded.
    let extracted: Extracted;
    try {
      const parts = await runWithConcurrency(chunks, MAX_CONCURRENCY, (c) => extractFromChunk(c));
      const good = parts.filter((p): p is Extracted => !!p);
      if (good.length === 0) {
        return new Response(JSON.stringify({ error: "The AI couldn't find planning/duty-free minutes in this document. Try uploading just the section that covers planning time and instructional minutes, or enter the minutes manually." }), {
          status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      extracted = mergeExtracted(good);
    } catch (err) {
      const { status, message } = describeAnthropicError(err);
      return new Response(JSON.stringify({ error: message }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("schools").update({
      contractual_minutes_extracted: extracted as any,
      contractual_minutes_status: "parsed",
    }).eq("id", school_id);

    return new Response(JSON.stringify({
      extracted,
      diagnostics: { total_pages: totalPages, relevant_pages: relevantPages, chunks: chunks.length },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("parse-contractual-minutes error", err);
    return new Response(JSON.stringify({ error: (err as Error).message ?? "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
