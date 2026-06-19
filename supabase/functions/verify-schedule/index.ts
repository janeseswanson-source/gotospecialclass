import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildConstraintContext, violations as constraintViolations } from "../_shared/constraints.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toMin(t?: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

type Iv = [number, number];
function overlapsAny(ivs: Iv[] | undefined, s: number, e: number): boolean {
  if (!ivs) return false;
  for (const [a, b] of ivs) if (s < b && e > a) return true;
  return false;
}

const parsePlan = (raw: string) => {
  let c = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(c); } catch {
    const first = c.indexOf("{"); const last = c.lastIndexOf("}");
    if (first >= 0 && last > first) { try { return JSON.parse(c.slice(first, last + 1)); } catch { } }
    return null;
  }
};

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
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json(401, { error: "Unauthorized" });

    const body = await req.json() as { generation_id: string };
    if (!body?.generation_id) return json(400, { error: "generation_id required" });

    const { data: gen, error: genErr } = await supabase
      .from("schedule_generations")
      .select("id, school_id, warnings, score_breakdown")
      .eq("id", body.generation_id)
      .maybeSingle();
    if (genErr || !gen) return json(404, { error: "Generation not found" });

    const schoolId = gen.school_id;

    const [blocksRes, specRes, teachRes, recessRes, schoolRes] = await Promise.all([
      supabase.from("schedule_blocks").select("*").eq("generation_id", body.generation_id),
      supabase.from("specialists").select("id, name, subject, working_days, uses_cart, location").eq("school_id", schoolId),
      supabase.from("classroom_teachers").select("id, name, grade, am_pm_preference").eq("school_id", schoolId),
      supabase.from("recess_lunch_config").select("*").eq("school_id", schoolId),
      supabase.from("schools").select("name, start_time, end_time, grades_served, class_duration, early_release_day, early_release_end_time, recess_grade_bands").eq("id", schoolId).maybeSingle(),
    ]);

    const blocks = blocksRes.data ?? [];
    const specialists = specRes.data ?? [];
    const teachers = teachRes.data ?? [];
    const school = schoolRes.data ?? {};
    const grades: string[] = (school as any).grades_served ?? [];
    const warnings = Array.isArray(gen.warnings) ? gen.warnings : [];
    const scoreBreakdown = gen.score_breakdown ?? {};

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json(500, { error: "LOVABLE_API_KEY missing" });

    // Build schedule summary table
    const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    type GradeDay = { specialist: string; subject: string; time: string };
    const summaryByGrade: Record<string, Record<string, GradeDay[]>> = {};
    for (const grade of grades) {
      summaryByGrade[grade] = {};
      for (const day of DAYS) summaryByGrade[grade][day] = [];
    }
    for (const b of blocks) {
      if (!b.specialist_id || !b.grade || b.grade === "Lunch" || b.grade === "Planning" || b.grade === "Makeup") continue;
      if (!summaryByGrade[b.grade]) summaryByGrade[b.grade] = {};
      if (!summaryByGrade[b.grade][b.day_of_week]) summaryByGrade[b.grade][b.day_of_week] = [];
      const spec = specialists.find((s: any) => s.id === b.specialist_id);
      summaryByGrade[b.grade][b.day_of_week].push({
        specialist: spec?.name ?? "?",
        subject: b.subject ?? spec?.subject ?? "?",
        time: `${b.start_time}-${b.end_time}`,
      });
    }

    const summaryLines: string[] = [];
    for (const grade of grades) {
      const row = [`Grade ${grade}:`];
      for (const day of DAYS) {
        const sessions = (summaryByGrade[grade] ?? {})[day] ?? [];
        row.push(`  ${day}: ${sessions.length ? sessions.map(s => `${s.subject}@${s.time}`).join(", ") : "none"}`);
      }
      summaryLines.push(row.join("\n"));
    }

    const breakdownLines = Object.entries(scoreBreakdown).map(([k, v]) => `  ${k}: ${v}`).join("\n");
    const warningLines = warnings.map((w: any) => `  [${w.severity}] ${w.message}`).join("\n");

    // ─── D: shared rubric ─────────────────────────────────────────────
    // Quality score is derived from the generator's actual penalty breakdown
    // (the same rubric the optimizer ran against) so verifier and generator
    // agree on what "good" means. AI is asked only for qualitative narrative
    // and concrete fixes — not to invent a score.
    const bd = (scoreBreakdown ?? {}) as Record<string, number>;
    // Penalty magnitudes that drag the score down. Tunable cap of 100 pts.
    const penaltyMag =
      Math.abs(bd.subject_gap ?? 0) +
      Math.abs(bd.subject_day_clustering ?? 0) +
      Math.abs(bd.class_repeats ?? 0) +
      Math.abs(bd.k_grade_after_780 ?? 0) +
      Math.abs(bd.cart_back_to_back ?? 0) +
      Math.abs(bd.grade_cohesion ?? 0) +
      Math.abs(bd.contract_min ?? 0) +
      Math.abs(bd.warnings ?? 0) +
      Math.abs(bd.errors ?? 0);
    // Hard floor of 0; perfect schedule (no penalties) → 100.
    const rubricScore = Math.max(0, Math.min(100, Math.round(100 - penaltyMag / 4)));

    const prompt = `You are a K-6 elementary specials scheduling expert reviewing a generated schedule.

The OPTIMIZER already scored this schedule using the same rubric you should use. Its breakdown is below.
Your job: explain WHY the schedule scored where it did (qualitative narrative) and propose CONCRETE FIXES
for the worst remaining issues. Do not invent a numeric score — use the rubric score we provide.

RUBRIC SCORE (computed from generator breakdown): ${rubricScore}/100

SCHEDULE SUMMARY (grade → day → sessions):
${summaryLines.join("\n\n")}

SCORE BREAKDOWN (negative = penalty):
${breakdownLines || "  (none)"}

EXISTING WARNINGS:
${warningLines || "  (none)"}

QUALITY CRITERIA (mirrors generator weights):
1. subject_gap: every grade should see every specialist at least once per week.
2. subject_day_clustering: no grade should have the same subject twice in one day.
3. class_repeats: each grade should see distinct specialists across the week.
4. k_grade_after_780: K/TK sessions should not start at or after 1:00 PM.
5. cart_back_to_back: cart specialists should not be in different rooms back-to-back.
6. spec_dayload_stdev: each specialist's load should be balanced across days.
7. AM/PM and day preferences should be honored where possible.

For any issue, propose the MINIMUM fix. Only suggest moves/swaps that won't create new conflicts.
Block IDs to reference: ${blocks.filter((b: any) => b.specialist_id).slice(0, 50).map((b: any) => b.id).join(", ")}

Respond ONLY with valid JSON:
{
  "issues_found": [
    {
      "type": "subject_gap"|"day_clustering"|"load_imbalance"|"preference_violation"|"k_late"|"cart_conflict"|"class_repeat",
      "description": "<plain English>",
      "affected_grade": "<grade or null>",
      "affected_specialist_id": "<id or null>",
      "fix": {
        "action": "move"|"swap"|"none",
        "block_id": "<id>",
        "new_day": "<Mon|Tue|Wed|Thu|Fri or null>",
        "new_start": "<HH:MM or null>",
        "new_end": "<HH:MM or null>",
        "reason": "<plain English>"
      }
    }
  ],
  "summary": "<1-2 sentence overall assessment tied to the score breakdown>"
}`;

    const MAX_ATTEMPTS = 2;
    let verifyPlan: any = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let aiResp: Response;
      try {
        aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
          }),
        });
      } catch { break; }

      if (aiResp.status === 429) return json(429, { error: "AI rate limit exceeded." });
      if (aiResp.status === 402) return json(402, { error: "AI credits exhausted." });
      if (!aiResp.ok) { if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 500)); continue; } break; }

      let content = "{}";
      try { const aj = await aiResp.json(); content = aj?.choices?.[0]?.message?.content ?? "{}"; } catch { }
      const parsed = parsePlan(content);
      if (parsed) { verifyPlan = parsed; break; }
      if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 500));
    }

    if (!verifyPlan) {
      return json(200, { quality_score: rubricScore, issues_found: 0, summary: null, applied: 0 });
    }

    // D: ignore any AI-provided score — use the deterministic rubric score.
    const qualityScore = rubricScore;
    const issues: any[] = Array.isArray(verifyPlan.issues_found) ? verifyPlan.issues_found : [];
    const summary = verifyPlan.summary ?? null;

    // Apply safe fixes using collision detection
    const validBlockIds = new Set(blocks.map((b: any) => b.id));
    const dayStart = toMin((school as any).start_time) ?? 8 * 60;
    const dayEnd = toMin((school as any).end_time) ?? 15 * 60;

    type EffBlock = { id: string; day: string; start: number; end: number; spec: string | null; teacher: string | null };
    const effective: EffBlock[] = blocks
      .map((b: any) => {
        const s = toMin(b.start_time); const e = toMin(b.end_time);
        return s === null || e === null ? null : { id: b.id, day: b.day_of_week, start: s, end: e, spec: b.specialist_id ?? null, teacher: b.teacher_id ?? null };
      })
      .filter((x): x is EffBlock => x !== null);

    const collides = (day: string, start: number, end: number, spec: string | null, teacher: string | null, ignoreId?: string): boolean => {
      for (const e of effective) {
        if (e.id === ignoreId || e.day !== day) continue;
        if (!(start < e.end && e.start < end)) continue;
        if ((spec && e.spec === spec) || (teacher && e.teacher === teacher)) return true;
      }
      return false;
    };

    // Edit-time constraint context (recess/lunch/PLC/hours), mirroring the
    // generator. Overlap is already enforced by `collides`, so we use the
    // shared validator only for the block-intrinsic + grade-lock rules.
    const constraintCtx = buildConstraintContext(school, recessRes.data ?? [], blocks);
    const blockById: Record<string, any> = Object.fromEntries(blocks.map((b: any) => [b.id, b]));
    const ruleViolations = (day: string | null, startTime?: string | null, endTime?: string | null, grade?: string | null, week?: string | null): string[] => {
      if (!day || !startTime || !endTime) return [];
      return constraintViolations(
        { day_of_week: day, start_time: startTime, end_time: endTime, grade: grade ?? null, week_label: week ?? null },
        [],
        constraintCtx,
      );
    };

    let applied = 0;
    for (const issue of issues) {
      const fix = issue.fix;
      if (!fix || fix.action === "none") continue;
      if (!fix.block_id || !validBlockIds.has(fix.block_id)) continue;

      const cur = effective.find(e => e.id === fix.block_id);
      if (!cur) continue;

      const newDay = fix.new_day ?? cur.day;
      const newStart = fix.new_start ? toMin(fix.new_start) : cur.start;
      const newEnd = fix.new_end ? toMin(fix.new_end) : cur.end;
      if (newStart === null || newEnd === null || newEnd <= newStart) continue;
      if (newStart < dayStart || newEnd > dayEnd) continue;
      if (collides(newDay, newStart, newEnd, cur.spec, cur.teacher, fix.block_id)) continue;

      // Recess/lunch/PLC/hours: skip fixes that would violate the same rules
      // the generator enforces (the model is told them but isn't trusted to obey).
      const origV = blockById[fix.block_id];
      const vio = ruleViolations(
        newDay,
        fix.new_start ?? origV?.start_time,
        fix.new_end ?? origV?.end_time,
        origV?.grade ?? null,
        origV?.week_label ?? null,
      );
      if (vio.length) continue;

      const patch: Record<string, any> = { is_override: false };
      if (fix.new_day) patch.day_of_week = fix.new_day;
      if (fix.new_start) patch.start_time = fix.new_start.includes(":") ? `${fix.new_start}:00` : fix.new_start;
      if (fix.new_end) patch.end_time = fix.new_end.includes(":") ? `${fix.new_end}:00` : fix.new_end;
      const reason = typeof fix.reason === "string" ? fix.reason.slice(0, 500) : null;
      if (reason) patch.placement_reason = reason;

      const { error } = await supabase.from("schedule_blocks").update(patch).eq("id", fix.block_id);
      if (error) continue;

      // Update effective view
      cur.day = newDay; cur.start = newStart; cur.end = newEnd;
      applied++;
    }

    // Persist verification metadata
    await supabase.from("schedule_generations").update({
      verify_quality_score: qualityScore,
      verify_issues_found: issues.length,
      verify_summary: summary,
    }).eq("id", body.generation_id);

    return json(200, {
      quality_score: qualityScore,
      issues_found: issues.length,
      issues_applied: applied,
      summary,
    });
  } catch (e: any) {
    return json(500, { error: e?.message ?? "Unknown error" });
  }
});
