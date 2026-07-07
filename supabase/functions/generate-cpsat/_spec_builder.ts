// buildCpsatSpec — the PURE (no I/O) normalizer that turns a school's loaded data
// into the exact problem spec the OR-Tools CP-SAT solver (solver/solver.py) consumes.
//
// It reuses the canonical engine's battle-tested derivations (per-grade slot grid,
// recess/hours/early-release awareness, PLC/Admin locks, specialist working days,
// grade rotation, PLUS/lunch reservations) so CP-SAT sees exactly what the
// metaheuristic sees — but PER DURATION (quick-30 mixed classes), with the school's
// conflict strategy honored (A/B, AA/BB, big-group taught-together group_ids,
// extra-rotation session budget) and the FULL rubric with the school's learned
// weights driving the objective.
//
// Extracted from index.ts so it is unit-testable without a database or the solver
// service (see _spec_builder_test.ts).

import {
  DAYS, timeToMinutes, getEndMinForDay, getRecessWindowsForDay, buildTimeSlotsForGrade,
  schoolCanonicalStep, specClassDuration, canSpecialistTeachGradeOnDay, OccupancyTracker,
  generateAdminRotationBlocks, generatePlusRotationBlocks, reserveSpecialistLunchBlocks,
  reserveSpecialistMeetingBlocks, addMakeupBlocks, generateLunchClubBlocks, generateEventPlanningBlocks,
  type Block, type Specialist, type Teacher, type Club,
} from "./_engine/index.ts";
import { DEFAULT_WEIGHTS, type ScoreBreakdown } from "./_engine/_scoring.ts";
import { clampToDefault } from "./_engine/_weightlearning.ts";

const DAY_FULL_TO_SHORT: Record<string, string> = {
  Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri",
};
const toShortDay = (d?: string | null): string | null => (d ? (DAY_FULL_TO_SHORT[d] ?? d) : null);
const shortDays = (days?: string[] | null): string[] =>
  (days ?? DAYS).map((d) => DAY_FULL_TO_SHORT[d] ?? d);
const overlaps = (s1: number, e1: number, s2: number, e2: number) => s1 < e2 && s2 < e1;

export interface SolverSlot { day: string; start: number; end: number }
export interface SolverClass {
  teacher_id: string; grade: string; planning_minutes: number;
  am_pm_preference?: string; day_preference?: string;
}
export interface SolverSpecialist {
  id: string; subject: string; working_days: string[]; grades: string[] | null; duration: number;
  grade_rotation?: Record<string, string[]>; uses_cart: boolean;
  planning_free_budget: number; required_planning_minutes: number;
}
export interface SolverFixed {
  teacher_id: string; specialist_id: string; grade: string;
  day: string; start: number; end: number; week_label: string | null; group_id: string;
}
export interface CpsatSpec {
  classes: SolverClass[];
  specialists: SolverSpecialist[];
  slots_by_grade_duration: Record<string, Record<number, SolverSlot[]>>;
  week_labels: (string | null)[];
  busy: Array<{ specialist_id: string; day: string; start: number; end: number }>;
  fixed: SolverFixed[];
  contract_subjects: Array<{ grade: string; subject: string; weekly_minutes: number }>;
  sessions_per_pair: number;
  min_sessions_per_pair: number;
  keep_grades_together: boolean;
  /** quick_30: {grade: minutes} — these grades' sessions run at this duration
   *  regardless of the specialist's own class length (solver pair_duration). */
  grade_duration_overrides?: Record<string, number>;
  weights: Record<string, number>;
  time_limit_s: number;
}

export interface BuildSpecResult {
  spec: CpsatSpec;
  adminBlocks: Block[];
  plusBlocks: Block[];
  lunchBlocks: Block[];
  /** Weekly all-specialists meeting reservations (schools.specialist_meeting). */
  meetingBlocks: Block[];
  strategies: string[];
}

export interface BuildSpecArgs {
  school: any;
  specialists: Specialist[];
  teachers: Teacher[];
  recessConfigs: any[];
  grades: string[];
  /** Dated special events (assemblies, photos…) from the wizard's Events step.
   *  Their time windows block ALL specialists on that weekday — parity with
   *  generate-schedule's occupancy booking. (parsed_calendar_events are
   *  validation-only holidays in BOTH engines and are deliberately not here.) */
  specialEvents?: any[];
  /** Learned weights (scoring_weight_profiles.weights) when sample_count >= 5. */
  learnedWeights?: Record<string, number> | null;
  timeLimitS?: number;
}

