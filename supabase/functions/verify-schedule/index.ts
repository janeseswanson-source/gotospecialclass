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

    const prompt = `You are a K-6 elementary specials scheduling expert. Review this schedule for quality issues.

SCHEDULE SUMMARY (grade → day → sessions):
${summaryLines.join("\n\n")}

SCORE BREAKDOWN:
${breakdownLines || "  (none)"}

EXISTING WARNINGS:
${warningLines || "  (none)"}

QUALITY CRITERIA TO CHECK:
1. Every grade receives at least one session per week from each configured specialist (subject variety).
2. No grade sees the same specialist more than twice in a week (unless it's the only specialist).
3. Sessions are spread across the week — not all crammed into Monday/Tuesday.
4. Specialist daily loads are balanced — no specialist has 4+ sessions on one day and 0 on another.
5. Teachers with AM/PM preferences have those preferences honored where possible.
6. K and TK sessions are not scheduled after 1:00 PM (780 minutes from midnight).
7. No back-to-back sessions for a cart specialist (uses_cart=true) in different rooms.

For any issues you find, propose the MINIMUM fix. Only suggest moves/swaps if they won't create new conflicts.
Block IDs to reference: ${blocks.filter((b: any) => b.specialist_id).slice(0, 50).map((b: any) => b.id).join(", ")}

Respond ONLY with valid JSON:
{
  "quality_score": <0-100 integer>,
  "issues_found": [
    {
      "type": "subject_gap"|"day_clustering"|"load_imbalance"|"preference_violation"|"k_late"|"cart_conflict",
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
  "summary": "<1-2 sentence overall assessment>"
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
      return json(200, { quality_score: null, issues_found: 0, summary: null, applied: 0 });
    }

    const qualityScore = typeof verifyPlan.quality_score === "number" ? verifyPlan.quality_score : null;
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
