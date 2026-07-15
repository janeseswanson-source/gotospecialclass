// Streaming AI chat editor for the master schedule (edit-with-ai v2).
//
// The propose→confirm→apply gate is unchanged: mutating tools PROPOSE edits
// (validated with the SAME shared constraint validator the generator uses) but do
// NOT persist them — they return `op`s the client collects and commits via
// apply-schedule-edits after the user clicks Apply.
//
// v2 gives the model real engine power instead of blind guessing:
//   find_free_slots      — legal open slots via the constraint context
//   preview_ops          — SSOT violations + warnings delta + quality Δ for the
//                          currently-proposed op set (MUST be called before
//                          finishing any multi-op proposal)
//   fix_conflicts        — the deterministic cascade in PREVIEW mode (ranked
//                          legal options with measured blast radius)
//   rebalance_specialist / improve_quality — a short deterministic directed-
//                          repair/LNS pass scoped to the request, perturbation-
//                          anchored, returning the move set AS proposed ops
//   get_quality_report   — score_breakdown in human language + warnings
//
// Context diet: [static rules (cached)] [school context (cached)] [block table].
// Model: MODELS.chat (Sonnet) — the engine does the hard combinatorics.
import { createClient } from "npm:@supabase/supabase-js@2";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "npm:ai";
import { z } from "npm:zod";
import { anthropicApiKey, MODELS } from "../_shared/anthropic.ts";
import { anthropicModel } from "../_shared/anthropic-aisdk.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";
import { buildConstraintContext, violations as constraintViolations, describeViolation } from "../_shared/constraints.ts";
import {
  enumerateFreeSlots, previewOps, conflictFixOptions, improveQualityScoped, qualityReport,
  applyOpsToBlocks, type EditBlock, type EditOp, type EditToolContext,
} from "./_engine/_editTools.ts";
import type { Specialist } from "./_engine/index.ts";

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

type BlockRow = EditBlock;