/** Day-of-week busy windows for every specialist from dated special events —
 *  mirrors generate-schedule's getBlockedDayTimeRanges + occupancy.book loop. */
export function specialEventBusy(
  specialEvents: any[] | null | undefined,
  specialists: Specialist[],
): Array<{ specialist_id: string; day: string; start: number; end: number }> {
  const busy: Array<{ specialist_id: string; day: string; start: number; end: number }> = [];
  const dayMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const ev of specialEvents ?? []) {
    if (!ev?.start_time || !ev?.end_time || !ev?.event_date) continue;
    const day = dayMap[new Date(ev.event_date + "T00:00:00").getDay()];
    if (!day || !DAYS.includes(day)) continue;
    const start = timeToMinutes(ev.start_time) ?? 0;
    const end = timeToMinutes(ev.end_time) ?? 0;
    if (end <= start) continue;
    for (const s of specialists) busy.push({ specialist_id: s.id, day, start, end });
  }
  return busy;
}

/** Resolve the school's active conflict strategies (multi first, else single). */
export function resolveStrategies(school: any): string[] {
  return (Array.isArray(school.conflict_strategies) && school.conflict_strategies.length > 0)
    ? school.conflict_strategies
    : [school.conflict_strategy ?? "standard"];
}

/** Merge DEFAULT_WEIGHTS with the school's learned weights, each clamped to ±50%
 *  of its default (defense in depth — the learner also clamps on write). Keyed by
 *  the rubric ScoreBreakdown keys the solver reads (it takes magnitudes). */
export function mergeWeights(learnedWeights?: Record<string, number> | null): Record<string, number> {
  const merged: Record<string, number> = { ...DEFAULT_WEIGHTS };
  if (learnedWeights) {
    for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof ScoreBreakdown)[]) {
      const v = learnedWeights[k];
      if (typeof v === "number" && Number.isFinite(v)) merged[k] = clampToDefault(k, v);
    }
  }
  return { ...merged, k_late_threshold: 780 };
}

export interface PostPassArgs {
  teachingBlocks: Block[];
  strategies: string[];
  specialists: Specialist[];
  school: any;
  recessConfigs: any[];
  clubs: Club[];
  grades: string[];
  defaultDur: number;
  plusBlocks: Block[];
  lunchBlocks: Block[];
}

/** The makeup / lunch-club / event-planning blocks generate-cpsat appends AFTER the
 *  solve, using the SAME engine generators generate-schedule uses, gated on the same
 *  strategy flags — so those schools keep their blocks (parity). Pure, so the serve
 *  handler and tests share one implementation. */
export function buildPostPassBlocks(a: PostPassArgs): Block[] {
  const out: Block[] = [];
  if (a.strategies.includes("makeup")) {
    out.push(...addMakeupBlocks("", a.specialists, [...a.teachingBlocks, ...a.plusBlocks, ...a.lunchBlocks], a.school, a.recessConfigs, a.defaultDur, a.grades));
  }
  if (a.strategies.includes("lunch_clubs")) {
    out.push(...generateLunchClubBlocks("", a.specialists, a.school, a.recessConfigs, a.clubs));
  }
  if (a.strategies.includes("event_planning")) {
    out.push(...generateEventPlanningBlocks("", a.specialists, [...a.teachingBlocks, ...a.plusBlocks, ...a.lunchBlocks, ...out], a.school, a.recessConfigs, a.defaultDur));
  }
  return out;
}

