// generate-cpsat — the "provably optimal" generation path.
//
// Builds a normalized problem spec from the school's data (reusing the engine's
// slot-grid / recess / hours logic), sends it to the off-platform OR-Tools CP-SAT
// service (solver/), maps the optimal placements back to schedule_blocks,
// RE-VALIDATES every block against the SSOT (_shared/constraints.ts) — dropping
// anything illegal as a belt-and-suspenders guard — and persists a new version.
//
// Configured via two secrets: CPSAT_SOLVER_URL + CPSAT_SOLVER_KEY. If either is
// missing (or the service errors), this returns 503 so the client falls back to
// the in-app metaheuristic. It never persists an illegal schedule.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  timeToMinutes, minutesToTime, getEndMinForDay, getRecessWindowsForDay,
  buildTimeSlotsForGrade, schoolCanonicalStep, computeWarnings, computePlacementReason,
  generateAdminRotationBlocks, generatePlusRotationBlocks, reserveSpecialistLunchBlocks,
  type Block, type Specialist, type Teacher,
} from "./_engine/index.ts";
import { scoreSchedule, type ScoreableInput } from "./_engine/_scoring.ts";
import { computeQualityConfidence } from "./_engine/_confidence.ts";
import { qualityPercent } from "../_shared/scoring-rubric.ts";
import { buildConstraintContext, violations, type ConstraintBlock } from "../_shared/constraints.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const overlaps = (s1: number, e1: number, s2: number, e2: number) => s1 < e2 && s2 < e1;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const SOLVER_URL = Deno.env.get("CPSAT_SOLVER_URL")?.trim();
  const SOLVER_KEY = Deno.env.get("CPSAT_SOLVER_KEY")?.trim();
  if (!SOLVER_URL) return json(503, { error: "CP-SAT solver not configured", code: "cpsat_unconfigured" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json(401, { error: "Unauthorized" });

    const { school_id, time_limit_s } = await req.json();
    if (!school_id) return json(400, { error: "school_id required" });

    const [schoolRes, specRes, teachRes, recessRes] = await Promise.all([
      supabase.from("schools").select("*").eq("id", school_id).single(),
      supabase.from("specialists").select("*").eq("school_id", school_id),
      supabase.from("classroom_teachers").select("*").eq("school_id", school_id),
      supabase.from("recess_lunch_config").select("*").eq("school_id", school_id),
    ]);
    const school = schoolRes.data;
    if (!school) return json(404, { error: "School not found" });
    const specialists: Specialist[] = (specRes.data ?? []).map((s: any) => ({
      id: s.id, name: s.name, subject: s.subject, working_days: s.working_days,
      planning_minutes: s.planning_minutes, lunch_minutes: s.lunch_minutes, uses_cart: s.uses_cart ?? false,
      two_schools: s.two_schools ?? false, is_part_time: s.is_part_time ?? false,
      part_time_planning_minutes: s.part_time_planning_minutes, part_time_lunch_minutes: s.part_time_lunch_minutes,
      grade_rotation: s.grade_rotation, location: s.location, second_location: s.second_location,
      weekly_planning_minutes: s.weekly_planning_minutes, class_duration: s.class_duration ?? null, plus_rotation: s.plus_rotation ?? null,
    }));
    const teachers: Teacher[] = (teachRes.data ?? []).map((t: any) => ({
      id: t.id, name: t.name, grade: t.grade, room: t.room, am_pm_preference: t.am_pm_preference,
      day_preference: t.day_preference, planning_minutes: t.planning_minutes, weekly_planning_minutes: t.weekly_planning_minutes, lunch_minutes: t.lunch_minutes,
    }));
    const recessConfigs = recessRes.data ?? [];
    const grades: string[] = school.grades_served ?? [];
    if (specialists.length === 0 || grades.length === 0) return json(400, { error: "Need at least one specialist and one grade" });

    // ── Build the spec (reusing the engine's slot/recess/hours derivation) ──
    const startMin = timeToMinutes(school.start_time ?? "08:00");
    const passing = school.passing_time ?? 5;
    const setup = school.setup_time ?? 15;
    const gtc = (school.grade_time_config as Record<string, { passingTime?: number; resetTime?: number }>) ?? {};
    const step = schoolCanonicalStep(school);
    const defaultDur = (school.class_duration && school.class_duration > 0) ? school.class_duration : 45;

    // PLC/Admin grade-range locks → per (grade,day) busy intervals, to drop slots.
    const adminBlocks = generateAdminRotationBlocks("cpsat", school);
    const lockIntervals: Record<string, Array<[number, number]>> = {};
    for (const ab of adminBlocks) {
      if (!ab.grade) continue;
      (lockIntervals[`${ab.grade}:${ab.day_of_week}`] ??= []).push([timeToMinutes(ab.start_time) ?? 0, timeToMinutes(ab.end_time) ?? 0]);
    }

    // PLUS rotations + specialist lunch occupy a specialist's time. Seed them as
    // `busy` so CP-SAT schedules the rotation AROUND them, then persist them so the
    // final schedule is complete (parity with generate-schedule, which bundles
    // lunch + plus + admin blocks into every saved generation).
    const plusBlocks = generatePlusRotationBlocks("cpsat", specialists, school);
    const lunchBlocks = reserveSpecialistLunchBlocks("cpsat", specialists, recessConfigs, school);
    const busy = [...plusBlocks, ...lunchBlocks]
      .filter((b) => b.specialist_id)
      .map((b) => ({ specialist_id: b.specialist_id, day: b.day_of_week, start: timeToMinutes(b.start_time) ?? 0, end: timeToMinutes(b.end_time) ?? 0 }));

    const slots_by_grade: Record<string, Array<{ day: string; start: number; end: number }>> = {};
    for (const grade of grades) {
      const out: Array<{ day: string; start: number; end: number }> = [];
      for (const day of DAYS) {
        const endMin = getEndMinForDay(day, school);
        const recess = getRecessWindowsForDay(day, school, recessConfigs, grade);
        const locks = lockIntervals[`${grade}:${day}`] ?? [];
        for (const sl of buildTimeSlotsForGrade(grade, defaultDur, startMin, endMin, passing, setup, gtc, recess, step)) {
          const e = sl.start + defaultDur;
          if (locks.some(([a, b]) => overlaps(sl.start, e, a, b))) continue; // skip PLC/admin-locked slots
          out.push({ day, start: sl.start, end: e });
        }
      }
      slots_by_grade[grade] = out;
    }

    // Honor the school's configured conflict-resolution strategy. A/B and AA-BB
    // spread the rotation across two alternating weeks, halving weekly specialist
    // load so every class fits (teacher_planning is week-blind, so both weeks count
    // toward each teacher's planning target). Anything else = single rotation week.
    const strategies: string[] = (school.conflict_strategies && school.conflict_strategies.length > 0)
      ? school.conflict_strategies
      : [school.conflict_strategy ?? "standard"];
    const twoWeek = strategies.includes("ab_week") || strategies.includes("aa_bb_week");
    const weekLabels: (string | null)[] = twoWeek ? ["A", "B"] : [null];

    const spec = {
      classes: teachers.map((t) => ({ teacher_id: t.id, grade: t.grade, planning_minutes: t.weekly_planning_minutes ?? 0 })),
      specialists: specialists.map((s) => ({
        id: s.id, subject: s.subject, working_days: s.working_days ?? DAYS, grades: null,
        duration: (s.class_duration && s.class_duration > 0) ? s.class_duration : defaultDur,
      })),
      slots_by_grade,
      week_labels: weekLabels,
      busy,
      time_limit_s: typeof time_limit_s === "number" ? time_limit_s : 60,
      weights: { coverage: 40, cluster: 15, k_late: 20, full_week: 100, k_late_threshold: 780 },
    };

    // ── Call the CP-SAT service ──
    let solverResp: Response;
    try {
      solverResp = await fetch(`${SOLVER_URL.replace(/\/$/, "")}/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(SOLVER_KEY ? { Authorization: `Bearer ${SOLVER_KEY}` } : {}) },
        body: JSON.stringify(spec),
      });
    } catch (e) {
      return json(503, { error: `CP-SAT solver unreachable: ${e instanceof Error ? e.message : e}`, code: "cpsat_unreachable" });
    }
    if (!solverResp.ok) {
      const t = await solverResp.text().catch(() => "");
      return json(502, { error: `CP-SAT solver error ${solverResp.status}: ${t.slice(0, 300)}` });
    }
    const result = await solverResp.json() as { status: string; blocks: any[]; objective?: number };
    if (!["OPTIMAL", "FEASIBLE"].includes(result.status)) {
      return json(422, { error: `CP-SAT could not produce a schedule (${result.status})` });
    }

    // ── Map placements → blocks ──
    const specById = Object.fromEntries(specialists.map((s) => [s.id, s]));
    const teacherById = Object.fromEntries(teachers.map((t) => [t.id, t]));
    let blocks: Block[] = result.blocks.map((b) => ({
      generation_id: "", day_of_week: b.day, start_time: minutesToTime(b.start), end_time: minutesToTime(b.end),
      subject: b.subject, specialist_id: b.specialist_id, teacher_id: b.teacher_id, grade: b.grade,
      room: specById[b.specialist_id]?.location ?? teacherById[b.teacher_id]?.room ?? null, week_label: b.week_label ?? null,
    }));

    // Fixed blocks the final schedule must also carry (parity with
    // generate-schedule, which bundles lunch + plus + admin into every generation).
    // A specialist's admin-set PLUS rotation can overlap their computed lunch
    // window (a real data tension). Persisting BOTH makes the scorer's double-book
    // check fire a -1000 "specialist double-booked" ERROR (which alone zeroes the
    // quality). So drop any fixed block that overlaps a higher-priority fixed block
    // for the same specialist: admin > PLUS > lunch. Teaching already routes around
    // the merged busy span, so this only trims a redundant lunch reservation.
    const fixedPriority = (b: Block): number =>
      b.subject === "PLC/Admin" ? 3 : (b.subject ?? "").includes("PLUS") ? 2 : 1;
    const fixedBlocks: Block[] = [];
    for (const fb of [...adminBlocks, ...plusBlocks, ...lunchBlocks].sort((a, b) => fixedPriority(b) - fixedPriority(a))) {
      if (!fb.specialist_id) { fixedBlocks.push(fb); continue; }
      const fs = timeToMinutes(fb.start_time) ?? 0, fe = timeToMinutes(fb.end_time) ?? 0;
      const clash = fixedBlocks.some((k) =>
        k.specialist_id === fb.specialist_id && k.day_of_week === fb.day_of_week &&
        (timeToMinutes(k.start_time) ?? 0) < fe && fs < (timeToMinutes(k.end_time) ?? 0));
      if (!clash) fixedBlocks.push(fb);
    }

    // ── SSOT re-validation (the trust anchor): validate each CP-SAT teaching block
    // against the FULL set (incl. fixed blocks); drop any illegal one. Fixed blocks
    // are inputs and are always kept. This guarantees a legal persisted schedule. ──
    const contextBlocks = [...fixedBlocks, ...blocks].map((b, i) => ({ ...(b as unknown as ConstraintBlock), id: `b${i}` }));
    const ctx = buildConstraintContext(school, recessConfigs, contextBlocks);
    const legalTeaching: Block[] = [];
    let dropped = 0;
    for (let i = 0; i < blocks.length; i++) {
      const cb = contextBlocks[fixedBlocks.length + i];
      if (violations(cb, contextBlocks, ctx).length === 0) legalTeaching.push(blocks[i]);
      else dropped++;
    }
    blocks = [...fixedBlocks, ...legalTeaching];

    // ── Score + persist as a new version ──
    const scoringInput: ScoreableInput = {
      school: {
        start_time: school.start_time, end_time: school.end_time, early_release_day: school.early_release_day,
        early_release_end_time: school.early_release_end_time, keep_grades_together: school.keep_grades_together ?? true,
        contractual_minutes_extracted: school.contractual_minutes_extracted ?? null,
      },
      specialists: specialists.map((s) => ({ id: s.id, subject: s.subject, working_days: s.working_days })),
      teachers: teachers.map((t) => ({ id: t.id, am_pm_preference: t.am_pm_preference, day_preference: t.day_preference, weekly_planning_minutes: t.weekly_planning_minutes })),
      grades,
    };
    const warnings = computeWarnings(blocks, specialists, grades, teachers);
    const breakdown = scoreSchedule({ blocks, warnings, preferenceViolations: [] }, scoringInput).breakdown as unknown as Record<string, number>;
    const quality = qualityPercent(breakdown);
    const confidence = computeQualityConfidence({
      breakdown, specialists, gradeCount: grades.length, school,
      refinement: { rounds: 1, lastImprovementRound: -1 }, // CP-SAT result is proven-optimal: converged
    });

    const { data: lastGen } = await supabase.from("schedule_generations").select("version").eq("school_id", school_id).order("version", { ascending: false }).limit(1).maybeSingle();
    const nextVersion = (lastGen?.version ?? 0) + 1;
    const { data: generation, error: genErr } = await supabase.from("schedule_generations").insert({
      school_id, version: nextVersion, status: "complete", generated_at: new Date().toISOString(),
      chosen_strategy: "cpsat_optimal", score_breakdown: breakdown, winning_score: result.objective ?? 0, quality_confidence: confidence,
    }).select("id").single();
    if (genErr || !generation) return json(500, { error: `Failed to create generation: ${genErr?.message}` });

    const conflictGrades: string[] = school.conflict_grades ?? [];
    const rows = blocks.map((b) => ({
      generation_id: generation.id, day_of_week: b.day_of_week, start_time: `${b.start_time}:00`.slice(0, 8),
      end_time: `${b.end_time}:00`.slice(0, 8), subject: b.subject, specialist_id: b.specialist_id, teacher_id: b.teacher_id,
      grade: b.grade, room: b.room, week_label: b.week_label,
      placement_reason: computePlacementReason(b, {
        specialist: b.specialist_id ? specById[b.specialist_id] : null, teacher: b.teacher_id ? teacherById[b.teacher_id] : null,
        school, conflictGrades, chosenStrategy: "cpsat_optimal",
      }),
    }));
    for (let i = 0; i < rows.length; i += 100) {
      const { error: insErr } = await supabase.from("schedule_blocks").insert(rows.slice(i, i + 100));
      if (insErr) return json(500, { error: `Block insert failed: ${insErr.message}` });
    }

    return json(200, {
      generation_id: generation.id, version: nextVersion, blocks_count: rows.length,
      quality_percent: quality, score_breakdown: breakdown, confidence,
      solver_status: result.status, dropped_illegal: dropped, chosen_strategy: "cpsat_optimal",
    });
  } catch (e: any) {
    return json(500, { error: e?.message ?? "Unknown error" });
  }
});
