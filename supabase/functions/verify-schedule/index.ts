// Post-generation polish — ENGINE repairs, LLM narrates (edit-with-ai v2).
//
// Inverted from the old "Claude proposes fixes → engine validates" flow: now the
// DETERMINISTIC engine finds and applies every fix itself —
//   1. hard conflicts via the blast-radius cascade (resolveConflictsDeterministic)
//   2. soft quality via the perturbation-anchored improveQualityScoped pass
// — and Claude is called ONLY to write the human-readable summary of what the
// engine did (best-effort; a deterministic summary is used without an API key).
// The LLM never invents, selects, or alters a placement.
//
// Response shape is unchanged: { quality_score, issues_found, issues_applied, summary }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { anthropicClient, anthropicApiKey, MODELS, firstToolUse } from "../_shared/anthropic.ts";
import {
  improveQualityScoped, qualityReport, applyOpsToBlocks,
  type EditBlock, type EditOp, type EditToolContext,
} from "./_engine/_editTools.ts";
import { detectConflicts, resolveConflictsDeterministic, type ConflictContext } from "./_engine/_conflict.ts";
import type { Block, Specialist } from "./_engine/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const dbTime = (t: string) => (t.length === 5 ? `${t}:00` : t);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json(401, { error: "Unauthorized" });

    const body = await req.json() as { generation_id: string };
    if (!body?.generation_id) return json(400, { error: "generation_id required" });

    const { data: gen, error: genErr } = await supabase
      .from("schedule_generations").select("id, school_id, score_breakdown, chosen_strategy")
      .eq("id", body.generation_id).maybeSingle();
    if (genErr || !gen) return json(404, { error: "Generation not found" });
    const schoolId = gen.school_id;

    const [blocksRes, specRes, teachRes, recessRes, schoolRes] = await Promise.all([
      supabase.from("schedule_blocks").select("*").eq("generation_id", body.generation_id),
      supabase.from("specialists").select("*").eq("school_id", schoolId),
      supabase.from("classroom_teachers").select("id, name, grade, room, am_pm_preference, day_preference, weekly_planning_minutes").eq("school_id", schoolId),
      supabase.from("recess_lunch_config").select("*").eq("school_id", schoolId),
      // select("*") on purpose: an explicit column list silently 400s the WHOLE
    // row the moment a migration adds a column the live DB lacks, and it also
    // quietly starved the engine of newer settings (rotations_start_time, the
    // teacher duty day). A single school row is cheap to fetch whole.
    supabase.from("schools").select("*").eq("id", schoolId).maybeSingle(),
    ]);

    let blocks = (blocksRes.data ?? []) as EditBlock[];
    const school = (schoolRes.data ?? {}) as any;
    const ctx: EditToolContext = {
      school, recessConfigs: recessRes.data ?? [],
      specialists: (specRes.data ?? []) as unknown as Specialist[],
      teachers: (teachRes.data ?? []) as any,
      grades: school.grades_served ?? [],
    };

    const beforeReport = qualityReport(blocks, ctx);

    // ── 1. ENGINE: hard conflicts via the deterministic blast-radius cascade ──
    const conflictCtx: ConflictContext = {
      specialists: ctx.specialists,
      teachers: (ctx.teachers as any[]).map((t) => ({ id: t.id, grade: t.grade })),
      grades: ctx.grades, school, recessConfigs: ctx.recessConfigs,
    };
    let applied = 0;
    const appliedDescriptions: string[] = [];
    const escalationReasons: string[] = [];
    const conflictsBefore = detectConflicts(blocks as unknown as Block[], conflictCtx).length;
    if (conflictsBefore > 0) {
      // Working copy carries real DB ids, so change blockIds map directly.
      const batch = resolveConflictsDeterministic(blocks.map((b) => ({ ...b })) as unknown as Block[], conflictCtx);
      // Persist by diff (resolveConflictsDeterministic returns full result blocks;
      // moves keep their `id` because we passed rows that carry real ids).
      const beforeById = new Map(blocks.map((b) => [b.id, b]));
      for (const rb of batch.finalBlocks as unknown as EditBlock[]) {
        const prev = rb.id ? beforeById.get(rb.id) : undefined;
        if (!prev) {
          // Added session (no_coverage fix).
          const { error } = await supabase.from("schedule_blocks").insert({
            generation_id: body.generation_id, day_of_week: rb.day_of_week,
            start_time: dbTime(rb.start_time), end_time: dbTime(rb.end_time), subject: rb.subject,
            specialist_id: rb.specialist_id, teacher_id: rb.teacher_id, grade: rb.grade,
            room: rb.room, week_label: rb.week_label, is_override: true,
          });
          if (!error) applied++;
          continue;
        }
        if (prev.day_of_week !== rb.day_of_week || prev.start_time !== rb.start_time || prev.end_time !== rb.end_time) {
          const { error } = await supabase.from("schedule_blocks").update({
            day_of_week: rb.day_of_week, start_time: dbTime(rb.start_time), end_time: dbTime(rb.end_time), is_override: true,
          }).eq("id", rb.id);
          if (!error) applied++;
        }
      }
      for (const o of batch.appliedOptions) appliedDescriptions.push(o.description);
      for (const e of batch.escalations) escalationReasons.push(e.escalation.reason);
      blocks = batch.finalBlocks as unknown as EditBlock[];
    }

    // ── 2. ENGINE: soft quality via the anchored improvement pass ──
    const improve = improveQualityScoped({ seedKey: `verify:${body.generation_id}` }, blocks, ctx);
    if (improve.ops.length > 0) {
      for (const op of improve.ops) {
        if (op.kind === "move") {
          const { error } = await supabase.from("schedule_blocks").update({
            day_of_week: op.day_of_week, start_time: dbTime(op.start_time), end_time: dbTime(op.end_time), is_override: true,
          }).eq("id", op.block_id);
          if (!error) { applied++; appliedDescriptions.push((op as any).label); }
        } else if (op.kind === "delete") {
          const { error } = await supabase.from("schedule_blocks").delete().eq("id", op.block_id);
          if (!error) applied++;
        } else if (op.kind === "insert") {
          const { error } = await supabase.from("schedule_blocks").insert({
            generation_id: body.generation_id, day_of_week: op.day_of_week,
            start_time: dbTime(op.start_time), end_time: dbTime(op.end_time), subject: op.subject,
            specialist_id: op.specialist_id, teacher_id: op.teacher_id, grade: op.grade,
            room: op.room, week_label: op.week_label, is_override: true,
          });
          if (!error) { applied++; appliedDescriptions.push((op as any).label); }
        }
      }
      const { candidate } = applyOpsToBlocks(blocks, improve.ops as EditOp[], ctx);
      blocks = candidate;
    }

    // ── 3. Score the result via the shared rubric ──
    const afterReport = qualityReport(blocks, ctx);
    const issuesFound = beforeReport.issues.length;

    // ── 4. LLM narrates ONLY (best-effort) ──
    let summary = deterministicSummary(beforeReport.percent, afterReport.percent, appliedDescriptions, escalationReasons, afterReport.issues.map((i) => i.label));
    if (anthropicApiKey() && (appliedDescriptions.length > 0 || escalationReasons.length > 0 || afterReport.issues.length > 0)) {
      try {
        const NARRATE_TOOL = {
          name: "narrate_review",
          description: "Write a 1-3 sentence plain-language summary of a schedule polish the deterministic engine already performed. Never invent or suggest placements.",
          input_schema: {
            type: "object",
            properties: { summary: { type: "string" } },
            required: ["summary"],
          },
        };
        const payload = {
          quality_before: beforeReport.percent,
          quality_after: afterReport.percent,
          engine_changes: appliedDescriptions.slice(0, 12),
          unresolvable: escalationReasons.slice(0, 4),
          remaining_issues: afterReport.issues.slice(0, 6).map((i) => i.label),
          note: "The engine made these changes; they are final and rule-legal. Summarize for a school scheduling admin.",
        };
        const resp = await anthropicClient().messages.create({
          model: MODELS.deep,
          max_tokens: 500,
          system: "You summarize scheduling changes a deterministic engine already made. You never invent, select, or alter placements.",
          tools: [NARRATE_TOOL as any],
          tool_choice: { type: "tool", name: "narrate_review" },
          messages: [{ role: "user", content: JSON.stringify(payload) }],
        });
        const out = firstToolUse(resp.content as any[], "narrate_review")?.input as { summary?: string } | undefined;
        if (out?.summary) summary = out.summary;
      } catch (err) {
        console.warn("[verify-schedule] narration failed (non-fatal):", err);
      }
    }

    await supabase.from("schedule_generations").update({
      verify_quality_score: afterReport.percent,
      verify_issues_found: issuesFound,
      verify_summary: summary,
      ...(applied > 0 ? { score_breakdown: afterReport.breakdown } : {}),
    }).eq("id", body.generation_id);

    return json(200, {
      quality_score: afterReport.percent,
      issues_found: issuesFound,
      issues_applied: applied,
      summary,
    });
  } catch (e: any) {
    return json(500, { error: e?.message ?? "Unknown error" });
  }
});

function deterministicSummary(before: number, after: number, changes: string[], escalations: string[], remaining: string[]): string {
  const parts: string[] = [];
  if (changes.length > 0) parts.push(`The engine applied ${changes.length} fix${changes.length === 1 ? "" : "es"} (${before}% → ${after}%).`);
  else parts.push(`No engine fix improved this schedule further (${after}%).`);
  if (escalations.length > 0) parts.push(`${escalations.length} issue${escalations.length === 1 ? "" : "s"} need${escalations.length === 1 ? "s" : ""} a human decision.`);
  if (remaining.length > 0) parts.push(`Remaining: ${remaining.slice(0, 3).join("; ")}.`);
  return parts.join(" ");
}