export function buildCpsatSpec(args: BuildSpecArgs): BuildSpecResult {
  const { school, specialists, teachers, recessConfigs, grades } = args;
  const startMin = timeToMinutes(school.start_time ?? "08:00");
  const passing = school.passing_time ?? 5;
  const setup = school.setup_time ?? 15;
  const gtc = (school.grade_time_config as Record<string, { passingTime?: number; resetTime?: number }>) ?? {};
  const step = schoolCanonicalStep(school);
  const defaultDur = (school.class_duration && school.class_duration > 0) ? school.class_duration : 45;

  // Fixed blocks that occupy specialist/grade time (parity with generate-schedule,
  // which bundles admin + PLUS + lunch + meeting into every saved generation).
  const adminBlocks = generateAdminRotationBlocks("cpsat", school);
  const plusBlocks = generatePlusRotationBlocks("cpsat", specialists, school);
  const lunchBlocks = reserveSpecialistLunchBlocks("cpsat", specialists, recessConfigs, school);
  const meetingBlocks = reserveSpecialistMeetingBlocks("cpsat", specialists, school);
  // Meeting outranks PLUS/lunch: drop a lower-priority reserved block that
  // overlaps it (parity with generate-schedule's occupancy dedup).
  if (meetingBlocks.length > 0) {
    const overlapsMeeting = (b: Block) =>
      meetingBlocks.some((m) =>
        m.specialist_id === b.specialist_id && m.day_of_week === b.day_of_week &&
        (timeToMinutes(b.start_time) ?? 0) < (timeToMinutes(m.end_time) ?? 0) &&
        (timeToMinutes(m.start_time) ?? 0) < (timeToMinutes(b.end_time) ?? 0));
    for (let i = plusBlocks.length - 1; i >= 0; i--) if (overlapsMeeting(plusBlocks[i])) plusBlocks.splice(i, 1);
    for (let i = lunchBlocks.length - 1; i >= 0; i--) if (overlapsMeeting(lunchBlocks[i])) lunchBlocks.splice(i, 1);
  }

  // PLC/Admin grade-range locks → per (grade,day) intervals to drop covered slots.
  const lockIntervals: Record<string, Array<[number, number]>> = {};
  for (const ab of adminBlocks) {
    if (!ab.grade) continue;
    (lockIntervals[`${ab.grade}:${ab.day_of_week}`] ??= []).push([timeToMinutes(ab.start_time) ?? 0, timeToMinutes(ab.end_time) ?? 0]);
  }

  // PLUS + specialist lunch + weekly meeting → `busy` so CP-SAT schedules the
  // rotation around them. Special events (assemblies, photos…) block EVERY
  // specialist for their window — parity with generate-schedule's occupancy.
  const busy = [
    ...[...plusBlocks, ...lunchBlocks, ...meetingBlocks]
      .filter((b) => b.specialist_id)
      .map((b) => ({ specialist_id: b.specialist_id as string, day: b.day_of_week, start: timeToMinutes(b.start_time) ?? 0, end: timeToMinutes(b.end_time) ?? 0 })),
    ...specialEventBusy(args.specialEvents, specialists),
  ];

  const strategies = resolveStrategies(school);

  // quick_30: the SELECTED conflict grades run 30-minute classes (exactly what
  // the wizard promises). Emitted as grade_duration_overrides so the solver
  // sizes those (class, specialist) sessions at 30 regardless of the
  // specialist's own duration; durations composes with week_labels untouched.
  const quick30Grades = strategies.includes("quick_30")
    ? ((school.conflict_grades ?? []) as string[]).filter((g) => grades.includes(g))
    : [];
  const grade_duration_overrides: Record<string, number> = {};
  for (const g of quick30Grades) grade_duration_overrides[g] = 30;

  // Per-duration slot grids: every distinct specialist class length gets its own
  // grid per grade so a 30-min quick-30 specialist and a 45-min specialist can
  // share a grade with NO silent hole (solver errors MODEL_INVALID otherwise).
  const durations = new Set<number>([defaultDur]);
  for (const s of specialists) durations.add(specClassDuration(s, defaultDur));
  if (quick30Grades.length > 0) durations.add(30); // override grades need a 30-min grid

  const slots_by_grade_duration: Record<string, Record<number, SolverSlot[]>> = {};
  for (const grade of grades) {
    slots_by_grade_duration[grade] = {};
    for (const dur of durations) {
      const out: SolverSlot[] = [];
      for (const day of DAYS) {
        const endMin = getEndMinForDay(day, school);
        const recess = getRecessWindowsForDay(day, school, recessConfigs, grade);
        const locks = lockIntervals[`${grade}:${day}`] ?? [];
        for (const sl of buildTimeSlotsForGrade(grade, dur, startMin, endMin, passing, setup, gtc, recess, step)) {
          const e = sl.start + dur;
          if (locks.some(([a, b]) => overlaps(sl.start, e, a, b))) continue;
          out.push({ day, start: sl.start, end: e });
        }
      }
      slots_by_grade_duration[grade][dur] = out;
    }
  }

  // A/B and AA/BB spread the rotation across two disjoint timelines. AA/BB uses its
  // own opaque labels; the 2-consecutive-week cadence is a calendar-mapping concern.
  const week_labels: (string | null)[] = strategies.includes("aa_bb_week") ? ["AA", "BB"]
    : strategies.includes("ab_week") ? ["A", "B"]
      : [null];
  // extra_rotation lets a (class, specialist) pair be scheduled twice (spaced across
  // days), with a smaller reward so extras never crowd out first-coverage.
  const sessions_per_pair = strategies.includes("extra_rotation") ? 2 : 1;

  const classes: SolverClass[] = teachers.map((t) => {
    const c: SolverClass = { teacher_id: t.id, grade: t.grade, planning_minutes: t.weekly_planning_minutes ?? 0 };
    if (t.am_pm_preference === "AM" || t.am_pm_preference === "PM") c.am_pm_preference = t.am_pm_preference;
    const dp = toShortDay(t.day_preference);
    if (dp && DAYS.includes(dp)) c.day_preference = dp;
    return c;
  });

  // Per-specialist planning-time budget (for planning_target_met): weekly available
  // minutes minus reserved lunch and PLUS time. Mirrors validatePlanningTime.
  const lunchMinBySpec = new Map<string, number>();
  for (const b of lunchBlocks) if (b.specialist_id) lunchMinBySpec.set(b.specialist_id, (lunchMinBySpec.get(b.specialist_id) ?? 0) + ((timeToMinutes(b.end_time) ?? 0) - (timeToMinutes(b.start_time) ?? 0)));
  const plusMinBySpec = new Map<string, number>();
  for (const b of plusBlocks) if (b.specialist_id) plusMinBySpec.set(b.specialist_id, (plusMinBySpec.get(b.specialist_id) ?? 0) + ((timeToMinutes(b.end_time) ?? 0) - (timeToMinutes(b.start_time) ?? 0)));
  const meetingMinBySpec = new Map<string, number>();
  for (const b of meetingBlocks) if (b.specialist_id) meetingMinBySpec.set(b.specialist_id, (meetingMinBySpec.get(b.specialist_id) ?? 0) + ((timeToMinutes(b.end_time) ?? 0) - (timeToMinutes(b.start_time) ?? 0)));

  const specialistsSpec: SolverSpecialist[] = specialists.map((s) => {
    const dur = specClassDuration(s, defaultDur);
    const workDays = shortDays(s.working_days).filter((d) => DAYS.includes(d));
    let available = 0;
    for (const d of workDays) available += Math.max(0, getEndMinForDay(d, school) - startMin);
    const budget = Math.max(0, available - (lunchMinBySpec.get(s.id) ?? 0) - (plusMinBySpec.get(s.id) ?? 0) - (meetingMinBySpec.get(s.id) ?? 0));
    const workDayCount = workDays.length || DAYS.length;
    const perDayDefault = s.planning_minutes ?? school.planning_minutes ?? 0;
    const requiredPlanning = (s.is_part_time && s.part_time_planning_minutes != null)
      ? s.part_time_planning_minutes
      : (s.weekly_planning_minutes ?? (perDayDefault * workDayCount));
    const out: SolverSpecialist = {
      id: s.id, subject: s.subject, working_days: workDays.length > 0 ? workDays : DAYS, grades: null, duration: dur,
      uses_cart: s.uses_cart ?? false,
      planning_free_budget: budget, required_planning_minutes: Math.max(0, requiredPlanning ?? 0),
    };
    if (s.grade_rotation && typeof s.grade_rotation === "object") {
      const rot: Record<string, string[]> = {};
      for (const [day, gr] of Object.entries(s.grade_rotation)) {
        const sd = DAY_FULL_TO_SHORT[day] ?? day;
        if (Array.isArray(gr)) rot[sd] = gr as string[];
      }
      out.grade_rotation = rot;
    }
    return out;
  });

  const extracted = (school.contractual_minutes_extracted ?? null) as { subjects?: Array<{ grade?: string; subject?: string; weekly_minutes?: number }> } | null;
  const contract_subjects = (extracted?.subjects ?? [])
    .filter((x) => Number(x.weekly_minutes ?? 0) > 0)
    .map((x) => ({ grade: x.grade ?? "", subject: x.subject ?? "", weekly_minutes: Number(x.weekly_minutes) }));

  const fixed = deriveBigGroupFixed({
    school, specialists, teachers, recessConfigs, strategies,
    // Meeting blocks join the pre-seed so a Big-Group session can't land on the
    // weekly meeting window.
    adminBlocks, plusBlocks: [...plusBlocks, ...meetingBlocks], lunchBlocks, defaultDur, startMin, passing, setup, gtc, step,
    weekLabel: week_labels[0],
  });

  const spec: CpsatSpec = {
    classes,
    specialists: specialistsSpec,
    slots_by_grade_duration,
    week_labels,
    busy,
    fixed,
    contract_subjects,
    sessions_per_pair,
    min_sessions_per_pair: 1, // demand full coverage; solver soft-retries on a capacity wall
    keep_grades_together: school.keep_grades_together !== false,
    ...(quick30Grades.length > 0 ? { grade_duration_overrides } : {}),
    weights: mergeWeights(args.learnedWeights),
    time_limit_s: typeof args.timeLimitS === "number" ? args.timeLimitS : 60,
  };
  return { spec, adminBlocks, plusBlocks, lunchBlocks, meetingBlocks, strategies };
}

