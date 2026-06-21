// Streaming AI chat editor for the master schedule.
// Mutating tools PROPOSE edits (validated with the same constraint helpers the
// generator uses) but do NOT persist them — they return an `op` the client
// collects and commits via apply-schedule-edits after the user clicks Apply.
// Conversation persists per generation_id.
import { createClient } from "npm:@supabase/supabase-js@2";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "npm:ai";
import { z } from "npm:zod";
import { anthropicApiKey, CLAUDE_MODEL } from "../_shared/anthropic.ts";
import { anthropicModel } from "../_shared/anthropic-aisdk.ts";
import { buildConstraintContext, violations as constraintViolations, describeViolation } from "../_shared/constraints.ts";

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

  if (!anthropicApiKey()) return json(500, { error: "Claude isn't set up yet — add the ANTHROPIC_API_KEY secret to enable the AI editor." });

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

  const [{ data: school }, { data: specialistsRaw }, { data: teachersRaw }, { data: blocksRaw }, { data: recessRaw }] = await Promise.all([
    supabase.from("schools").select("id, name, grades_served, start_time, end_time, class_duration, early_release_day, early_release_end_time, recess_grade_bands").eq("id", gen.school_id).maybeSingle(),
    supabase.from("specialists").select("id, name, subject").eq("school_id", gen.school_id),
    supabase.from("classroom_teachers").select("id, name, grade, room").eq("school_id", gen.school_id),
    supabase.from("schedule_blocks").select("*").eq("generation_id", generationId),
    supabase.from("recess_lunch_config").select("*").eq("school_id", gen.school_id),
  ]);

  const specialists = specialistsRaw ?? [];
  const teachers = teachersRaw ?? [];
  let blocks: BlockRow[] = (blocksRaw ?? []) as BlockRow[];

  // Edit-time constraint context (school hours, recess/lunch, PLC/Admin
  // grade-range locks), mirroring the generator. PLC/Admin locks are derived
  // from the persisted blocks and are stable across these tool edits, so the
  // context is built once. Specialist/teacher overlap is checked separately by
  // each tool (for richer error messages), so we surface only the
  // block-intrinsic + grade-lock violations here (empty allBlocks).
  const constraintCtx = buildConstraintContext(school ?? {}, recessRaw ?? [], blocks as any);
  const ruleViolations = (day: string, startTime: string, endTime: string, grade: string | null, week: string | null): string[] =>
    constraintViolations(
      { day_of_week: day, start_time: startTime, end_time: endTime, grade, week_label: week },
      [],
      constraintCtx,
    ).map(describeViolation);

  const specMap = new Map(specialists.map((s: any) => [s.id, s]));
  const teachMap = new Map(teachers.map((t: any) => [t.id, t]));

  function describeBlock(b: BlockRow): string {
    const spec = b.specialist_id ? specMap.get(b.specialist_id)?.name ?? "?" : "—";
    const teach = b.teacher_id ? teachMap.get(b.teacher_id)?.name ?? "?" : "—";
    const week = b.week_label ? ` [Week ${b.week_label}]` : "";
    return `${b.id} | ${b.day_of_week} ${b.start_time.slice(0, 5)}-${b.end_time.slice(0, 5)} | ${b.subject} | Grade ${b.grade ?? "—"} | Specialist: ${spec} | Teacher: ${teach}${week}`;
  }

  const gradesLabel = (school?.grades_served ?? []).length ? `${(school?.grades_served ?? [])[0]}–${(school?.grades_served ?? []).slice(-1)[0]}` : "elementary";
  const systemPrompt = `You are an AI scheduling assistant for ${school?.name ?? "this school"}, a ${gradesLabel} elementary school.
You can edit the existing master schedule by calling the provided tools. Always call tools to make changes — never just describe them in prose.

IMPORTANT: move/swap/add/delete tools PROPOSE changes — they are NOT saved yet. After you propose them, the user sees an "Apply changes" bar and decides whether to commit them. So: never tell the user a change is "done" or "saved"; instead say what you've proposed (e.g. "I've proposed moving …") and that they can review and Apply it.

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
- Keep every block inside school hours (the early-release day ends earlier).
- Never place a class during that grade's recess or lunch, or during a PLC/Admin block for that grade. The tools enforce these and will reject violating edits — read the error and pick a valid slot.
- After each edit, briefly confirm what you PROPOSED. If a tool returns an error, explain and propose an alternative.
- For complex rewrites that touch many blocks, use bulk_replan. Note: bulk_replan applies immediately (it regenerates into a new schedule version) and is NOT part of the Apply bar — only use it when the user asks for a broad regeneration, not for a couple of edits.`;

  const model = anthropicModel(CLAUDE_MODEL);

  // ── Human-in-the-loop: tools PROPOSE changes, they don't persist. ──
  // Each mutating tool validates the edit (constraints + overlap) and updates
  // the in-memory `blocks` so the model reasons over a consistent view across
  // steps, then RETURNS the change as an `op` in its output instead of writing
  // to the DB. The client collects these ops from the streamed tool outputs and
  // shows an Apply/Discard bar; on Apply it POSTs them to `apply-schedule-edits`,
  // which re-validates and persists. Nothing the AI does touches the database
  // until the user confirms.
  // Every op carries a human-readable `label` so the client's Apply bar can
  // list exactly what will change in plain words.
  type EditOp =
    | { kind: "move"; label: string; block_id: string; day_of_week: string; start_time: string; end_time: string }
    | { kind: "swap"; label: string; a_id: string; a_day: string; a_start: string; a_end: string; b_id: string; b_day: string; b_start: string; b_end: string }
    | { kind: "delete"; label: string; block_id: string }
    | { kind: "insert"; label: string; day_of_week: string; start_time: string; end_time: string; subject: string; specialist_id: string | null; teacher_id: string | null; grade: string | null; room: string | null; week_label: string | null };

  const hm = (t: string) => t.slice(0, 5);
  const blockShort = (b: BlockRow) => {
    const teach = b.teacher_id ? teachMap.get(b.teacher_id)?.name : null;
    return `${b.subject}${b.grade ? ` · Gr ${b.grade}` : ""}${teach ? ` (${teach})` : ""}`;
  };

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
      const vio = ruleViolations(day, newStartStr, newEndStr, blk.grade, blk.week_label);
      if (vio.length) {
        return { ok: false, error: `Cannot move there — it ${vio.join(" and ")}. Pick a slot inside school hours that avoids this grade's recess/lunch and PLC time.` };
      }
      const label = `Move ${blockShort(blk)}: ${blk.day_of_week} ${hm(blk.start_time)} → ${day} ${hm(newStartStr)}`;
      blk.day_of_week = day; blk.start_time = newStartStr; blk.end_time = newEndStr;
      const op: EditOp = { kind: "move", label, block_id, day_of_week: day, start_time: newStartStr, end_time: newEndStr };
      return { ok: true, status: "proposed", op, moved: describeBlock(blk) };
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
      // Each block lands in the other's slot — validate both against recess/
      // lunch/PLC/hours for their own grade before committing the swap.
      const aVio = ruleViolations(bSlot.day, bSlot.start, bSlot.end, a.grade, a.week_label);
      const bVio = ruleViolations(aSlot.day, aSlot.start, aSlot.end, b.grade, b.week_label);
      if (aVio.length || bVio.length) {
        const parts: string[] = [];
        if (aVio.length) parts.push(`moving ${describeBlock(a)} ${aVio.join(" and ")}`);
        if (bVio.length) parts.push(`moving ${describeBlock(b)} ${bVio.join(" and ")}`);
        return { ok: false, error: `Swap rejected: ${parts.join("; ")}.` };
      }
      // Specialist/teacher double-booking at the destination slots (against
      // everyone EXCEPT the two blocks being swapped). Without this a swap
      // could be proposed cleanly and then fail at Apply — confusing.
      const others = blocks.filter((x) => x.id !== a.id && x.id !== b.id);
      const swapConflicts = others.filter((o) =>
        ((o.specialist_id && o.specialist_id === a.specialist_id) || (a.teacher_id && o.teacher_id === a.teacher_id))
          ? overlaps(o, bSlot.day, timeToMin(bSlot.start), timeToMin(bSlot.end), a.week_label)
          : false,
      ).concat(others.filter((o) =>
        ((o.specialist_id && o.specialist_id === b.specialist_id) || (b.teacher_id && o.teacher_id === b.teacher_id))
          ? overlaps(o, aSlot.day, timeToMin(aSlot.start), timeToMin(aSlot.end), b.week_label)
          : false,
      ));
      if (swapConflicts.length > 0) {
        return { ok: false, error: `Swap rejected — it would overlap: ${swapConflicts.slice(0, 3).map(describeBlock).join("; ")}` };
      }
      const label = `Swap ${blockShort(a)} (${a.day_of_week} ${hm(a.start_time)}) ↔ ${blockShort(b)} (${b.day_of_week} ${hm(b.start_time)})`;
      a.day_of_week = bSlot.day; a.start_time = bSlot.start; a.end_time = bSlot.end;
      b.day_of_week = aSlot.day; b.start_time = aSlot.start; b.end_time = aSlot.end;
      const op: EditOp = {
        kind: "swap", label,
        a_id: a.id, a_day: bSlot.day, a_start: bSlot.start, a_end: bSlot.end,
        b_id: b.id, b_day: aSlot.day, b_start: aSlot.start, b_end: aSlot.end,
      };
      return { ok: true, status: "proposed", op, swapped: [describeBlock(a), describeBlock(b)] };
    },
  });

  const deleteBlock = tool({
    description: "Delete a block from the schedule.",
    inputSchema: z.object({ block_id: z.string().uuid() }),
    execute: async ({ block_id }) => {
      const blk = blocks.find((b) => b.id === block_id);
      if (!blk) return { ok: false, error: "Block not found" };
      const summary = describeBlock(blk);
      const label = `Remove ${blockShort(blk)}: ${blk.day_of_week} ${hm(blk.start_time)}`;
      blocks = blocks.filter((b) => b.id !== block_id);
      const op: EditOp = { kind: "delete", label, block_id };
      return { ok: true, status: "proposed", op, deleted: summary };
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
      const insGrade = grade ?? (teachId ? teachMap.get(teachId)?.grade ?? null : null);
      const insVio = ruleViolations(day, minToTime(startMin), minToTime(endMin), insGrade, null);
      if (insVio.length) {
        return { ok: false, error: `Cannot add there — it ${insVio.join(" and ")}. Choose a time inside school hours that avoids this grade's recess/lunch and PLC time.` };
      }
      const room = teachId ? teachMap.get(teachId)?.room ?? null : null;
      // No DB write yet — give the in-memory block a temporary id so the model
      // can still reference it within this turn. The real id is assigned on apply.
      const proposed: BlockRow = {
        id: `tmp_${crypto.randomUUID()}`,
        generation_id: generationId!,
        day_of_week: day,
        start_time: minToTime(startMin),
        end_time: minToTime(endMin),
        subject,
        specialist_id: specId ?? null,
        teacher_id: teachId ?? null,
        grade: grade ?? null,
        room,
        week_label: null,
      };
      blocks.push(proposed);
      const op: EditOp = {
        kind: "insert",
        label: `Add ${blockShort(proposed)}: ${day} ${hm(proposed.start_time)}–${hm(proposed.end_time)}`,
        day_of_week: day,
        start_time: proposed.start_time,
        end_time: proposed.end_time,
        subject,
        specialist_id: specId ?? null,
        teacher_id: teachId ?? null,
        grade: grade ?? null,
        room,
        week_label: null,
      };
      return { ok: true, status: "proposed", op, inserted: describeBlock(proposed) };
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
