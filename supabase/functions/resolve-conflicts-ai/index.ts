// Deterministic conflict resolution; the LLM only narrates (Phase 3).
//
// The deterministic engine (_conflict.ts) DETECTS real conflicts from the blocks
// (via the SSOT), and for each produces a ranked list of legal options with a
// measured blast radius — then applies the smallest-radius option. Every applied
// change came from the engine and passed the SSOT. The LLM is called ONLY to
// write a human-readable rationale/summary of what the engine did and to explain
// any escalations; it never invents or selects placements outside the engine's
// legal set. If the LLM is unavailable, a deterministic summary is returned.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  detectConflicts,
  resolveConflict,
  type Conflict,
  type ConflictContext,
  type ResolveOption,
  type ConflictEscalation,
} from "../generate-schedule/_conflict.ts";
import type { Block, Specialist } from "../generate-schedule/index.ts";
import { anthropicClient, anthropicApiKey, CLAUDE_MODEL, firstToolUse, describeAnthropicError } from "../_shared/anthropic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** minutesToTime yields "HH:MM"; the DB stores "HH:MM:SS". */
const dbTime = (t: string) => (t.length === 5 ? `${t}:00` : t);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json(401, { error: "Unauthorized" });

    const body = (await req.json()) as { generation_id?: string };
    if (!body?.generation_id) return json(400, { error: "generation_id required" });

    const { data: gen, error: genErr } = await supabase
      .from("schedule_generations")
      .select("id, school_id, warnings")
      .eq("id", body.generation_id)
      .maybeSingle();
    if (genErr || !gen) return json(404, { error: "Generation not found" });

    const schoolId = gen.school_id;
    const [blocksRes, specRes, teachRes, recessRes, schoolRes] = await Promise.all([
      supabase.from("schedule_blocks").select("*").eq("generation_id", body.generation_id),
      supabase.from("specialists").select("id, name, subject, working_days, location, class_duration").eq("school_id", schoolId),
      supabase.from("classroom_teachers").select("id, name, grade, room").eq("school_id", schoolId),
      supabase.from("recess_lunch_config").select("*").eq("school_id", schoolId),
      supabase.from("schools").select("name, start_time, end_time, grades_served, class_duration, passing_time, setup_time, grade_time_config, early_release_day, early_release_end_time, recess_grade_bands").eq("id", schoolId).maybeSingle(),
    ]);

    const dbBlocks = (blocksRes.data ?? []) as any[];
    const specialists = (specRes.data ?? []) as any[];
    const teachers = (teachRes.data ?? []) as any[];
    const school = schoolRes.data ?? {};
    const recessConfigs = recessRes.data ?? [];

    const ctx: ConflictContext = {
      specialists: specialists as unknown as Specialist[],
      teachers: teachers.map((t) => ({ id: t.id, grade: t.grade })),
      grades: (school as any).grades_served ?? [],
      school,
      recessConfigs,
    };
    const teacherById: Record<string, any> = Object.fromEntries(teachers.map((t) => [t.id, t]));
    const specById: Record<string, any> = Object.fromEntries(specialists.map((s) => [s.id, s]));

    // Working copy carries the REAL DB ids, so engine option `changes` reference
    // them directly and can be applied without any id remapping.
    let working: Block[] = dbBlocks.map((b) => ({
      generation_id: b.generation_id, id: b.id, day_of_week: b.day_of_week, start_time: b.start_time,
      end_time: b.end_time, subject: b.subject, specialist_id: b.specialist_id, teacher_id: b.teacher_id,
      grade: b.grade, room: b.room, week_label: b.week_label,
    } as any));

    // ── Deterministic cascade: detect → resolve smallest-radius → apply ──
    type AppliedChange =
      | { type: "move"; block_id: string; day_of_week: string; start_time: string; end_time: string }
      | { type: "add"; block: Record<string, any> };
    const dbOps: AppliedChange[] = [];
    const appliedOptions: ResolveOption[] = [];
    const escalations: Array<{ conflict: Conflict; escalation: ConflictEscalation }> = [];
    const escalatedIds = new Set<string>();
    let tmpAddSeq = 0;

    const MAX_ROUNDS = working.length + 1;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const conflicts = detectConflicts(working, ctx).filter((c) => !c.blockId || !escalatedIds.has(c.blockId));
      if (conflicts.length === 0) break;
      const conflict = conflicts[0];
      const outcome = resolveConflict(conflict, working, ctx);
      if (!outcome.resolved || outcome.options.length === 0) {
        if (conflict.blockId) escalatedIds.add(conflict.blockId);
        if (outcome.escalation) escalations.push({ conflict, escalation: outcome.escalation });
        continue;
      }
      const best = outcome.options[0];
      appliedOptions.push(best);
      // Apply the option's changes to the working copy (by real id) + queue DB ops.
      for (const ch of best.changes) {
        if (ch.op === "move" && ch.blockId) {
          const wb = working.find((b) => (b as any).id === ch.blockId);
          if (wb) { wb.day_of_week = ch.to.day_of_week; wb.start_time = dbTime(ch.to.start_time); wb.end_time = dbTime(ch.to.end_time); }
          dbOps.push({ type: "move", block_id: ch.blockId, day_of_week: ch.to.day_of_week, start_time: dbTime(ch.to.start_time), end_time: dbTime(ch.to.end_time) });
        } else if (ch.op === "add" && conflict.kind === "no_coverage") {
          const spec = specById[conflict.specialistId!];
          const teach = teacherById[conflict.teacherId!];
          const newBlock = {
            generation_id: body.generation_id, day_of_week: ch.to.day_of_week,
            start_time: dbTime(ch.to.start_time), end_time: dbTime(ch.to.end_time),
            subject: spec?.subject ?? null, specialist_id: conflict.specialistId, teacher_id: conflict.teacherId,
            grade: conflict.grade, room: spec?.location ?? teach?.room ?? null, week_label: null,
            is_override: true, placement_reason: best.description,
          };
          working.push({ ...newBlock, id: `__add_${tmpAddSeq++}` } as any);
          dbOps.push({ type: "add", block: newBlock });
        }
      }
    }

    // ── Apply queued DB ops (each already SSOT-validated by the engine) ──
    let applied = 0;
    const errors: string[] = [];
    for (const op of dbOps) {
      if (op.type === "move") {
        const { error } = await supabase.from("schedule_blocks")
          .update({ day_of_week: op.day_of_week, start_time: op.start_time, end_time: op.end_time, is_override: true })
          .eq("id", op.block_id);
        if (error) errors.push(`move ${op.block_id}: ${error.message}`); else applied++;
      } else {
        const { error } = await supabase.from("schedule_blocks").insert(op.block);
        if (error) errors.push(`add: ${error.message}`); else applied++;
      }
    }

    // ── LLM narration ONLY (best-effort; the engine already decided everything) ──
    let summary = deterministicSummary(appliedOptions, escalations);
    let rationale: Array<{ change: string; why: string }> = [];
    if (anthropicApiKey() && (appliedOptions.length > 0 || escalations.length > 0)) {
      try {
        const NARRATE_TOOL = {
          name: "narrate_resolution",
          description: "Write a human-friendly summary and per-change rationale for conflict fixes that have ALREADY been chosen by the deterministic scheduler. Do not invent or change any placement.",
          input_schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
              rationale: { type: "array", items: { type: "object", properties: { change: { type: "string" }, why: { type: "string" } }, required: ["change", "why"] } },
            },
            required: ["summary"],
          },
        };
        const payload = {
          applied: appliedOptions.map((o) => ({ tactic: o.tactic, blast_radius: o.blastRadius, change: o.description })),
          escalations: escalations.map((e) => ({ reason: e.escalation.reason, conflicting_constraints: e.escalation.conflictingConstraints })),
          note: "These changes are final and SSOT-legal. Explain them clearly for a school scheduling admin. Do not propose alternatives.",
        };
        const resp = await anthropicClient().messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 1500,
          system: "You explain scheduling changes that a deterministic engine already made. You never invent, select, or alter placements — you only narrate the engine's decisions and escalations in plain language.",
          tools: [NARRATE_TOOL as any],
          tool_choice: { type: "tool", name: "narrate_resolution" },
          messages: [{ role: "user", content: JSON.stringify(payload) }],
        });
        const out = firstToolUse(resp.content as any[], "narrate_resolution")?.input as { summary?: string; rationale?: Array<{ change: string; why: string }> } | undefined;
        if (out?.summary) summary = out.summary;
        if (Array.isArray(out?.rationale)) rationale = out!.rationale!;
      } catch (err) {
        const e = describeAnthropicError(err);
        console.warn("narration failed (non-fatal):", e.message);
      }
    }

    // Clear warnings; the client reloads and recomputes fresh ones.
    await supabase.from("schedule_generations").update({ warnings: [] }).eq("id", body.generation_id);

    return json(200, {
      resolved: appliedOptions.length,
      applied,
      escalated: escalations.length,
      // Ranked legal fixes the engine applied, with their MEASURED blast radius
      // (power 5): "Relocate this class — affects 1", "Swap two sessions — affects 2".
      applied_changes: appliedOptions.map((o) => ({ tactic: o.tactic, blast_radius: o.blastRadius, description: o.description })),
      escalations: escalations.map((e) => ({ reason: e.escalation.reason, conflicting_constraints: e.escalation.conflictingConstraints })),
      summary,
      rationale,
      errors,
    });
  } catch (e: any) {
    return json(500, { error: e?.message ?? "Unknown error" });
  }
});

function deterministicSummary(applied: ResolveOption[], escalations: Array<{ escalation: ConflictEscalation }>): string {
  const parts: string[] = [];
  if (applied.length > 0) {
    parts.push(`Resolved ${applied.length} conflict${applied.length === 1 ? "" : "s"} with the smallest schedule change (blast radius ${applied.map((o) => o.blastRadius).join(", ")}).`);
    for (const o of applied) parts.push(`• ${o.description}`);
  }
  if (escalations.length > 0) {
    parts.push(`${escalations.length} conflict${escalations.length === 1 ? "" : "s"} need a human decision:`);
    for (const e of escalations) parts.push(`• ${e.escalation.reason}`);
  }
  if (parts.length === 0) parts.push("No conflicts to resolve.");
  return parts.join("\n");
}
