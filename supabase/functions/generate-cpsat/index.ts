// generate-cpsat — the "provably optimal" generation path, now the PRIMARY
// generator for every school (all seven conflict strategies).
//
// Flow: load the school's data → buildCpsatSpec (pure) normalizes it into the full
// problem the OR-Tools CP-SAT service solves (per-duration slot grids, A/B & AA/BB
// two-week timelines, Big-Group taught-together group_ids, extra-rotation session
// budget, the FULL rubric with the school's learned weights) → solve → map the
// optimal placements back to schedule_blocks → append the makeup / lunch-club /
// event-planning post-passes the school's strategies ask for (parity with
// generate-schedule, so those schools stop losing blocks) → RE-VALIDATE every
// teaching block against the SSOT (_shared/constraints.ts) → persist a new version.
//
// Fallback contract: EVERY non-success path returns a typed 4xx/5xx with a
// machine-readable `code` so the client can decide whether to fall back to the
// in-app metaheuristic. Nothing silently degrades. Configured via two secrets
// (CPSAT_SOLVER_URL + CPSAT_SOLVER_KEY); a missing/unreachable service returns 503.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  minutesToTime, computeWarnings, computePlacementReason,
  timeToMinutes, type Block, type Specialist, type Teacher, type Club,
} from "./_engine/index.ts";
import { scoreSchedule, type ScoreableInput } from "./_engine/_scoring.ts";
import { computeQualityConfidence } from "./_engine/_confidence.ts";
import { qualityPercent } from "../_shared/scoring-rubric.ts";
import { buildConstraintContext, violations, type ConstraintBlock } from "../_shared/constraints.ts";
import { buildCpsatSpec, buildPostPassBlocks } from "./_spec_builder.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
/** Typed failure: a machine-readable `code` so the client can react (and fall back
 *  to the metaheuristic) deterministically. Nothing silently degrades. */
function fail(status: number, code: string, error: string) {
  return json(status, { error, code });
}

function solverUrlLabel(url: string | undefined) {
  if (!url) return { configured: false };
  try {
    const parsed = new URL(url);
    return { configured: true, origin: parsed.origin, host: parsed.host };
  } catch {
    return { configured: true, origin: "invalid-url", host: "invalid-url" };
  }
}

function keySummary(key: string | undefined) {
  if (!key) return { present: false, length: 0 };
  return {
    present: true,
    length: key.length,
    prefix: key.slice(0, 4),
    suffix: key.slice(-4),
  };
}

function previewMessage(value: unknown) {
  return typeof value === "string" ? value.slice(0, 300) : "";
}

/** Free-tier solver hosts (Render free / Cloud Run min-instances=0) spin down when
 *  idle, so the first generation after a quiet period races a ~30–60s cold start.
 *  Poll /health (no auth needed) until the container answers, so we POST the
 *  time-limited /solve to a WARM service and get a real CP-SAT result instead of a
 *  cold-start timeout that falls back to the JS engine. Bounded (~60s) so a solver
 *  that is genuinely down still fails fast into the fallback. */
