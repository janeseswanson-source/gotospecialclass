// Polish pass — Claude reviews the generated schedule and improves it.
//
// The deterministic solver produces a conflict-free schedule; this pass has
// Claude Opus 4.8 review it WITH FULL SETUP CONTEXT (specialist subjects/days,
// teacher grades + AM/PM preferences, school hours, recess, strategy) and
// propose concrete improvements for the soft problems the optimizer's score
// flags — subject gaps, day-clustering, uneven loads, ignored preferences.
//
// Every proposed edit is re-validated against the SAME hard rules the generator
// enforces (the shared constraint validator), so Claude can only ever improve
// the schedule — it can never introduce a double-booking, a recess/PLC clash,
// or an out-of-hours block. Runs up to two rounds so it can keep polishing.
//
// Degrades gracefully: with no ANTHROPIC_API_KEY it still writes the rubric
// quality score (just without the AI narrative/fixes).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildConstraintContext, violations as constraintViolations } from "../_shared/constraints.ts";
import { anthropicClient, anthropicApiKey, CLAUDE_MODEL, firstToolUse, describeAnthropicError } from "../_shared/anthropic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function toMin(t?: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

const REVIEW_TOOL = {
  name: "report_review",
  description: "Report the schedule review: the concrete issues found and a minimal, conflict-free fix for each, plus a one-to-two sentence overall assessment.",
  input_schema: {
    type: "object",
    properties: {
      issues_found: {
        type: "array",
        description: "Each soft-quality issue worth fixing, worst first. Empty if the schedule is already good.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", description: "subject_gap | day_clustering | load_imbalance | preference_violation | k_late | cart_conflict | class_repeat" },
            description: { type: "string", description: "Plain-English explanation a school coordinator would understand." },
            affected_grade: { type: ["string", "null"] },
            fix: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["move", "none"] },
                block_id: { type: "string", description: "Id of the block to move (from the BLOCKS list)." },
                new_day: { type: ["string", "null"], description: "Mon|Tue|Wed|Thu|Fri or null to keep the day." },
                new_start: { type: ["string", "null"], description: "HH:MM 24-hour or null to keep the time." },
                new_end: { type: ["string", "null"], description: "HH:MM 24-hour or null to keep the time." },
                reason: { type: "string" },
              },
              required: ["action"],
            },
          },
          required: ["type", "description", "fix"],
        },
      },
      summary: { type: "string" },
    },
    required: ["issues_found", "summary"],
  },
};

const SYSTEM = `You are a veteran K-6 elementary "specials" scheduling coordinator reviewing a computer-generated weekly schedule before it goes to teachers.

The schedule is already conflict-free (no double-bookings, nothing during recess/lunch or PLC). Your job is to improve QUALITY: make sure every class sees every specialist, spread subjects across the week (no subject twice in a day for one grade), balance each specialist's daily load, honor teacher AM/PM preferences, and keep Kindergarten sessions out of the late afternoon.

Propose ONLY minimal, safe moves — moving one block to a free day/time. Never propose a move that would put two classes with the same teacher or specialist at the same time, or land on recess/lunch/PLC, or fall outside school hours; those will be rejected. If the schedule is already good, return an empty issues list and say so. Always answer by calling the report_review tool.`;