/** Derive Big-Group "taught-together" fixed sessions from big_group_config, the
 *  same way generate-schedule combines selected teachers of a conflict grade: place
 *  ONE session (specialist + slot) all members attend, occupancy-legal against the
 *  admin/PLUS/lunch pre-seed, and emit one fixed session per member sharing a
 *  group_id. The solver then adds ONE specialist interval for the group and one per
 *  member teacher, and optimizes everything else around it (taught-together sessions
 *  are unmovable by design). No config or fewer than two members → no fixed session. */
function deriveBigGroupFixed(ctx: {
  school: any; specialists: Specialist[]; teachers: Teacher[]; recessConfigs: any[]; strategies: string[];
  adminBlocks: Block[]; plusBlocks: Block[]; lunchBlocks: Block[];
  defaultDur: number; startMin: number; passing: number; setup: number;
  gtc: Record<string, { passingTime?: number; resetTime?: number }>; step: number; weekLabel: string | null;
}): SolverFixed[] {
  if (!ctx.strategies.includes("big_group")) return [];
  const bigGroupConfig = (ctx.school.big_group_config as Array<{ grade: string; teacherIds: string[] }>) ?? [];
  if (bigGroupConfig.length === 0) return [];
  const conflictGrades = new Set<string>(ctx.school.conflict_grades ?? []);

  const occ = new OccupancyTracker();
  for (const ab of ctx.adminBlocks) {
    if (ab.grade) occ.bookGradeRange(ab.day_of_week, ab.grade, timeToMinutes(ab.start_time) ?? 0, timeToMinutes(ab.end_time) ?? 0);
  }
  for (const b of [...ctx.plusBlocks, ...ctx.lunchBlocks]) {
    if (b.specialist_id) occ.book(b.day_of_week, timeToMinutes(b.start_time) ?? 0, timeToMinutes(b.end_time) ?? 0, b.specialist_id, b.teacher_id ?? null);
  }

  const fixed: SolverFixed[] = [];
  for (const entry of bigGroupConfig) {
    const grade = entry.grade;
    if (!grade || !conflictGrades.has(grade)) continue;
    const members = ctx.teachers.filter((t) => t.grade === grade && (entry.teacherIds ?? []).includes(t.id));
    if (members.length < 2) continue; // one class isn't "taught together"

    let placed = false;
    for (const day of DAYS) {
      if (placed) break;
      const endMin = getEndMinForDay(day, ctx.school);
      const recess = getRecessWindowsForDay(day, ctx.school, ctx.recessConfigs, grade);
      for (const spec of ctx.specialists) {
        if (placed) break;
        if (!shortDays(spec.working_days).includes(day)) continue;
        if (!canSpecialistTeachGradeOnDay(spec, grade, day)) continue;
        const dur = specClassDuration(spec, ctx.defaultDur);
        for (const slot of buildTimeSlotsForGrade(grade, dur, ctx.startMin, endMin, ctx.passing, ctx.setup, ctx.gtc, recess, ctx.step)) {
          const end = slot.start + dur;
          if (!occ.isSpecialistFree(day, slot.start, end, spec.id)) continue;
          if (!occ.isGradeRangeFree(day, grade, slot.start, end)) continue;
          if (!members.every((m) => occ.isTeacherFree(day, slot.start, end, m.id))) continue;
          const gid = `bg_${grade}_${spec.id}_${day}_${slot.start}`;
          occ.book(day, slot.start, end, spec.id, null);
          for (const m of members) {
            occ.book(day, slot.start, end, `__grp_${spec.id}`, m.id);
            fixed.push({ teacher_id: m.id, specialist_id: spec.id, grade, day, start: slot.start, end, week_label: ctx.weekLabel, group_id: gid });
          }
          placed = true;
          break;
        }
      }
    }
  }
  return fixed;
}
