// Streaming AI chat editor for the master schedule.
// Tools mutate schedule_blocks directly, using the same constraint helpers
// the generator uses. Conversation persists per generation_id.
import { createClient } from "npm:@supabase/supabase-js@2";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "npm:ai";
import { z } from "npm:zod";
import { createLovableAiGatewayProvider } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "X-Lovable-AIG-Run-ID",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function minToTime(m: number): string {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}

interface BlockRow {
  id: string;
  generation_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  subject: string;
  specialist_id: string | null;
  teacher_id: string | null;
  grade: string | null;
  room: string | null;
  week_label: string | null;
}

function overlaps(a: BlockRow, day: string, startMin: number, endMin: number, weekLabel: string | null): boolean {
  if (a.day_of_week !== day) return false;
  if (weekLabel && a.week_label && weekLabel !== a.week_label) return false;
  const aStart = timeToMin(a.start_time);
  const aEnd = timeToMin(a.end_time);
  return aStart < endMin && startMin < aEnd;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: "Unauthorized" });

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return json(500, { error: "LOVABLE_API_KEY not configured" });

  let body: { generation_id?: string; messages?: UIMessage[] };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const generationId = body.generation_id;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!generationId) return json(400, { error: "generation_id required" });

  // Load context (RLS gates this — if user can't see it, we get nothing).
  const { data: gen, error: genErr } = await supabase
    .from("schedule_generations")
    .select("id, school_id, chosen_strategy, review_state")
    .eq("id", generationId)
    .maybeSingle();
  if (genErr || !gen) return json(404, { error: "Generation not found" });

  const [{ data: school }, { data: specialistsRaw }, { data: teachersRaw }, { data: blocksRaw }] = await Promise.all([
    supabase.from("schools").select("id, name, grades_served, start_time, end_time, class_duration").eq("id", gen.school_id).maybeSingle(),
    supabase.from("specialists").select("id, name, subject").eq("school_id", gen.school_id),
    supabase.from("classroom_teachers").select("id, name, grade, room").eq("school_id", gen.school_id),
    supabase.from("schedule_blocks").select("*").eq("generation_id", generationId),
  ]);

  const specialists = specialistsRaw ?? [];
  const teachers = teachersRaw ?? [];
  let blocks: BlockRow[] = (blocksRaw ?? []) as BlockRow[];

  const specMap = new Map(specialists.map((s: any) => [s.id, s]));
  const teachMap = new Map(teachers.map((t: any) => [t.id, t]));

  function describeBlock(b: BlockRow): string {
    const spec = b.specialist_id ? specMap.get(b.specialist_id)?.name ?? "?" : "—";
    const teach = b.teacher_id ? teachMap.get(b.teacher_id)?.name ?? "?" : "—";
    const week = b.week_label ? ` [Week ${b.week_label}]` : "";
    return `${b.id} | ${b.day_of_week} ${b.start_time.slice(0, 5)}-${b.end_time.slice(0, 5)} | ${b.subject} | Grade ${b.grade ?? "—"} | Specialist: ${spec} | Teacher: ${teach}${week}`;
  }

  const systemPrompt = `You are an AI scheduling assistant for ${school?.name ?? "this school"}, a K-6 school.
You can edit the existing master schedule by calling the provided tools. Always call tools to make changes — never just describe them in prose.

CURRENT SCHEDULE CONTEXT
- School day: ${school?.start_time ?? "?"} – ${school?.end_time ?? "?"}; default class duration ${school?.class_duration ?? 45} min.
- Grades served: ${(school?.grades_served ?? []).join(", ") || "?"}.
- Rotation strategy: ${gen.chosen_strategy ?? "standard"}.
- Specialists (${specialists.length}): ${specialists.map((s: any) => `${s.name} (${s.subject})`).join(", ")}.
- Teachers (${teachers.length}): ${teachers.map((t: any) => `${t.name} – Gr ${t.grade}`).join(", ")}.

BLOCKS (id | day time | subject | grade | specialist | teacher):
${blocks.slice(0, 200).map(describeBlock).join("\n")}
${blocks.length > 200 ? `\n…and ${blocks.length - 200} more blocks. Use list_blocks with a filter to see them.` : ""}

RULES
- Days are exactly: ${DAYS.join(", ")}. Use the 3-letter abbreviations.
- Times are 24-hour HH:MM. End must be after start.
- Never overlap a specialist with themselves at the same time (same week).
- Never overlap a teacher with themselves at the same time (same week).
- After each edit, briefly confirm what you changed. If a tool returns an error, explain and propose an alternative.
- For complex rewrites that touch many blocks, use bulk_replan.`;

  const initialRunId = req.headers.get("X-Lovable-AIG-Run-ID") ?? undefined;
  const gateway = createLovableAiGatewayProvider(apiKey, initialRunId);
  const model = gateway("google/gemini-3-flash-preview");

  // ─── Tools ───
  const listBlocks = tool({
    description: "List schedule blocks, optionally filtered by grade, specialist name, day, or subject. Returns up to 80 matches.",
    inputSchema: z.object({
      grade: z.string().optional(),
      specialist_name: z.string().optional(),
      day: z.string().optional(),
      subject: z.string().optional(),
    }),
    execute: async ({ grade, specialist_name, day, subject }) => {
      const specId = specialist_name
        ? specialists.find((s: any) => s.name.toLowerCase() === specialist_name.toLowerCase())?.id
        : undefined;
      const matches = blocks.filter((b) =>
        (!grade || b.grade === grade) &&
        (!specId || b.specialist_id === specId) &&
        (!day || b.day_of_week === day) &&
        (!subject || b.subject.toLowerCase().includes(subject.toLowerCase()))
      ).slice(0, 80);
      return { count: matches.length, blocks: matches.map(describeBlock) };
    },
  });

  const moveBlock = tool({
    description: "Move an existing block to a new day and start time (keeps the same duration). Time format: HH:MM (24h).",
    inputSchema: z.object({
      block_id: z.string().uuid(),
      day: z.enum(["Mon", "Tue", "Wed", "Thu", "Fri"]),
      start_time: z.string().regex(/^\d{2}:\d{2}$/),
    }),
    execute: async ({ block_id, day, start_time }) => {
      const blk = blocks.find((b) => b.id === block_id);
      if (!blk) return { ok: false, error: "Block not found" };
      const duration = timeToMin(blk.end_time) - timeToMin(blk.start_time);
      const newStart = timeToMin(start_time + ":00");
      const newEnd = newStart + duration;
      const conflicts = blocks.filter((other) =>
        other.id !== blk.id &&
        (other.specialist_id === blk.specialist_id || (blk.teacher_id && other.teacher_id === blk.teacher_id)) &&
        overlaps(other, day, newStart, newEnd, blk.week_label)
      );
      if (conflicts.length > 0) {
        return { ok: false, error: `Conflict with: ${conflicts.map(describeBlock).join("; ")}` };
      }
      const newStartStr = minToTime(newStart);
      const newEndStr = minToTime(newEnd);
      const { error } = await supabase.from("schedule_blocks").update({
        day_of_week: day, start_time: newStartStr, end_time: newEndStr,
        is_override: true,
      }).eq("id", block_id);
      if (error) return { ok: false, error: error.message };
      blk.day_of_week = day; blk.start_time = newStartStr; blk.end_time = newEndStr;
      return { ok: true, moved: describeBlock(blk) };
    },
  });

  const swapBlocks = tool({
    description: "Swap the day/time of two existing blocks.",
    inputSchema: z.object({
      block_a_id: z.string().uuid(),
      block_b_id: z.string().uuid(),
    }),
    execute: async ({ block_a_id, block_b_id }) => {
      const a = blocks.find((b) => b.id === block_a_id);
      const b = blocks.find((x) => x.id === block_b_id);
      if (!a || !b) return { ok: false, error: "One or both blocks not found" };
      const aSlot = { day: a.day_of_week, start: a.start_time, end: a.end_time };
      const bSlot = { day: b.day_of_week, start: b.start_time, end: b.end_time };
      const { error: e1 } = await supabase.from("schedule_blocks").update({
        day_of_week: bSlot.day, start_time: bSlot.start, end_time: bSlot.end, is_override: true,
      }).eq("id", a.id);
      if (e1) return { ok: false, error: e1.message };
      const { error: e2 } = await supabase.from("schedule_blocks").update({
        day_of_week: aSlot.day, start_time: aSlot.start, end_time: aSlot.end, is_override: true,
      }).eq("id", b.id);
      if (e2) {
        await supabase.from("schedule_blocks").update(aSlot).eq("id", a.id);
        return { ok: false, error: e2.message };
      }
      a.day_of_week = bSlot.day; a.start_time = bSlot.start; a.end_time = bSlot.end;
      b.day_of_week = aSlot.day; b.start_time = aSlot.start; b.end_time = aSlot.end;
      return { ok: true, swapped: [describeBlock(a), describeBlock(b)] };
    },
  });

  const deleteBlock = tool({
    description: "Delete a block from the schedule.",
    inputSchema: z.object({ block_id: z.string().uuid() }),
    execute: async ({ block_id }) => {
      const blk = blocks.find((b) => b.id === block_id);
      if (!blk) return { ok: false, error: "Block not found" };
      const { error } = await supabase.from("schedule_blocks").delete().eq("id", block_id);
      if (error) return { ok: false, error: error.message };
      blocks = blocks.filter((b) => b.id !== block_id);
      return { ok: true, deleted: describeBlock(blk) };
    },
  });

  const insertBlock = tool({
    description: "Add a new block to the schedule.",
    inputSchema: z.object({
      day: z.enum(["Mon", "Tue", "Wed", "Thu", "Fri"]),
      start_time: z.string().regex(/^\d{2}:\d{2}$/),
      end_time: z.string().regex(/^\d{2}:\d{2}$/),
      subject: z.string(),
      specialist_name: z.string().optional(),
      teacher_name: z.string().optional(),
      grade: z.string().optional(),
    }),
    execute: async ({ day, start_time, end_time, subject, specialist_name, teacher_name, grade }) => {
      const specId = specialist_name ? specialists.find((s: any) => s.name.toLowerCase() === specialist_name.toLowerCase())?.id : null;
      const teachId = teacher_name ? teachers.find((t: any) => t.name.toLowerCase() === teacher_name.toLowerCase())?.id : null;
      const startMin = timeToMin(start_time + ":00");
      const endMin = timeToMin(end_time + ":00");
      if (endMin <= startMin) return { ok: false, error: "end_time must be after start_time" };
      const conflicts = blocks.filter((other) =>
        ((specId && other.specialist_id === specId) || (teachId && other.teacher_id === teachId)) &&
        overlaps(other, day, startMin, endMin, null)
      );
      if (conflicts.length > 0) return { ok: false, error: `Conflict: ${conflicts.map(describeBlock).join("; ")}` };
      const { data: inserted, error } = await supabase.from("schedule_blocks").insert({
        generation_id: generationId,
        day_of_week: day,
        start_time: minToTime(startMin),
        end_time: minToTime(endMin),
        subject,
        specialist_id: specId ?? null,
        teacher_id: teachId ?? null,
        grade: grade ?? null,
        room: teachId ? teachMap.get(teachId)?.room ?? null : null,
        is_override: true,
      }).select("*").single();
      if (error || !inserted) return { ok: false, error: error?.message ?? "Insert failed" };
      blocks.push(inserted as BlockRow);
      return { ok: true, inserted: describeBlock(inserted as BlockRow) };
    },
  });

  const bulkReplan = tool({
    description: "Run a partial regeneration over a scope (a specialist, grade, or day). Use this for compound rewrites that would otherwise require many moves.",
    inputSchema: z.object({
      specialist_name: z.string().optional(),
      grade: z.string().optional(),
      day: z.string().optional(),
    }),
    execute: async ({ specialist_name, grade, day }) => {
      const specId = specialist_name ? specialists.find((s: any) => s.name.toLowerCase() === specialist_name.toLowerCase())?.id : undefined;
      const resp = await fetch(`${supabaseUrl}/functions/v1/replan-subgraph`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify({
          generation_id: generationId,
          scope: { specialist_ids: specId ? [specId] : undefined, grade, day },
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return { ok: false, error: data?.error ?? `HTTP ${resp.status}` };
      // Reload blocks since replan creates a new generation.
      const { data: fresh } = await supabase.from("schedule_blocks").select("*").eq("generation_id", data.new_generation_id ?? generationId);
      blocks = (fresh ?? []) as BlockRow[];
      return { ok: true, replanned: data.replanned ?? 0, new_generation_id: data.new_generation_id ?? null };
    },
  });

  try {
    const result = streamText({
      model,
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools: { listBlocks, moveBlock, swapBlocks, deleteBlock, insertBlock, bulkReplan },
      stopWhen: stepCountIs(50),
    });

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      headers: corsHeaders,
      onFinish: async ({ messages: finalMessages }) => {
        try {
          await supabase
            .from("schedule_generations")
            .update({ chat_history: finalMessages as unknown as object[] })
            .eq("id", generationId);
        } catch (err) {
          console.error("[schedule-chat] failed to persist chat_history", err);
        }
      },
    });
  } catch (err: any) {
    console.error("[schedule-chat] stream error", err);
    return json(500, { error: err?.message ?? "Stream failed" });
  }
});