function buildSummary(blocks: any[], grades: string[], specialists: any[]): string {
  const byGrade: Record<string, Record<string, string[]>> = {};
  for (const g of grades) { byGrade[g] = {}; for (const d of DAYS) byGrade[g][d] = []; }
  for (const b of blocks) {
    if (!b.specialist_id || !b.grade || ["Lunch", "Planning", "Makeup"].includes(b.grade)) continue;
    const spec = specialists.find((s) => s.id === b.specialist_id);
    (byGrade[b.grade] ??= {})[b.day_of_week] ??= [];
    byGrade[b.grade][b.day_of_week].push(`${b.subject ?? spec?.subject ?? "?"}@${String(b.start_time).slice(0, 5)} [${b.id}]`);
  }
  const lines: string[] = [];
  for (const g of grades) {
    lines.push(`Grade ${g}:`);
    for (const d of DAYS) {
      const s = (byGrade[g] ?? {})[d] ?? [];
      lines.push(`  ${d}: ${s.length ? s.join(", ") : "—"}`);
    }
  }
  return lines.join("\n");
}

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
      .from("schedule_generations").select("id, school_id, warnings, score_breakdown, chosen_strategy")
      .eq("id", body.generation_id).maybeSingle();
    if (genErr || !gen) return json(404, { error: "Generation not found" });
    const schoolId = gen.school_id;

    const [blocksRes, specRes, teachRes, recessRes, schoolRes] = await Promise.all([
      supabase.from("schedule_blocks").select("*").eq("generation_id", body.generation_id),
      supabase.from("specialists").select("id, name, subject, working_days, uses_cart, location").eq("school_id", schoolId),
      supabase.from("classroom_teachers").select("id, name, grade, am_pm_preference, day_preference").eq("school_id", schoolId),
      supabase.from("recess_lunch_config").select("*").eq("school_id", schoolId),
      supabase.from("schools").select("name, start_time, end_time, grades_served, class_duration, early_release_day, early_release_end_time, recess_grade_bands, conflict_grades").eq("id", schoolId).maybeSingle(),
    ]);

    let blocks = blocksRes.data ?? [];
    const specialists = specRes.data ?? [];
    const teachers = teachRes.data ?? [];
    const school = (schoolRes.data ?? {}) as any;
    const grades: string[] = school.grades_served ?? [];
    const scoreBreakdown = (gen.score_breakdown ?? {}) as Record<string, number>;
    const warnings = Array.isArray(gen.warnings) ? gen.warnings : [];

    // Deterministic quality score from the optimizer's own penalty breakdown,
    // so reviewer and generator agree on what "good" means.
    const bd = scoreBreakdown;
    const penaltyMag =
      Math.abs(bd.subject_gap ?? 0) + Math.abs(bd.subject_day_clustering ?? 0) + Math.abs(bd.class_repeats ?? 0) +
      Math.abs(bd.k_grade_after_780 ?? 0) + Math.abs(bd.cart_back_to_back ?? 0) + Math.abs(bd.grade_cohesion ?? 0) +
      Math.abs(bd.contract_min ?? 0) + Math.abs(bd.warnings ?? 0) + Math.abs(bd.errors ?? 0);
    const rubricScore = Math.max(0, Math.min(100, Math.round(100 - penaltyMag / 4)));

    // No key → still record the rubric score; skip the AI narrative/fixes.
    if (!anthropicApiKey()) {
      await supabase.from("schedule_generations").update({
        verify_quality_score: rubricScore, verify_issues_found: 0, verify_summary: null,
      }).eq("id", body.generation_id);
      return json(200, { quality_score: rubricScore, issues_found: 0, issues_applied: 0, summary: null, skipped: "no_api_key" });
    }

    // Constraint context + apply helpers (shared with the generator's rules).
    const dayStart = toMin(school.start_time) ?? 8 * 60;
    const dayEnd = toMin(school.end_time) ?? 15 * 60;
    const constraintCtx = buildConstraintContext(school, recessRes.data ?? [], blocks);

    type Eff = { id: string; day: string; start: number; end: number; spec: string | null; teacher: string | null; grade: string | null; week: string | null };
    let effective: Eff[] = blocks.map((b: any) => {
      const s = toMin(b.start_time), e = toMin(b.end_time);
      return s === null || e === null ? null : { id: b.id, day: b.day_of_week, start: s, end: e, spec: b.specialist_id ?? null, teacher: b.teacher_id ?? null, grade: b.grade ?? null, week: b.week_label ?? null };
    }).filter((x: Eff | null): x is Eff => x !== null);

    const collides = (day: string, start: number, end: number, spec: string | null, teacher: string | null, ignoreId: string) =>
      effective.some((e) => e.id !== ignoreId && e.day === day && start < e.end && e.start < end && ((spec && e.spec === spec) || (teacher && e.teacher === teacher)));

    // Context blocks for the model: specialists, teachers, hours.
    const specCtx = specialists.map((s: any) => `${s.name} (${s.subject})${s.uses_cart ? " [cart]" : ""} — works ${(s.working_days ?? DAYS).join("/")}`).join("\n");
    const teachCtx = teachers.map((t: any) => `Gr ${t.grade} ${t.name}${t.am_pm_preference ? ` — prefers ${t.am_pm_preference}` : ""}${t.day_preference ? `, prefers ${t.day_preference}` : ""}`).join("\n");
    const earlyRelease = school.early_release_day ? `${school.early_release_day} ends ${school.early_release_end_time ?? "early"}` : "none";

    const client = anthropicClient();
    const allIssues: any[] = [];
    let lastSummary: string | null = null;
    let applied = 0;

    for (let round = 0; round < 2; round++) {
      const summary = buildSummary(blocks, grades, specialists);
      const userPrompt = `SCHOOL: ${school.name ?? "this school"} — hours ${school.start_time ?? "?"}–${school.end_time ?? "?"}, early release: ${earlyRelease}. Strategy: ${gen.chosen_strategy ?? "standard"}.

SPECIALISTS:
${specCtx || "(none)"}

CLASSES (grade + teacher + preferences):
${teachCtx || "(none)"}

OPTIMIZER PENALTIES (negative = worse): ${Object.entries(scoreBreakdown).filter(([, v]) => (v as number) < 0).map(([k, v]) => `${k}:${v}`).join(", ") || "none"}
EXISTING WARNINGS: ${warnings.map((w: any) => w.message).slice(0, 8).join(" | ") || "none"}

CURRENT SCHEDULE (grade → day → subject@start [block_id]):
${summary}

Review it and call report_review with the worst remaining quality issues and a minimal move to fix each. ${round > 0 ? "This is a second pass after applying your earlier fixes — only report issues that still remain." : ""}`;

      let plan: any = null;
      try {
        const resp = await client.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4000,
          system: SYSTEM,
          tools: [REVIEW_TOOL as any],
          tool_choice: { type: "tool", name: "report_review" },
          messages: [{ role: "user", content: userPrompt }],
        });
        plan = firstToolUse(resp.content as any[], "report_review")?.input ?? null;
      } catch (err) {
        const { status, message } = describeAnthropicError(err);
        // First round failure with no result → surface; later round → keep what we have.
        if (round === 0) return json(status, { error: message });
        break;
      }

      if (!plan) break;
      const issues: any[] = Array.isArray(plan.issues_found) ? plan.issues_found : [];
      lastSummary = typeof plan.summary === "string" ? plan.summary : lastSummary;
      if (round === 0) allIssues.push(...issues);

      let appliedThisRound = 0;
      for (const issue of issues) {
        const fix = issue?.fix;
        if (!fix || fix.action !== "move" || !fix.block_id) continue;
        const cur = effective.find((e) => e.id === fix.block_id);
        if (!cur) continue;
        const newDay = fix.new_day ?? cur.day;
        const newStart = fix.new_start ? toMin(fix.new_start) : cur.start;
        const newEnd = fix.new_end ? toMin(fix.new_end) : cur.end;
        if (newStart === null || newEnd === null || newEnd <= newStart) continue;
        if (newStart < dayStart || newEnd > dayEnd) continue;
        if (collides(newDay, newStart, newEnd, cur.spec, cur.teacher, cur.id)) continue;
        // Hard-rule re-validation (recess/lunch/PLC/hours) against the live layout.
        const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
        const vio = constraintViolations(
          { id: cur.id, day_of_week: newDay, start_time: hhmm(newStart), end_time: hhmm(newEnd), grade: cur.grade, week_label: cur.week, specialist_id: cur.spec, teacher_id: cur.teacher },
          [],
          constraintCtx,
        );
        if (vio.length) continue;

        const patch: Record<string, any> = {};
        if (fix.new_day) patch.day_of_week = fix.new_day;
        if (fix.new_start) patch.start_time = hhmm(newStart);
        if (fix.new_end) patch.end_time = hhmm(newEnd);
        if (typeof fix.reason === "string") patch.placement_reason = fix.reason.slice(0, 500);
        if (Object.keys(patch).length === 0) continue;

        const { error } = await supabase.from("schedule_blocks").update(patch).eq("id", cur.id);
        if (error) continue;
        cur.day = newDay; cur.start = newStart; cur.end = newEnd;
        applied++; appliedThisRound++;
      }

      if (appliedThisRound === 0) break; // nothing improved → stop iterating
      // Reload blocks so the next round reviews the improved layout.
      const { data: fresh } = await supabase.from("schedule_blocks").select("*").eq("generation_id", body.generation_id);
      blocks = fresh ?? blocks;
    }

    await supabase.from("schedule_generations").update({
      verify_quality_score: rubricScore,
      verify_issues_found: allIssues.length,
      verify_summary: lastSummary,
    }).eq("id", body.generation_id);

    return json(200, { quality_score: rubricScore, issues_found: allIssues.length, issues_applied: applied, summary: lastSummary });
  } catch (e: any) {
    return json(500, { error: e?.message ?? "Unknown error" });
  }
});