async function waitForSolverWarm(baseUrl: string): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  let delay = 2_000;
  for (;;) {
    try {
      const r = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(8_000) });
      if (r.ok) return true;
    } catch { /* container still starting — keep polling */ }
    if (Date.now() >= deadline) return false;
    await new Promise((res) => setTimeout(res, delay));
    delay = Math.min(Math.floor(delay * 1.5), 8_000);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Method not allowed");

  const SOLVER_URL = Deno.env.get("CPSAT_SOLVER_URL")?.trim();
  const SOLVER_KEY = Deno.env.get("CPSAT_SOLVER_KEY")?.trim();
  if (!SOLVER_URL) return fail(503, "cpsat_unconfigured", "CP-SAT solver not configured");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return fail(401, "unauthorized", "Unauthorized");
    // Internal service-role calls (the run-generation-job worker) skip the per-user
    // gate. Build a REAL service-role client so RLS is bypassed regardless of the
    // key format (legacy JWT vs. new sb_secret_* keys that PostgREST won't accept
    // as a bearer JWT when only layered on top of an anon client).
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const token = authHeader.slice(7).trim();
    const isInternal = !!serviceKey && token === serviceKey;
    const supabase = isInternal
      ? createClient(Deno.env.get("SUPABASE_URL")!, serviceKey!)
      : createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    if (!isInternal) {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr || !user) return fail(401, "unauthorized", "Unauthorized");
    }

    const { school_id, time_limit_s } = await req.json();
    if (!school_id) return fail(400, "bad_request", "school_id required");

    const [schoolRes, specRes, teachRes, recessRes, clubsRes, weightRes, eventsRes] = await Promise.all([
      supabase.from("schools").select("*").eq("id", school_id).single(),
      supabase.from("specialists").select("*").eq("school_id", school_id),
      supabase.from("classroom_teachers").select("*").eq("school_id", school_id),
      supabase.from("recess_lunch_config").select("*").eq("school_id", school_id),
      supabase.from("clubs").select("*").eq("school_id", school_id),
      supabase.from("scoring_weight_profiles").select("*").eq("school_id", school_id).maybeSingle(),
      // Dated special events (wizard Events step) — their windows block all
      // specialists, same as generate-schedule's occupancy booking.
      supabase.from("special_events").select("*").eq("school_id", school_id),
    ]);
    const school = schoolRes.data;
    if (!school) return fail(404, "school_not_found", "School not found");
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
    const clubs: Club[] = (clubsRes.data ?? []).map((c: any) => ({
      id: c.id, name: c.name, day_of_week: c.day_of_week, grades: c.grades, start_time: c.start_time, end_time: c.end_time,
    }));
    const grades: string[] = school.grades_served ?? [];
    if (specialists.length === 0 || grades.length === 0) return fail(400, "insufficient_inputs", "Need at least one specialist and one grade");

    // Learned weights (same gate as generate-schedule: sample_count >= 5).
    const weightProfile = weightRes.data;
    const learnedWeights = weightProfile && (weightProfile.sample_count ?? 0) >= 5
      ? (weightProfile.weights as Record<string, number>) : null;

    // ── Build the full spec (pure) ──
    const defaultDur = (school.class_duration && school.class_duration > 0) ? school.class_duration : 45;
    const { spec, adminBlocks, plusBlocks, lunchBlocks, meetingBlocks, strategies } = buildCpsatSpec({
      school, specialists, teachers, recessConfigs, grades, learnedWeights,
      specialEvents: eventsRes.data ?? [],
      timeLimitS: typeof time_limit_s === "number" ? time_limit_s : 60,
    });

    // ── Call the CP-SAT service ──
    const solverBase = SOLVER_URL.replace(/\/$/, "");
    // Warm a possibly-cold host first so the solve below runs against a live
    // container (a free-tier cold start would otherwise time the POST out).
    await waitForSolverWarm(solverBase);
    let solverResp: Response;
    try {
      console.info("generate-cpsat solver request", {
        solver: solverUrlLabel(SOLVER_URL),
        solverKey: keySummary(SOLVER_KEY),
      });
      solverResp = await fetch(`${solverBase}/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(SOLVER_KEY ? { Authorization: `Bearer ${SOLVER_KEY}` } : {}) },
        // The solver is a PURE OR-Tools service with no DB access — it must receive
        // the FULL built spec (classes, specialists, slots_by_grade, week_labels…),
        // NOT a bare school_id. Sending {school_id} makes the solver reject the
        // model ("School not found" / "spec must include classes"), which surfaces
        // as a hard MODEL_INVALID failure instead of solving. This is the contract
        // the solver/ service + all its pytest/spec-builder tests rely on.
        body: JSON.stringify(spec),
        // Cap the wait so a wedged solver can't hang the edge function — SOLVER_MAX_TIME_S
        // defaults to 120s, so 135s leaves a margin for the solve + network.
        signal: AbortSignal.timeout(135_000),
      });
    } catch (e) {
      return fail(503, "cpsat_unreachable", `CP-SAT solver unreachable: ${e instanceof Error ? e.message : e}`);
    }
    if (!solverResp.ok) {
      const t = await solverResp.text().catch(() => "");
      console.warn("generate-cpsat solver http error", {
        httpStatus: solverResp.status,
        bodyPreview: t.slice(0, 300),
      });
      if (solverResp.status === 401 || solverResp.status === 403) {
        return fail(502, "cpsat_auth_failed", "CP-SAT solver authorization failed");
      }
      return fail(502, "cpsat_solver_error", `CP-SAT solver error ${solverResp.status}: ${t.slice(0, 300)}`);
    }
    const result = await solverResp.json() as { status: string; message?: string; blocks: any[]; objective?: number; coverage_relaxed?: boolean };
    if (result.status === "MODEL_INVALID") {
      console.warn("generate-cpsat solver model invalid", {
        httpStatus: solverResp.status,
        solverStatus: result.status,
        messagePreview: previewMessage(result.message),
      });
      if (/unauthorized/i.test(result.message ?? "")) {
        return fail(502, "cpsat_auth_failed", "CP-SAT solver authorization failed");
      }
      // A spec-level error (e.g. a specialist duration with no slot grid). This is a
      // real input problem, not a transient failure — surface it, don't silently fall back.
      return fail(422, "cpsat_model_invalid", `CP-SAT rejected the model: ${result.message ?? "invalid spec"}`);
    }
    if (!["OPTIMAL", "FEASIBLE"].includes(result.status)) {
      const code = result.status === "INFEASIBLE" ? "cpsat_infeasible" : "cpsat_no_solution";
      return fail(422, code, `CP-SAT could not produce a schedule (${result.status})`);
    }

    // ── Map placements → teaching blocks ──
    const specById = Object.fromEntries(specialists.map((s) => [s.id, s]));
    const teacherById = Object.fromEntries(teachers.map((t) => [t.id, t]));
    const teachingBlocks: Block[] = result.blocks.map((b) => ({
      generation_id: "", day_of_week: b.day, start_time: minutesToTime(b.start), end_time: minutesToTime(b.end),
      subject: b.subject, specialist_id: b.specialist_id, teacher_id: b.teacher_id, grade: b.grade,
      room: specById[b.specialist_id]?.location ?? teacherById[b.teacher_id]?.room ?? null, week_label: b.week_label ?? null,
    }));

    // ── Post-passes: makeup / lunch clubs / event planning (parity with
    // generate-schedule — appended to the SCORED set BEFORE re-validation so those
    // schools keep their blocks). Pure `buildPostPassBlocks` is shared with tests. ──
    const postPassBlocks = buildPostPassBlocks({
      teachingBlocks, strategies, specialists, school, recessConfigs, clubs, grades, defaultDur, plusBlocks, lunchBlocks,
    });
    // scoredBlocks mirrors generate-schedule's baseBlocks (teaching + post-passes);
    // the admin/PLUS/lunch reservations are persisted but not re-scored.
    const scoredBlocksAll = [...teachingBlocks, ...postPassBlocks];

    // ── Fixed reservations the final schedule also carries. An admin PLUS rotation
    // can overlap a computed lunch window (a real data tension); persisting both
    // would fire a -1000 specialist-double-book error. Drop any fixed block that
    // overlaps a higher-priority one for the same specialist:
    // admin > meeting > PLUS > lunch. ──
    const fixedPriority = (b: Block): number =>
      b.subject === "PLC/Admin" ? 4 : b.subject === "Specialist Meeting" ? 3 : (b.subject ?? "").includes("PLUS") ? 2 : 1;
    const fixedBlocks: Block[] = [];
    for (const fb of [...adminBlocks, ...plusBlocks, ...lunchBlocks, ...meetingBlocks].sort((a, b) => fixedPriority(b) - fixedPriority(a))) {
      if (!fb.specialist_id) { fixedBlocks.push(fb); continue; }
      const fs = timeToMinutes(fb.start_time) ?? 0, fe = timeToMinutes(fb.end_time) ?? 0;
      const clash = fixedBlocks.some((k) =>
        k.specialist_id === fb.specialist_id && k.day_of_week === fb.day_of_week &&
        (timeToMinutes(k.start_time) ?? 0) < fe && fs < (timeToMinutes(k.end_time) ?? 0));
      if (!clash) fixedBlocks.push(fb);
    }

    // ── SSOT re-validation (the trust anchor): validate each CP-SAT teaching block
    // against the FULL set (fixed + post-passes + teaching); drop any illegal one.
    // Fixed and post-pass blocks are inputs and are always kept. ──
    const contextBlocks = [...fixedBlocks, ...scoredBlocksAll].map((b, i) => ({ ...(b as unknown as ConstraintBlock), id: `b${i}` }));
    const ctx = buildConstraintContext(school, recessConfigs, contextBlocks);
    const legalTeaching: Block[] = [];
    let dropped = 0;
    for (let i = 0; i < teachingBlocks.length; i++) {
      const cb = contextBlocks[fixedBlocks.length + i];
      if (violations(cb, contextBlocks, ctx).length === 0) legalTeaching.push(teachingBlocks[i]);
      else dropped++;
    }
    const scoredBlocks = [...legalTeaching, ...postPassBlocks];
    const persistBlocks = [...fixedBlocks, ...scoredBlocks];

    // ── Score the teaching + post-pass set (parity with generate-schedule) ──
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
    const warnings = computeWarnings(scoredBlocks, specialists, grades, teachers);
    const breakdown = scoreSchedule({ blocks: scoredBlocks, warnings, preferenceViolations: [] }, scoringInput).breakdown as unknown as Record<string, number>;
    const quality = qualityPercent(breakdown);
    const confidence = computeQualityConfidence({
      breakdown, specialists, gradeCount: grades.length, school,
      refinement: { rounds: 1, lastImprovementRound: -1 }, // proven-optimal ⇒ converged
    });

    // ── Persist as a new version (retry on a UNIQUE(school_id,version) race) ──
    const conflictGrades: string[] = school.conflict_grades ?? [];
    const winningScore = result.objective ?? 0;
    let generation: { id: string } | null = null;
    let nextVersion = 0;
    for (let attempt = 0; attempt < 5 && !generation; attempt++) {
      const { data: lastGen } = await supabase.from("schedule_generations").select("version").eq("school_id", school_id).order("version", { ascending: false }).limit(1).maybeSingle();
      nextVersion = (lastGen?.version ?? 0) + 1;
      const { data, error: genErr } = await supabase.from("schedule_generations").insert({
        school_id, version: nextVersion, status: "complete", generated_at: new Date().toISOString(),
        chosen_strategy: "cpsat_optimal", score_breakdown: breakdown, winning_score: winningScore, quality_confidence: confidence,
      }).select("id").single();
      if (data) { generation = data; break; }
      if (genErr && !isUniqueViolation(genErr)) return fail(500, "generation_insert_failed", `Failed to create generation: ${genErr.message}`);
      // else: version race — re-read max version and retry.
    }
    if (!generation) return fail(409, "version_conflict", "Could not allocate a schedule version after retries");

    const rows = persistBlocks.map((b) => ({
      generation_id: generation!.id, day_of_week: b.day_of_week, start_time: `${b.start_time}:00`.slice(0, 8),
      end_time: `${b.end_time}:00`.slice(0, 8), subject: b.subject, specialist_id: b.specialist_id, teacher_id: b.teacher_id,
      grade: b.grade, room: b.room, week_label: b.week_label,
      placement_reason: computePlacementReason(b, {
        specialist: b.specialist_id ? specById[b.specialist_id] : null, teacher: b.teacher_id ? teacherById[b.teacher_id] : null,
        school, conflictGrades, chosenStrategy: "cpsat_optimal",
      }),
    }));
    for (let i = 0; i < rows.length; i += 100) {
      const { error: insErr } = await supabase.from("schedule_blocks").insert(rows.slice(i, i + 100));
      if (insErr) return fail(500, "block_insert_failed", `Block insert failed: ${insErr.message}`);
    }

    return json(200, {
      generation_id: generation.id, version: nextVersion, blocks_count: rows.length,
      quality_percent: quality, score_breakdown: breakdown, confidence,
      solver_status: result.status, coverage_relaxed: result.coverage_relaxed ?? false,
      dropped_illegal: dropped, chosen_strategy: "cpsat_optimal", strategies,
    });
  } catch (e: any) {
    return fail(500, "internal_error", e?.message ?? "Unknown error");
  }
});

/** Postgres unique-violation (SQLSTATE 23505) — used to retry the version race. */
function isUniqueViolation(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "23505" || /duplicate key|unique constraint/i.test(err.message ?? "");
}