// Static rules — identical for every school/turn, so this whole message is a
// prompt-cache hit from turn 2 onward (tools sit before it and are also stable).
const STATIC_RULES = `You are an AI scheduling assistant for an elementary school's "specials" master schedule.
You edit the schedule by calling tools. Always call tools to make changes — never just describe them in prose.

THE GATE: move/swap/add/delete and the engine passes (rebalance_specialist, improve_quality, fix_conflicts) PROPOSE changes — nothing is saved until the user clicks Apply. Never say a change is "done" or "saved"; say what you've PROPOSED and that they can review and Apply it.

HOW TO WORK (this is what makes you effective):
1. Before acting on a vague request ("fix the schedule", "what's wrong?"), call get_quality_report to see exactly what's wrong.
2. Never guess a time slot. Call find_free_slots to get legal open slots for the specialist/teacher/grade first, then move/insert into one of them.
3. For "even out workload", "balance", "spread out" requests: call rebalance_specialist (one specialist) or improve_quality (whole schedule, optionally focused on one penalty). These run the deterministic engine and return a ready-made set of proposed moves with the measured quality change — do NOT hand-roll many individual moves for these.
4. For double-bookings/conflicts: call fix_conflicts to get the engine's ranked legal options (smallest change first), then propose the best one's ops via its returned ops (they are already proposed once you pick them — see the tool result).
5. REQUIRED: before finishing ANY reply that proposed more than one change, call preview_ops and REPORT the quality delta in your reply (e.g. "+3 quality, 0 new warnings"). If preview shows violations or a quality drop, fix your proposal before finishing.
6. If a tool rejects an edit, read the violation text and pick a different slot — the rules (hours, recess/lunch, PLC, double-booking) are enforced for you.

RULES OF THE SCHEDULE:
- Days are exactly Mon, Tue, Wed, Thu, Fri. Times are 24-hour HH:MM; end after start.
- A specialist or a teacher can never be in two places at once (same week).
- Blocks stay inside school hours (early-release day ends earlier), never on that grade's recess/lunch, never on a PLC/Admin block for that grade.
- bulk_replan regenerates a whole scope immediately (NOT part of the Apply bar) — only for broad "redo X entirely" requests.`;

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

  // Per-user rate limit (30/hr) — the AI editor is the chattiest LLM surface.
  const rlAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const rl = await enforceRateLimit(rlAdmin, { userId: userData.user.id, feature: "schedule_chat", limit: 30 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

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
    supabase.from("schools").select("id, name, grades_served, start_time, end_time, class_duration, passing_time, setup_time, grade_time_config, keep_grades_together, rotation_wheel_grades, contractual_minutes_extracted, early_release_day, early_release_end_time, recess_grade_bands").eq("id", gen.school_id).maybeSingle(),
    supabase.from("specialists").select("*").eq("school_id", gen.school_id),
    supabase.from("classroom_teachers").select("id, name, grade, room, am_pm_preference, day_preference, weekly_planning_minutes").eq("school_id", gen.school_id),
    supabase.from("schedule_blocks").select("*").eq("generation_id", generationId),
    supabase.from("recess_lunch_config").select("*").eq("school_id", gen.school_id),
  ]);

  const specialists = (specialistsRaw ?? []) as unknown as Specialist[];
  const teachers = teachersRaw ?? [];
  let blocks: BlockRow[] = (blocksRaw ?? []) as BlockRow[];
  // Snapshot for preview_ops: the persisted state this turn started from.
  const originalBlocks: BlockRow[] = blocks.map((b) => ({ ...b }));
  // Ops proposed so far this turn (mutating tools + engine passes push here).
  const proposedOps: EditOp[] = [];

  const toolCtx: EditToolContext = {
    school: school ?? {},
    recessConfigs: recessRaw ?? [],
    specialists,
    teachers: teachers as any,
    grades: (school?.grades_served as string[]) ?? [],
  };

  // Edit-time constraint context, mirroring the generator; validation uses the
  // SHARED validator with the FULL live block list, so a tool's check is
  // identical to what apply-schedule-edits re-checks at Apply time.
  const constraintCtx = buildConstraintContext(school ?? {}, recessRaw ?? [], blocks as any);
  const toConstraint = (b: BlockRow) => ({
    id: b.id, day_of_week: b.day_of_week, start_time: b.start_time, end_time: b.end_time,
    grade: b.grade, week_label: b.week_label, specialist_id: b.specialist_id, teacher_id: b.teacher_id,
  });
  const ruleViolations = (
    cand: { id?: string; day: string; start: string; end: string; grade: string | null; week: string | null; specialist_id: string | null; teacher_id: string | null },
    allBlocks: BlockRow[],
  ): string[] =>
    constraintViolations(
      { id: cand.id, day_of_week: cand.day, start_time: cand.start, end_time: cand.end, grade: cand.grade, week_label: cand.week, specialist_id: cand.specialist_id, teacher_id: cand.teacher_id },
      allBlocks.map(toConstraint),
      constraintCtx,
    ).map(describeViolation);

  const specMap = new Map(specialists.map((s: any) => [s.id, s]));
  const teachMap = new Map(teachers.map((t: any) => [t.id, t]));
  const findSpecByName = (name?: string | null) =>
    name ? specialists.find((s: any) => s.name.toLowerCase() === name.toLowerCase()) ?? null : null;
  const findTeacherByName = (name?: string | null) =>
    name ? (teachers as any[]).find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? null : null;

  function describeBlock(b: BlockRow): string {
    const spec = b.specialist_id ? specMap.get(b.specialist_id)?.name ?? "?" : "—";
    const teach = b.teacher_id ? teachMap.get(b.teacher_id)?.name ?? "?" : "—";
    const week = b.week_label ? ` [Week ${b.week_label}]` : "";
    return `${b.id} | ${b.day_of_week} ${b.start_time.slice(0, 5)}-${b.end_time.slice(0, 5)} | ${b.subject} | Grade ${b.grade ?? "—"} | Specialist: ${spec} | Teacher: ${teach}${week}`;
  }

  // ── Prompt: [static rules (cached)] [school context (cached)] [block table] ──
  const gradesLabel = (school?.grades_served ?? []).length ? `${(school?.grades_served ?? [])[0]}–${(school?.grades_served ?? []).slice(-1)[0]}` : "elementary";
  const schoolContext = `SCHOOL: ${school?.name ?? "this school"} (${gradesLabel}).
- Day: ${school?.start_time ?? "?"} – ${school?.end_time ?? "?"}; default class ${school?.class_duration ?? 45} min; early release: ${school?.early_release_day ?? "none"}${school?.early_release_end_time ? ` (ends ${school.early_release_end_time})` : ""}.
- Grades: ${(school?.grades_served ?? []).join(", ") || "?"}. Rotation strategy: ${gen.chosen_strategy ?? "standard"}.
- Specialists (${specialists.length}): ${specialists.map((s: any) => `${s.name} (${s.subject}${s.uses_cart ? ", cart" : ""}; ${(s.working_days ?? DAYS).join("/")})`).join(", ")}.
- Teachers (${teachers.length}): ${teachers.map((t: any) => `${t.name}=Gr${t.grade}${t.am_pm_preference ? `·${t.am_pm_preference}` : ""}`).join(", ")}.`;

  const blockTable = `BLOCKS (id | day time | subject | grade | specialist | teacher):
${blocks.map(describeBlock).join("\n")}`;

  const model = anthropicModel(MODELS.chat);
  const cacheEphemeral = { anthropic: { cacheControl: { type: "ephemeral" as const } } };

  const hm = (t: string) => t.slice(0, 5);
  const blockShort = (b: BlockRow) => {
    const teach = b.teacher_id ? teachMap.get(b.teacher_id)?.name : null;
    return `${b.subject}${b.grade ? ` · Gr ${b.grade}` : ""}${teach ? ` (${teach})` : ""}`;
  };

  // ─── Original tools (propose→confirm→apply, unchanged semantics) ───
  const listBlocks = tool({
    description: "List schedule blocks, optionally filtered by grade, specialist name, day, or subject. Returns up to 80 matches.",
    inputSchema: z.object({
      grade: z.string().optional(),
      specialist_name: z.string().optional(),
      day: z.string().optional(),
      subject: z.string().optional(),
    }),
    execute: async ({ grade, specialist_name, day, subject }) => {
      const specId = findSpecByName(specialist_name)?.id;
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
    description: "Move an existing block to a new day and start time (keeps the same duration). Time format: HH:MM (24h). Use find_free_slots first if unsure where it can go.",
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
      const newStartStr = minToTime(newStart);
      const newEndStr = minToTime(newEnd);
      const vio = ruleViolations(
        { id: blk.id, day, start: newStartStr, end: newEndStr, grade: blk.grade, week: blk.week_label, specialist_id: blk.specialist_id, teacher_id: blk.teacher_id },
        blocks,
      );
      if (vio.length) {
        return { ok: false, error: `Cannot move there — it ${vio.join(" and ")}. Call find_free_slots to get slots that WILL work.` };
      }
      const label = `Move ${blockShort(blk)}: ${blk.day_of_week} ${hm(blk.start_time)} → ${day} ${hm(newStartStr)}`;
      blk.day_of_week = day; blk.start_time = newStartStr; blk.end_time = newEndStr;
      const op: EditOp = { kind: "move", label, block_id, day_of_week: day, start_time: newStartStr, end_time: newEndStr };
      proposedOps.push(op);
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
      if (a.id === b.id) return { ok: false, error: "Pick two different blocks to swap" };
      const aDur = timeToMin(a.end_time) - timeToMin(a.start_time);
      const bDur = timeToMin(b.end_time) - timeToMin(b.start_time);
      const aDay = b.day_of_week, aStart = timeToMin(b.start_time), aEnd = aStart + aDur;
      const bDay = a.day_of_week, bStart = timeToMin(a.start_time), bEnd = bStart + bDur;
      const aStartStr = minToTime(aStart), aEndStr = minToTime(aEnd);
      const bStartStr = minToTime(bStart), bEndStr = minToTime(bEnd);
      const after = blocks.map((x) =>
        x.id === a.id ? { ...x, day_of_week: aDay, start_time: aStartStr, end_time: aEndStr }
        : x.id === b.id ? { ...x, day_of_week: bDay, start_time: bStartStr, end_time: bEndStr }
        : x);
      const aVio = ruleViolations({ id: a.id, day: aDay, start: aStartStr, end: aEndStr, grade: a.grade, week: a.week_label, specialist_id: a.specialist_id, teacher_id: a.teacher_id }, after);
      const bVio = ruleViolations({ id: b.id, day: bDay, start: bStartStr, end: bEndStr, grade: b.grade, week: b.week_label, specialist_id: b.specialist_id, teacher_id: b.teacher_id }, after);
      if (aVio.length || bVio.length) {
        const parts: string[] = [];
        if (aVio.length) parts.push(`moving ${describeBlock(a)} ${aVio.join(" and ")}`);
        if (bVio.length) parts.push(`moving ${describeBlock(b)} ${bVio.join(" and ")}`);
        return { ok: false, error: `Swap rejected: ${parts.join("; ")}.` };
      }
      const label = `Swap ${blockShort(a)} (${a.day_of_week} ${hm(a.start_time)}) ↔ ${blockShort(b)} (${b.day_of_week} ${hm(b.start_time)})`;
      a.day_of_week = aDay; a.start_time = aStartStr; a.end_time = aEndStr;
      b.day_of_week = bDay; b.start_time = bStartStr; b.end_time = bEndStr;
      const op: EditOp = {
        kind: "swap", label,
        a_id: a.id, a_day: aDay, a_start: aStartStr, a_end: aEndStr,
        b_id: b.id, b_day: bDay, b_start: bStartStr, b_end: bEndStr,
      };
      proposedOps.push(op);
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
      proposedOps.push(op);
      return { ok: true, status: "proposed", op, deleted: summary };
    },
  });

  const insertBlock = tool({
    description: "Add a new block to the schedule. Use find_free_slots first to pick a legal slot.",
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
      const specId = findSpecByName(specialist_name)?.id ?? null;
      const teachId = findTeacherByName(teacher_name)?.id ?? null;
      const startMin = timeToMin(start_time + ":00");
      const endMin = timeToMin(end_time + ":00");
      if (endMin <= startMin) return { ok: false, error: "end_time must be after start_time" };
      const insGrade = grade ?? (teachId ? teachMap.get(teachId)?.grade ?? null : null);
      const insVio = ruleViolations(
        { day, start: minToTime(startMin), end: minToTime(endMin), grade: insGrade, week: null, specialist_id: specId, teacher_id: teachId },
        blocks,
      );
      if (insVio.length) {
        return { ok: false, error: `Cannot add there — it ${insVio.join(" and ")}. Call find_free_slots for slots that WILL work.` };
      }
      const room = teachId ? teachMap.get(teachId)?.room ?? null : null;
      const proposed: BlockRow = {
        id: `tmp_${crypto.randomUUID()}`,
        generation_id: generationId!,
        day_of_week: day,
        start_time: minToTime(startMin),
        end_time: minToTime(endMin),
        subject,
        specialist_id: specId,
        teacher_id: teachId,
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
        specialist_id: specId,
        teacher_id: teachId,
        grade: grade ?? null,
        room,
        week_label: null,
      };
      proposedOps.push(op);
      return { ok: true, status: "proposed", op, inserted: describeBlock(proposed) };
    },
  });

  const bulkReplan = tool({
    description: "Run a partial regeneration over a scope (a specialist, grade, or day). Applies IMMEDIATELY (new schedule version) — only for broad regeneration requests, never a couple of edits.",
    inputSchema: z.object({
      specialist_name: z.string().optional(),
      grade: z.string().optional(),
      day: z.string().optional(),
    }),
    execute: async ({ specialist_name, grade, day }) => {
      const specId = findSpecByName(specialist_name)?.id;
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
      const { data: fresh } = await supabase.from("schedule_blocks").select("*").eq("generation_id", data.new_generation_id ?? generationId);
      blocks = (fresh ?? []) as BlockRow[];
      return { ok: true, replanned: data.replanned ?? 0, new_generation_id: data.new_generation_id ?? null };
    },
  });

  // ─── v2: engine-powered tools ───
  const findFreeSlots = tool({
    description: "Find legal OPEN slots (validated against every rule) for a specialist and/or teacher/grade, optionally on one day. Call this BEFORE moving or inserting so you never guess.",
    inputSchema: z.object({
      specialist_name: z.string().optional(),
      teacher_name: z.string().optional(),
      grade: z.string().optional(),
      day: z.enum(["Mon", "Tue", "Wed", "Thu", "Fri"]).optional(),
      duration: z.number().int().min(15).max(120).optional(),
    }),
    execute: async ({ specialist_name, teacher_name, grade, day, duration }) => {
      const spec = findSpecByName(specialist_name);
      const teach = findTeacherByName(teacher_name);
      if (specialist_name && !spec) return { ok: false, error: `No specialist named "${specialist_name}"` };
      if (teacher_name && !teach) return { ok: false, error: `No teacher named "${teacher_name}"` };
      const slots = enumerateFreeSlots(
        { specialist_id: spec?.id ?? null, teacher_id: teach?.id ?? null, grade: grade ?? null, day: day ?? null, duration: duration ?? null },
        blocks, toolCtx, 30,
      );
      return {
        ok: true, count: slots.length,
        slots: slots.map((s) => `${s.day} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`),
        note: slots.length === 0 ? "No legal open slot matches — relax the filters (another day, shorter duration) or free a slot first." : null,
      };
    },
  });

  const previewOpsTool = tool({
    description: "Preview the ops you have proposed so far this turn: SSOT violations, warnings delta, and the quality % delta vs the current schedule. REQUIRED before finishing any multi-op proposal; report the delta to the user.",
    inputSchema: z.object({}),
    execute: async () => {
      if (proposedOps.length === 0) return { ok: true, message: "No ops proposed yet this turn." };
      const r = previewOps(proposedOps, originalBlocks, toolCtx);
      return {
        ok: true,
        ops: r.ops.map((o) => ({ label: o.label, legal: o.ok, violations: o.violations })),
        all_legal: r.all_legal,
        quality_before: r.quality_before,
        quality_after: r.quality_after,
        quality_delta: r.quality_delta,
        warnings_before: r.warnings_before,
        warnings_after: r.warnings_after,
        new_errors: r.new_errors,
      };
    },
  });

  const fixConflicts = tool({
    description: "Get the deterministic engine's RANKED legal fixes for a double-booking (smallest measured blast radius first) as proposable ops. Never applies anything. Omit block_id to target the first detected conflict.",
    inputSchema: z.object({ block_id: z.string().uuid().optional() }),
    execute: async ({ block_id }) => {
      const r = conflictFixOptions(block_id, blocks, toolCtx);
      if (r.options.length === 0) {
        return {
          ok: true, conflicts_found: r.conflicts_found, options: [],
          escalation: r.escalation,
          message: r.conflicts_found === 0 ? "No conflicts detected." : "No legal one-step fix exists — explain the escalation reason and the input change to the user.",
        };
      }
      // Adopt the TOP option as the proposal (apply to the in-memory view + ops).
      const best = r.options[0];
      const { candidate } = applyOpsToBlocks(blocks, best.ops, toolCtx);
      blocks = candidate;
      proposedOps.push(...best.ops);
      return {
        ok: true, status: "proposed", conflicts_found: r.conflicts_found,
        ops: best.ops,
        chosen: { tactic: best.tactic, blast_radius: best.blast_radius, description: best.description },
        alternatives: r.options.slice(1).map((o) => ({ tactic: o.tactic, blast_radius: o.blast_radius, description: o.description })),
      };
    },
  });

  const runImprove = (label: string, opts: { focus?: string | null; specialist_id?: string | null }) => {
    const r = improveQualityScoped({ ...opts, seedKey: `${generationId}:${label}:${proposedOps.length}` }, blocks, toolCtx);
    if (r.ops.length === 0) {
      return { ok: true, ops: [], quality_delta: 0, note: r.note ?? "No improving move found." };
    }
    const { candidate } = applyOpsToBlocks(blocks, r.ops, toolCtx);
    blocks = candidate;
    proposedOps.push(...r.ops);
    return {
      ok: true, status: "proposed",
      ops: r.ops,
      labels: r.ops.map((o) => (o as any).label),
      quality_before: r.quality_before,
      quality_after: r.quality_after,
      quality_delta: r.quality_delta,
      moved_blocks: r.moved_blocks,
      note: r.note,
    };
  };

  const rebalanceSpecialist = tool({
    description: "Run a short deterministic engine pass that evens out ONE specialist's day-to-day load with the fewest legal moves (perturbation-anchored). Returns the move set as proposed ops + the measured quality delta.",
    inputSchema: z.object({ specialist_name: z.string() }),
    execute: async ({ specialist_name }) => {
      const spec = findSpecByName(specialist_name);
      if (!spec) return { ok: false, error: `No specialist named "${specialist_name}"` };
      return runImprove(`rebalance:${spec.id}`, { specialist_id: spec.id });
    },
  });

  const improveQuality = tool({
    description: "Run a short deterministic engine improvement pass over the whole schedule, optionally focused on one penalty (class_repeats | subject_day_clustering | spec_dayload_stdev). Perturbation-anchored: moves as little as possible. Returns proposed ops + the measured quality delta.",
    inputSchema: z.object({
      focus: z.enum(["class_repeats", "subject_day_clustering", "spec_dayload_stdev"]).optional(),
    }),
    execute: async ({ focus }) => runImprove(`improve:${focus ?? "auto"}`, { focus: focus ?? null }),
  });

  const getQualityReport = tool({
    description: "Get the current schedule's quality: the % score, each active penalty in plain language (worst first), and current warnings. Call this FIRST for vague requests so you know what is actually wrong.",
    inputSchema: z.object({}),
    execute: async () => {
      const r = qualityReport(blocks, toolCtx);
      return {
        ok: true, quality_percent: r.percent,
        issues: r.issues.map((i) => ({ penalty: i.key, description: i.label })),
        warnings: r.warnings.slice(0, 10),
      };
    },
  });

  try {
    const result = streamText({
      model,
      messages: [
        { role: "system" as const, content: STATIC_RULES, providerOptions: cacheEphemeral },
        { role: "system" as const, content: schoolContext, providerOptions: cacheEphemeral },
        { role: "system" as const, content: blockTable },
        ...(await convertToModelMessages(messages)),
      ],
      tools: {
        listBlocks, moveBlock, swapBlocks, deleteBlock, insertBlock, bulkReplan,
        findFreeSlots, previewOps: previewOpsTool, fixConflicts, rebalanceSpecialist, improveQuality, getQualityReport,
      },
      stopWhen: stepCountIs(50),
      maxOutputTokens: 4096,
      temperature: 0.2,
    });

    // Usage logging: proves the prompt-cache is working (turn 2 should show
    // cacheReadInputTokens > 0 for the static-rules + school-context prefix).
    (async () => {
      try {
        const usage = await result.totalUsage;
        const pm = await result.providerMetadata;
        console.log("[schedule-chat] usage", JSON.stringify({ ...usage, anthropic: pm?.anthropic ?? null }));
      } catch (e) {
        console.warn("[schedule-chat] usage logging failed", e);
      }
    })();

    const response = result.toUIMessageStreamResponse({
      originalMessages: messages,
      onError: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[schedule-chat] stream onError", msg);
        return msg || "Chat failed";
      },
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
    for (const [k, v] of Object.entries(corsHeaders)) response.headers.set(k, v);
    return response;
  } catch (err: any) {
    console.error("[schedule-chat] stream error", err);
    return json(500, { error: err?.message ?? "Stream failed" });
  }
});
