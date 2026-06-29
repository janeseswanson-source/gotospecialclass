// ─────────────────────────────────────────────────────────────────────────
// SCHEDULE GENERATION — deterministic solver (the solver owns ALL hard rules;
// Claude only polishes soft quality afterwards in verify-schedule).
//
// Pipeline (per HTTP call):
//   E.  Feasibility precheck — session capacity (per-specialist class_duration
//       aware) vs. demand; emits a soft capacity_shortfall warning, never throws.
//   3A. Deterministic seeding — admin/PLC locks, carried-forward locked blocks,
//       specialist lunch reservations, special events block all specialists.
//   3B. Strategy priority loop — tries conflict_strategies in order
//       (ab_week | aa_bb_week | quick_30 | big_group | extra_rotation | standard;
//       conflict_timing="after" or no conflict grades → standard only). Each
//       strategy is Monte-Carlo restarted; first error-free best wins, else
//       fewest-errors. conflict_grades scopes quick_30/extra_rotation.
//   3C. Simulated annealing — local refinement (swap specialist / swap grade /
//       de-cluster), every move re-scored.
//   4.  Optional post-passes — makeup / lunch_clubs / event_planning.
//   The HTTP handler runs a small best-of-2 internally and persists ONE
//   generation; the CLIENT (src/lib/generateBestSchedule.ts) calls this many
//   times for best-of-N (Edge CPU limit ≈ 2s/call), keeping the best.
//
// HARD constraints live in _shared/constraints.ts (double-booking big-group
// aware, recess/lunch by grade band, PLC locks, school hours/early-release).
// SOFT quality is the weighted scorer in _scoring.ts; quality % = the shared
// rubric in _shared/scoring-rubric.ts. Wizard values consumed: school hours,
// class_duration (+ per-specialist override), passing/setup time, grades,
// working_days, grade_rotation, am_pm/day preferences, specialist + teacher +
// part-time planning minutes, contractual minutes, recess grade bands
// (staggered), admin/PLC rotation, big_group_config, clubs, events, calendar.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { shuffle, deriveSeed, mulberry32, type Rng } from "./_random.ts";
import { scoreSchedule, type ScoreableInput, type ScoreBreakdown } from "./_scoring.ts";
import { qualityPercent } from "../_shared/scoring-rubric.ts";
import { calibrateMonteCarlo, monteCarloRun, MonteCarloBudgetExceededError } from "./_monteCarlo.ts";
import { computeQualityConfidence } from "./_confidence.ts";
import { OccupancyTracker, type Interval } from "./_occupancy.ts";
// Re-export so existing importers (tests, other functions) keep `import {
// OccupancyTracker } from "./index.ts"` working unchanged after the extraction.
export { OccupancyTracker, type Interval };
// SA refinement lives in _annealing.ts (Phase 0). The import cycle (it imports
// leaf helpers back from here) is safe: all cross-references are inside function
// bodies, evaluated at runtime, never at module init. See _annealing.ts header.
import { runSimulatedAnnealing } from "./_annealing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// Schedule upper grades first — older grades have stricter pull-out
// constraints and stricter standards-time requirements, so they should
// claim slots before K-3 (which are more flexible).
const GRADE_PRIORITY = ["6", "5", "4", "3", "2", "1", "K", "TK", "PreK", "Pre-K"];
function prioritizeGrades(grades: string[]): string[] {
  return [...grades].sort((a, b) => {
    const ai = GRADE_PRIORITY.indexOf(a);
    const bi = GRADE_PRIORITY.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

const quotes = [
  { text: "Every child deserves a champion — an adult who will never give up on them.", author: "Rita Pierson" },
  { text: "Teaching is the greatest act of optimism.", author: "Colleen Wilcox" },
  { text: "The art of teaching is the art of assisting discovery.", author: "Mark Van Doren" },
  { text: "Education is not the filling of a pail, but the lighting of a fire.", author: "W.B. Yeats" },
  { text: "A good teacher can inspire hope, ignite the imagination, and instill a love of learning.", author: "Brad Henry" },
  { text: "A great schedule is the invisible foundation of a thriving school.", author: "Specialist Ops!" },
  { text: "When specialists thrive, students flourish.", author: "Specialist Ops!" },
  { text: "Structure gives freedom — a well-built schedule lets creativity soar.", author: "Specialist Ops!" },
  { text: "Your schedule just got a whole lot smarter.", author: "Specialist Ops!" },
  { text: "Great schools don't happen by accident. They're scheduled.", author: "Specialist Ops!" },
  { text: "You just saved hours of scheduling. Go do something amazing.", author: "Specialist Ops!" },
  { text: "Tell me and I forget, teach me and I may remember, involve me and I learn.", author: "Benjamin Franklin" },
  { text: "Education is the most powerful weapon which you can use to change the world.", author: "Nelson Mandela" },
  { text: "Teachers affect eternity; no one can tell where their influence stops.", author: "Henry Adams" },
  { text: "Nine-tenths of education is encouragement.", author: "Anatole France" },
];

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// School-wide canonical slot step. Every generated block snaps its
// START to multiples of this from the school start time, so the Master
// Schedule renders one tidy row per period across all grades and
// specialists instead of dozens of 5-minute-offset rows.
export function schoolCanonicalStep(school: { class_duration?: number | null; passing_time?: number | null }): number {
  const dur = (school?.class_duration && school.class_duration > 0) ? school.class_duration : 45;
  const pass = (school?.passing_time && school.passing_time > 0) ? school.passing_time : 5;
  return dur + pass;
}


// ─── Interfaces ──────────────────────────────────────────────────────

export interface Specialist {
  id: string;
  name: string;
  subject: string;
  working_days: string[] | null;
  planning_minutes: number | null;
  lunch_minutes: number | null;
  uses_cart: boolean | null;
  two_schools: boolean | null;
  is_part_time: boolean | null;
  part_time_planning_minutes: number | null;
  part_time_lunch_minutes: number | null;
  grade_rotation: Record<string, string[]> | null;
  location: string | null;
  second_location: string | null;
  weekly_planning_minutes: number | null;
  class_duration?: number | null;
  /** Per-specialist extra "PLUS" rotation: { Mon: { active, startTime, grades:[{grade,startTime?,durationMinutes?}] }, … } */
  plus_rotation?: Record<string, { active?: boolean; startTime?: string; grades?: Array<{ grade: string; startTime?: string; durationMinutes?: number }> }> | null;
}

export interface Teacher {
  id: string;
  name: string;
  grade: string;
  room: string | null;
  am_pm_preference: string | null;
  day_preference: string | null;
  planning_minutes: number | null;
  weekly_planning_minutes: number | null;
  lunch_minutes: number | null;
}

interface TimeSlot {
  start: number;
  end: number;
}

export interface Block {
  generation_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  subject: string;
  specialist_id: string | null;
  teacher_id: string | null;
  grade: string;
  room: string | null;
  week_label?: string | null;
  // Carried forward on replans (locked blocks) — not set by strategies.
  notes?: string | null;
  is_override?: boolean;
  placement_reason?: string | null;
  ai_explanation?: string | null;
}

interface RecessWindow {
  start: number;
  end: number;
}

interface Club {
  id: string;
  name: string;
  day_of_week: string | null;
  grades: string | null;
  start_time: string | null;
  end_time: string | null;
}

interface BigGroupEntry {
  grade: string;
  teacherIds: string[];
}

const DAY_FULL_TO_SHORT: Record<string, string> = {
  Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri",
};

// ─── Phase 3A: preference violation tracking ─────────────────────────
// Surfaced alongside warnings so the Monte Carlo scorer (3B) can
// compare candidate schedules. AM is defined as slot start < 12:00
// (720 minutes). cart_back_to_back fires when a cart specialist's
// previous booked slot on the same day is in a different room.
export type PreferenceViolation =
  | { kind: "am_pm"; teacherId: string; preferred: "AM" | "PM"; actualSlot: "AM" | "PM" }
  | { kind: "day_preference"; teacherId: string; preferred: string; actualDay: string }
  | { kind: "cart_back_to_back"; specialistId: string; day: string; slot: number };

interface AssignResult {
  blocks: Block[];
  preferenceViolations: PreferenceViolation[];
}

export interface StrategyResult {
  blocks: Block[];
  preferenceViolations: PreferenceViolation[];
}

// ─── Warning + scheduler result types (Prompt 2) ─────────────────────
export interface Warning {
  type: string;
  message: string;
  severity: string;
  suggestion?: string;
}
interface StrategyAttempt {
  strategy: string;
  error_count: number;
  warning_count: number;
}
interface SchedulerResult {
  blocks: Block[];
  chosenStrategy: string;
  attemptedStrategies: StrategyAttempt[];
  fallbackReason: string | null;
  extraWarnings: Warning[];
  preferenceViolations: PreferenceViolation[];
  monteCarloAttempts: number;
  winningScore: number;
  scoreBreakdown: Record<string, number> | null;
  saIterations: number;
  saImprovement: number;
}

/** Prompt-2: a strategy is "failed" iff it produced any error-severity warning. */
export function strategyFailed(warnings: Warning[]): boolean {
  return warnings.some((w) => w.severity === "error");
}

/**
 * Prompt-2: pure warnings computation, mirrors the post-generation
 * checks in the Deno.serve handler. Used to gate strategy fallback.
 * Severity-driven: any future `severity: "error"` warning will gate too.
 */
// Two blocks can only conflict if they run in weeks that actually
// coincide. A null/"all" label means "every week", so it overlaps any
// week; otherwise the labels must match (A vs B never collide).
function weeksCoincide(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = a ?? null;
  const nb = b ?? null;
  if (na === null || nb === null || na === "all" || nb === "all") return true;
  return na === nb;
}

// Detect real time-overlap conflicts for one owner (specialist or class)
// on a single day, honouring week labels. Returns the offending blocks
// grouped so we can emit one warning per overlapping pair-cluster.
function findOverlapClusters(blocks: Block[]): Block[][] {
  const sorted = [...blocks].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
  const clusters: Block[][] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const aStart = timeToMinutes(a.start_time);
      const aEnd = timeToMinutes(a.end_time);
      const bStart = timeToMinutes(b.start_time);
      const bEnd = timeToMinutes(b.end_time);
      if (bStart >= aEnd) break; // sorted — no later block can overlap a
      if (aStart < bEnd && bStart < aEnd && weeksCoincide(a.week_label, b.week_label)) {
        clusters.push([a, b]);
      }
    }
  }
  return clusters;
}

export function computeWarnings(blocks: Block[], specialists: Specialist[], grades: string[], teachers?: Teacher[]): Warning[] {
  const warnings: Warning[] = [];
  // no_coverage
  for (const grade of grades) {
    const gradeBlocks = blocks.filter((b) => b.grade === grade && b.specialist_id);
    if (gradeBlocks.length === 0) {
      warnings.push({
        type: "no_coverage",
        severity: "error",
        message: `Grade ${grade} has no specialist sessions.`,
        suggestion: "Add more specialists or enable A/B Week.",
      });
    }
  }

  // teacher_no_coverage — a grade can look covered while individual classes in
  // it get nothing all week (the failure mode that previously went unnoticed).
  if (teachers && specialists.length > 0) {
    for (const t of teachers) {
      const n = blocks.filter((b) => b.teacher_id === t.id && b.specialist_id).length;
      if (n === 0) {
        warnings.push({
          type: "teacher_no_coverage",
          severity: "warning",
          message: `${t.name} (Grade ${t.grade}) has no specialist sessions this week.`,
          suggestion: "Check specialist availability or enable a rotation strategy that covers every class.",
        });
      }
    }
  }

  // double_booked (specialist) — interval overlap on the same day/week.
  const bySpecDay = new Map<string, Block[]>();
  for (const b of blocks) {
    if (!b.specialist_id) continue;
    const k = `${b.specialist_id}|${b.day_of_week}`;
    (bySpecDay.get(k) ?? bySpecDay.set(k, []).get(k)!).push(b);
  }
  const seenSpec = new Set<string>();
  for (const [k, group] of bySpecDay) {
    const [specId, day] = k.split("|");
    const spec = specialists.find((s) => s.id === specId);
    for (const [a, b] of findOverlapClusters(group)) {
      // Big Group: two classes deliberately taught together — same specialist,
      // IDENTICAL interval, same grade, different teachers. Not a conflict.
      if (
        a.start_time === b.start_time && a.end_time === b.end_time &&
        a.grade === b.grade && a.teacher_id !== b.teacher_id
      ) continue;
      const sig = `${specId}|${day}|${a.start_time}|${b.start_time}`;
      if (seenSpec.has(sig)) continue;
      seenSpec.add(sig);
      warnings.push({
        type: "double_booked",
        severity: "error",
        message: `${spec?.name ?? "Specialist"} double-booked on ${day} at ${a.start_time} (${a.grade ?? "?"}, ${b.grade ?? "?"}).`,
      });
    }
  }

  // teacher_double_booked — a class can't be in two specials at once.
  // Previously never checked on the backend, so the scorer couldn't
  // penalise it even though the UI grid flags it.
  const byTeachDay = new Map<string, Block[]>();
  for (const b of blocks) {
    if (!b.teacher_id) continue;
    const k = `${b.teacher_id}|${b.day_of_week}`;
    (byTeachDay.get(k) ?? byTeachDay.set(k, []).get(k)!).push(b);
  }
  const seenTeach = new Set<string>();
  for (const [k, group] of byTeachDay) {
    const [teacherId, day] = k.split("|");
    for (const [a, b] of findOverlapClusters(group)) {
      const sig = `${teacherId}|${day}|${a.start_time}|${b.start_time}`;
      if (seenTeach.has(sig)) continue;
      seenTeach.add(sig);
      warnings.push({
        type: "teacher_double_booked",
        severity: "error",
        message: `Class ${a.grade ?? "?"} double-booked on ${day} at ${a.start_time} (${a.subject}, ${b.subject}).`,
        suggestion: "Move one of the overlapping sessions to a free slot.",
      });
    }
  }
  return warnings;
}

// ─── Occupancy tracker ───────────────────────────────────────────────
// Extracted to ./_occupancy.ts (Phase 0). Imported + re-exported above so the
// interval-overlap availability model lives in one focused module.

// ─── FIX-P1-1: calendar event warnings ───────────────────────────────
// Weekly schedule template can't honor date-specific no-school days,
// but we surface them so coordinators know dates were detected and
// what to do. ≥2 events on the same weekday → `skipped_holiday`;
// otherwise per-date `calendar_one_off`. Severity: info (advisory).
export function validateCalendar(calendarEvents: any[]): Warning[] {
  const NO_SCHOOL_TYPES = new Set(["holiday", "no_school", "closure", "teacher_workday"]);
  const dayMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const byWeekday: Record<string, { dates: string[]; titles: string[] }> = {};
  const oneOffs: { date: string; title: string; type: string }[] = [];

  for (const ev of calendarEvents) {
    if (!ev || !NO_SCHOOL_TYPES.has(ev.event_type) || !ev.event_date) continue;
    const start = new Date(ev.event_date + "T00:00:00");
    const end = ev.end_date ? new Date(ev.end_date + "T00:00:00") : start;
    // Expand multi-day ranges into individual weekday hits.
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const idx = d.getDay();
      const wd = dayMap[idx];
      if (!DAYS.includes(wd)) continue;
      const iso = d.toISOString().slice(0, 10);
      if (!byWeekday[wd]) byWeekday[wd] = { dates: [], titles: [] };
      byWeekday[wd].dates.push(iso);
      byWeekday[wd].titles.push(ev.title ?? ev.event_type);
    }
  }

  const warnings: Warning[] = [];
  for (const [wd, info] of Object.entries(byWeekday)) {
    if (info.dates.length >= 2) {
      warnings.push({
        type: "skipped_holiday",
        severity: "info",
        message: `${info.dates.length} no-school dates fall on ${wd} (${info.dates.join(", ")}).`,
        suggestion: `Consider a make-up rotation for ${wd} classes on affected weeks.`,
      });
    } else {
      for (let i = 0; i < info.dates.length; i++) {
        oneOffs.push({ date: info.dates[i], title: info.titles[i], type: "calendar_one_off" });
      }
    }
  }
  for (const o of oneOffs) {
    warnings.push({
      type: "calendar_one_off",
      severity: "info",
      message: `One-off no-school date detected: ${o.date} (${o.title}).`,
      suggestion: "This date is excluded from the weekly template — verify make-ups are not required.",
    });
  }
  return warnings;
}

// ─── FIX-P1-5: planning-time enforcement ─────────────────────────────
// Compares each specialist's free (non-teaching, non-lunch) minutes
// per week against their required planning minutes. Severity:
// "warning" (advisory) — does NOT gate strategy fallback by design,
// so a viable schedule isn't tossed because of a tight planning gap.
export function validatePlanningTime(blocks: Block[], specialists: Specialist[], school: any): Warning[] {
  const warnings: Warning[] = [];
  const startMin = timeToMinutes(school.start_time ?? "08:00");
  // Compute weekly available minutes across working days (respect early release).
  const weeklyMinutesForSpec = (spec: Specialist): number => {
    const workDays = (spec.working_days ?? DAYS).filter((d: string) => DAYS.includes(d));
    let total = 0;
    for (const day of workDays) {
      total += Math.max(0, getEndMinForDay(day, school) - startMin);
    }
    return total;
  };

  for (const spec of specialists) {
    const weeklyAvailable = weeklyMinutesForSpec(spec);
    if (weeklyAvailable <= 0) continue;
    const teaching = blocks
      .filter((b) => b.specialist_id === spec.id && b.grade !== "Lunch" && b.grade !== "Planning")
      .reduce((acc, b) => acc + (timeToMinutes(b.end_time) - timeToMinutes(b.start_time)), 0);
    const lunch = blocks
      .filter((b) => b.specialist_id === spec.id && b.grade === "Lunch")
      .reduce((acc, b) => acc + (timeToMinutes(b.end_time) - timeToMinutes(b.start_time)), 0);
    const free = weeklyAvailable - teaching - lunch;

    // Required planning: prefer explicit weekly value, else per-day × working days,
    // else fall back to the school default per day × working days.
    const workDayCount = (spec.working_days ?? DAYS).filter((d: string) => DAYS.includes(d)).length || DAYS.length;
    const perDayDefault = spec.planning_minutes ?? school.planning_minutes ?? 0;
    // Part-time specialists carry their own (usually smaller) weekly planning
    // guarantee — honor it instead of the full-time figure.
    const required = (spec.is_part_time && spec.part_time_planning_minutes != null)
      ? spec.part_time_planning_minutes
      : (spec.weekly_planning_minutes ?? (perDayDefault * workDayCount));
    if (required > 0 && free < required) {
      warnings.push({
        type: "planning_shortfall",
        severity: "warning",
        message: `${spec.name} has ${free} free min/wk but requires ${required} planning min/wk (short by ${required - free}).`,
        suggestion: "Reduce teaching load, add a working day, or lower planning requirement.",
      });
    }
  }
  return warnings;
}

// ─── FIX-P1-2: extra-rotation collision detector ─────────────────────
// extra_rotation intentionally bypasses specialist occupancy for
// conflict grades. When that produces same-(spec,day,slot,week)
// duplicates we want a soft `extra_rotation_failed` warning rather
// than letting it surface as a hard `double_booked` error.
export function validateExtraRotation(blocks: Block[], conflictGrades: string[]): Warning[] {
  if (conflictGrades.length === 0) return [];
  const conflictSet = new Set(conflictGrades);
  const slotMap = new Map<string, { grades: Set<string>; spec: string | null }>();
  for (const b of blocks) {
    if (!b.specialist_id) continue;
    if (!conflictSet.has(b.grade)) continue;
    const key = `${b.specialist_id}|${b.day_of_week}|${b.start_time}|${b.week_label ?? "all"}`;
    const entry = slotMap.get(key) ?? { grades: new Set<string>(), spec: b.specialist_id };
    entry.grades.add(b.grade);
    slotMap.set(key, entry);
  }
  const warnings: Warning[] = [];
  for (const [key, entry] of slotMap) {
    if (entry.grades.size > 1) {
      const [, day, time] = key.split("|");
      warnings.push({
        type: "extra_rotation_failed",
        severity: "warning",
        message: `Extra rotation could not separate conflict grades (${[...entry.grades].join(", ")}) on ${day} at ${time}.`,
        suggestion: "Try A/B Week or Big Group strategy instead.",
      });
    }
  }
  return warnings;
}

// ─── New: grade-cohesion warning (keep_grades_together) ─────────────
// Soft warning when a grade's specialist sessions are spread across
// more days than necessary given its weekly session count. We define
// "necessary" as ceil(sessions / maxPerDay) where maxPerDay = 2.
export function validateGradeCohesion(blocks: Block[], grades: string[], school: any): Warning[] {
  if (school?.keep_grades_together === false) return [];
  const warnings: Warning[] = [];
  for (const grade of grades) {
    const gradeBlocks = blocks.filter((b) => b.grade === grade && b.specialist_id);
    if (gradeBlocks.length === 0) continue;
    const daysUsed = new Set(gradeBlocks.map((b) => b.day_of_week));
    const sessions = gradeBlocks.length;
    const idealDays = Math.max(1, Math.ceil(sessions / 2));
    if (daysUsed.size > idealDays + 1) {
      warnings.push({
        type: "grade_cohesion",
        severity: "warning",
        message: `Grade ${grade} sessions are spread across ${daysUsed.size} days (${sessions} sessions). Cohesion target: ${idealDays} day(s).`,
        suggestion: "Cluster grade sessions on fewer days, or disable 'Keep grades together' in School Info.",
      });
    }
  }
  return warnings;
}

// ─── New: extra PLT target check (suggest_extra_plt) ────────────────
export function validateExtraPlt(blocks: Block[], specialists: Specialist[], school: any): Warning[] {
  if (!school?.suggest_extra_plt) return [];
  const target = Number(school?.extra_plt_target_minutes ?? 0);
  if (!Number.isFinite(target) || target <= 0) return [];
  const warnings: Warning[] = [];
  for (const spec of specialists) {
    const plt = blocks
      .filter((b) => b.specialist_id === spec.id && b.grade === "Planning")
      .reduce((acc, b) => acc + (timeToMinutes(b.end_time) - timeToMinutes(b.start_time)), 0);
    if (plt < target) {
      warnings.push({
        type: "extra_plt_below_target",
        severity: "info",
        message: `${spec.name} has ${plt} planning min/wk — below extra-PLT target of ${target}.`,
        suggestion: `Add ~${target - plt} more planning minutes for ${spec.name}, or lower the extra-PLT target.`,
      });
    }
  }
  return warnings;
}

// ─── New: contractual subject minutes (per-grade weekly minimums) ──
interface ContractSubjectMinutes { grade: string; subject: string; weekly_minutes: number }
interface ContractTeacherMinutes { role: string; planning_minutes: number; duty_free_minutes?: number; notes?: string }
interface ContractExtract {
  subjects?: ContractSubjectMinutes[];
  teachers?: ContractTeacherMinutes[];
}

function normalizeGrade(g: string): string {
  return String(g ?? "").trim().toUpperCase().replace(/^GRADE\s+/i, "").replace(/\s+/g, "");
}
function normalizeSubject(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

export function validateContractualSubjects(blocks: Block[], school: any): Warning[] {
  const extracted = (school?.contractual_minutes_extracted ?? null) as ContractExtract | null;
  if (!extracted?.subjects?.length) return [];
  const warnings: Warning[] = [];
  // Aggregate scheduled minutes by (grade, subject)
  const scheduled = new Map<string, number>();
  for (const b of blocks) {
    if (!b.specialist_id) continue;
    if (b.grade === "Lunch" || b.grade === "Planning") continue;
    const key = `${normalizeGrade(b.grade)}|${normalizeSubject(b.subject)}`;
    const mins = timeToMinutes(b.end_time) - timeToMinutes(b.start_time);
    scheduled.set(key, (scheduled.get(key) ?? 0) + mins);
  }
  for (const req of extracted.subjects) {
    const required = Number(req.weekly_minutes ?? 0);
    if (!Number.isFinite(required) || required <= 0) continue;
    const key = `${normalizeGrade(req.grade)}|${normalizeSubject(req.subject)}`;
    const have = scheduled.get(key) ?? 0;
    if (have < required) {
      warnings.push({
        type: "contractual_subject_shortfall",
        severity: "warning",
        message: `Grade ${req.grade} ${req.subject}: ${have} min/wk scheduled, contract requires ${required} (short by ${required - have}).`,
        suggestion: "Add more sessions for this subject/grade, or update the contractual minutes.",
      });
    }
  }
  return warnings;
}

// ─── New: contractual teacher minutes (per-role planning/duty-free) ─
export function validateContractualTeachers(
  blocks: Block[],
  specialists: Specialist[],
  teachers: Teacher[],
  school: any,
): Warning[] {
  const extracted = (school?.contractual_minutes_extracted ?? null) as ContractExtract | null;
  if (!extracted?.teachers?.length) return [];
  const warnings: Warning[] = [];

  function plannerMinutes(id: string): number {
    return blocks
      .filter((b) => b.specialist_id === id && b.grade === "Planning")
      .reduce((acc, b) => acc + (timeToMinutes(b.end_time) - timeToMinutes(b.start_time)), 0);
  }
  function lunchMinutesFor(id: string): number {
    return blocks
      .filter((b) => b.specialist_id === id && b.grade === "Lunch")
      .reduce((acc, b) => acc + (timeToMinutes(b.end_time) - timeToMinutes(b.start_time)), 0);
  }

  for (const req of extracted.teachers) {
    const role = String(req.role ?? "").trim().toLowerCase();
    if (!role) continue;
    const reqPlanning = Number(req.planning_minutes ?? 0);
    const reqDutyFree = Number(req.duty_free_minutes ?? 0);

    // Try to match role against specialist subject OR teacher grade label.
    const matchingSpecs = specialists.filter(
      (s) => s.subject?.toLowerCase().includes(role) || role.includes(s.subject?.toLowerCase() ?? ""),
    );
    const matchingTeachers = teachers.filter(
      (t) => (t.grade ?? "").toLowerCase().includes(role) || role.includes("classroom") || role.includes("teacher"),
    );

    if (matchingSpecs.length === 0 && matchingTeachers.length === 0) {
      warnings.push({
        type: "contractual_role_unmatched",
        severity: "info",
        message: `Contract role "${req.role}" did not match any specialist or teacher.`,
        suggestion: "Rename the role to match a specialist subject (e.g. PE, Music) or 'Classroom Teacher'.",
      });
      continue;
    }

    for (const spec of matchingSpecs) {
      if (reqPlanning > 0) {
        const have = plannerMinutes(spec.id);
        if (have < reqPlanning) {
          warnings.push({
            type: "contractual_planning_shortfall",
            severity: "warning",
            message: `${spec.name} (${req.role}): ${have} planning min/wk, contract requires ${reqPlanning}.`,
            suggestion: "Add a planning block for this specialist or update contract data.",
          });
        }
      }
      if (reqDutyFree > 0) {
        const have = lunchMinutesFor(spec.id);
        if (have < reqDutyFree) {
          warnings.push({
            type: "contractual_duty_free_shortfall",
            severity: "warning",
            message: `${spec.name} (${req.role}): ${have} duty-free min/wk, contract requires ${reqDutyFree}.`,
            suggestion: "Extend or add a lunch block for this specialist.",
          });
        }
      }
    }
  }
  return warnings;
}

// ─── Time slot builder ───────────────────────────────────────────────
// Slot starts are SNAPPED to a school-wide canonical grid so the Master
// Schedule shows one tidy row per period across every grade and
// specialist. The cursor always advances by `canonicalStep` (school
// default class duration + school passing time), regardless of this
// specific subject's `classDuration` or grade-level passing/setup
// overrides. Subjects with shorter durations (e.g. 30 min) still occupy
// only their own length, but the NEXT slot starts on the canonical
// boundary — preventing the 5/10-minute drift that produced rows like
// 7:50, 8:05, 8:10, 8:15 instead of clean 7:45 → 8:30 → 9:15 …
// `canonicalStep` is required; callers compute it once from school
// settings. `defaultSetupTime`/`gradeTimeConfig` are kept on the
// signature for back-compat with other callers that still pass them.
export function buildTimeSlotsForGrade(
  _grade: string,
  classDuration: number,
  startMin: number,
  endMin: number,
  _defaultPassingTime: number,
  _defaultSetupTime: number,
  _gradeTimeConfig: Record<string, { passingTime?: number; resetTime?: number }>,
  recessWindows: RecessWindow[],
  canonicalStep?: number,
): TimeSlot[] {
  // Fall back to the legacy per-subject step ONLY if a canonical step
  // wasn't supplied (defensive — every production caller passes one).
  const step =
    canonicalStep && canonicalStep > 0
      ? canonicalStep
      : classDuration + (_defaultPassingTime ?? 0);

  const slots: TimeSlot[] = [];
  let cursor = startMin;

  while (cursor + classDuration <= endMin) {
    const slotEnd = cursor + classDuration;
    const overlaps = recessWindows.some((w) => cursor < w.end && slotEnd > w.start);
    if (!overlaps) {
      slots.push({ start: cursor, end: slotEnd });
    }
    // Always advance by the canonical step so the grid stays aligned —
    // recess just leaves a gap row instead of resetting the grid.
    cursor += step;
  }
  return slots;
}

// ─── Get end time for a given day (handles early release) ────────────
export function getEndMinForDay(day: string, school: any): number {
  const earlyReleaseDay = school.early_release_day ?? "";
  const shortDay = DAY_FULL_TO_SHORT[earlyReleaseDay] ?? earlyReleaseDay;
  if (shortDay && day === shortDay && school.early_release_end_time) {
    return timeToMinutes(school.early_release_end_time);
  }
  return timeToMinutes(school.end_time ?? "15:00");
}

// ─── Grade → band mapping ─────────────────────────────────────────────
// Typical K-5 elementary split: primary = K/1/2, intermediate = 3/4/5/6.
export function gradeBand(grade: string): "primary" | "intermediate" {
  const g = String(grade).trim().toUpperCase();
  if (g === "K" || g === "TK" || g === "PREK" || g === "PRE-K" || g === "1" || g === "2") {
    return "primary";
  }
  return "intermediate";
}

/**
 * Pick the recess configs that apply to a grade.
 * - If a band-specific row (`primary`/`intermediate`) matches the grade, use ONLY that row.
 *   The generic `all` row is ignored in this case (it would otherwise union extra windows
 *   and shrink the usable day to almost nothing).
 * - Otherwise (no grade given, or only an `all` row exists), use whatever rows exist.
 */
function selectRecessConfigsForGrade(recessConfigs: any[], grade?: string | null, gradeBands?: any[]): any[] {
  if (!grade) return recessConfigs;
  // Authoritative path: the setup wizard stores the explicit grade→band map
  // on schools.recess_grade_bands. Use it so ANY band layout works —
  // K/Primary/Intermediate or fully custom bands. Without this the scheduler
  // fell back to a hardcoded gradeBand() guess (K-2=primary, 3-6=intermediate)
  // that disagrees with the wizard's own grouping (K alone, 1-3, 4-6),
  // silently feeding Kindergarten and grade 3 the WRONG recess/lunch windows.
  if (Array.isArray(gradeBands) && gradeBands.length > 0) {
    const band = gradeBands.find((b: any) => Array.isArray(b?.grades) && b.grades.includes(grade));
    if (band?.key) {
      const rows = recessConfigs.filter((rc) => rc.grade_band === band.key);
      if (rows.length > 0) return rows;
    }
  }
  // Legacy heuristic fallback (schools created before grade bands were stored).
  const wantBand = gradeBand(grade);
  const matching = recessConfigs.filter((rc) => rc.grade_band === wantBand);
  if (matching.length > 0) return matching;
  const allBand = recessConfigs.filter((rc) => rc.grade_band === "all" || !rc.grade_band);
  if (allBand.length > 0) return allBand;
  return recessConfigs;
}

// ─── Get recess windows for a given day (handles early release overrides) ─
// When `grade` is provided, only the band that matches that grade is used —
// otherwise multiple band rows would union into one big blackout that wipes
// out most of the teaching day.
export function getRecessWindowsForDay(
  day: string,
  school: any,
  recessConfigs: any[],
  grade?: string | null,
): RecessWindow[] {
  const earlyReleaseDay = school.early_release_day ?? "";
  const shortDay = DAY_FULL_TO_SHORT[earlyReleaseDay] ?? earlyReleaseDay;
  const isEarlyRelease = shortDay && day === shortDay;

  const applicable = selectRecessConfigsForGrade(recessConfigs, grade, school?.recess_grade_bands);

  const windows: RecessWindow[] = [];
  for (const rc of applicable) {
    if (isEarlyRelease) {
      // Use early release overrides if available, fall back to regular
      const amStart = rc.early_release_am_recess_start ?? rc.am_recess_start;
      const amEnd = rc.early_release_am_recess_end ?? rc.am_recess_end;
      if (amStart && amEnd) windows.push({ start: timeToMinutes(amStart), end: timeToMinutes(amEnd) });

      const lunchStart = rc.early_release_lunch_start ?? rc.lunch_start;
      const lunchEnd = rc.early_release_lunch_end ?? rc.lunch_end;
      if (lunchStart && lunchEnd) windows.push({ start: timeToMinutes(lunchStart), end: timeToMinutes(lunchEnd) });

      const pmStart = rc.early_release_pm_recess_start ?? rc.pm_recess_start;
      const pmEnd = rc.early_release_pm_recess_end ?? rc.pm_recess_end;
      if (pmStart && pmEnd) {
        const pmStartMin = timeToMinutes(pmStart);
        const endMin = getEndMinForDay(day, school);
        // Only include PM recess if it's before early dismissal
        if (pmStartMin < endMin) {
          windows.push({ start: pmStartMin, end: timeToMinutes(pmEnd) });
        }
      }
    } else {
      if (rc.am_recess_start && rc.am_recess_end) {
        windows.push({ start: timeToMinutes(rc.am_recess_start), end: timeToMinutes(rc.am_recess_end) });
      }
      if (rc.lunch_start && rc.lunch_end) {
        windows.push({ start: timeToMinutes(rc.lunch_start), end: timeToMinutes(rc.lunch_end) });
      }
      if (rc.pm_recess_start && rc.pm_recess_end) {
        windows.push({ start: timeToMinutes(rc.pm_recess_start), end: timeToMinutes(rc.pm_recess_end) });
      }
    }
  }
  return windows;
}

// ─── Check if specialist can teach a grade on a day (grade rotation) ─
function canSpecialistTeachGradeOnDay(
  spec: Specialist,
  grade: string,
  day: string,
): boolean {
  if (!spec.grade_rotation) return true;
  // grade_rotation: { "Mon": ["K","1"], "Tue": ["2","3"], ... }
  const allowedGrades = spec.grade_rotation[day];
  if (!allowedGrades || allowedGrades.length === 0) return true;
  return allowedGrades.includes(grade);
}

// ─── Get max teaching slots per day for a specialist ─────────────────
function getMaxSlotsPerDay(
  spec: Specialist,
  day: string,
  classDuration: number,
  startMin: number,
  endMin: number,
): number {
  const totalMinutes = endMin - startMin;

  // Two-school specialists get half the day
  if (spec.two_schools) {
    const halfDay = Math.floor(totalMinutes / 2);
    return Math.max(1, Math.floor(halfDay / classDuration));
  }

  // No hard cap for others — let natural slot availability control
  return Infinity;
}

// ─── Cart buffer: check if specialist needs setup time between rooms ─
function needsCartBuffer(
  spec: Specialist,
  day: string,
  slotStart: number,
  existingBlocks: Block[],
  setupTime: number,
): boolean {
  if (!spec.uses_cart) return false;

  // Check if there's a block ending exactly at slotStart (back-to-back)
  for (const b of existingBlocks) {
    if (b.day_of_week === day && b.specialist_id === spec.id) {
      const blockEnd = timeToMinutes(b.end_time);
      // If block ends within setup_time of this slot, need buffer
      if (slotStart > 0 && slotStart - blockEnd < setupTime && slotStart - blockEnd >= 0) {
        return true;
      }
    }
  }
  return false;
}

// ─── Core assignment loop ────────────────────────────────────────────
/** A specialist's own class length when set (e.g. 30-min K sessions), else the
 *  grade/school default. Mirrors the school-level guard: 0/null → fallback. */
function specClassDuration(spec: Specialist, fallback: number): number {
  return (spec.class_duration != null && spec.class_duration > 0) ? spec.class_duration : fallback;
}

/** One schedulable unit: a single class, a whole-grade placeholder (teacher
 *  null), or a combined Big Group (`members` = every class taught together —
 *  one block is emitted PER member so each class keeps attribution and
 *  teacher-occupancy protection). */
export interface GradeTeacherEntry {
  grade: string;
  teacher: Teacher | null;
  members?: Teacher[];
}

function assignDay(
  day: string,
  gradeTeachers: GradeTeacherEntry[],
  specialists: Specialist[],
  occupancy: OccupancyTracker,
  generationId: string,
  classDurationByGrade: (grade: string) => number,
  startMin: number,
  endMin: number,
  defaultPassingTime: number,
  defaultSetupTime: number,
  gradeTimeConfig: Record<string, { passingTime?: number; resetTime?: number }>,
  recessWindowsForGrade: (grade: string) => RecessWindow[],
  skipSpecialistOccupancyForGrades: Set<string>,
  weekLabel: string | null,
  specRotationOffset: number,
  allBlocks: Block[],
  canonicalStep: number,
): AssignResult {
  const daySpecs = specialists.filter((s) => (s.working_days ?? DAYS).includes(day));
  if (daySpecs.length === 0) return { blocks: [], preferenceViolations: [] };

  // Sort grade-teacher pairs: prioritize those who prefer this day
  const sortedGT = [...gradeTeachers].sort((a, b) => {
    const aMatch = a.teacher?.day_preference === day ? -1 : 0;
    const bMatch = b.teacher?.day_preference === day ? -1 : 0;
    return aMatch - bMatch;
  });

  const blocks: Block[] = [];
  const preferenceViolations: PreferenceViolation[] = [];

  for (let ci = 0; ci < sortedGT.length; ci++) {
    const gt = sortedGT[ci];
    const gradeDefaultDuration = classDurationByGrade(gt.grade);
    const recessWindows = recessWindowsForGrade(gt.grade);

    const preferAM = gt.teacher?.am_pm_preference === "AM";
    const preferPM = gt.teacher?.am_pm_preference === "PM";

    const skipSpecOccupancy = skipSpecialistOccupancyForGrades.has(gt.grade);
    let assigned = false;

    // Round-robin specialist assignment: stagger each class's preferred
    // specialist by a STABLE per-class index AND by the per-day offset, so
    // the class prefers specialist (offset + rotIndex). Across the week the
    // per-day offset advances, so each class cycles through distinct
    // specialists (≈ once each) instead of every class piling onto the same
    // first-free specialist — which previously packed one specialist while
    // others sat idle and made classes repeat a subject while missing
    // another. Using a stable `rotIndex` (not the processing position `ci`)
    // keeps this rotation intact even when callers rotate the per-day
    // processing order for fairness. The inner `+ i` is the fallback search
    // order when the preferred specialist can't take the class.
    const rotIndex = (gt as any).rotIndex ?? ci;

    // Big Group: every member class attends together. One block per member is
    // emitted (attribution + occupancy for each class); plain entries are the
    // single-element case.
    const memberTeachers: (Teacher | null)[] =
      gt.members && gt.members.length > 0 ? gt.members : [gt.teacher];
    const leadTeacher = memberTeachers[0] ?? null;

    // Subject variety: prefer specialists this class hasn't seen yet this week
    // (same week label). The rotation order is preserved within each tier, so
    // fairness/balance behavior is unchanged — repeats are simply tried last.
    const rotatedSpecs = Array.from(
      { length: daySpecs.length },
      (_, i) => daySpecs[(specRotationOffset + rotIndex + i) % daySpecs.length],
    );
    const seenSpecIds = new Set<string>();
    if (leadTeacher) {
      for (const b of allBlocks) {
        if (b.teacher_id === leadTeacher.id && b.specialist_id && (b.week_label ?? null) === weekLabel) seenSpecIds.add(b.specialist_id);
      }
      for (const b of blocks) {
        if (b.teacher_id === leadTeacher.id && b.specialist_id && (b.week_label ?? null) === weekLabel) seenSpecIds.add(b.specialist_id);
      }
    }
    // Within each tier, prefer the specialist with the lightest load TODAY so
    // no specialist sits idle a full day while others absorb every class.
    // Rotation order is the stable tiebreaker.
    const byLoadThenRotation = (list: Specialist[]) =>
      list
        .map((s, i) => ({ s, i, load: occupancy.getSpecialistDayCount(day, s.id) }))
        .sort((a, b) => (a.load - b.load) || (a.i - b.i))
        .map((x) => x.s);
    const orderedSpecs = [
      ...byLoadThenRotation(rotatedSpecs.filter((s) => !seenSpecIds.has(s.id))),
      ...byLoadThenRotation(rotatedSpecs.filter((s) => seenSpecIds.has(s.id))),
    ];

    for (const spec of orderedSpecs) {
      if (assigned) break;

      // Grade rotation filter
      if (!canSpecialistTeachGradeOnDay(spec, gt.grade, day)) continue;

      // Per-specialist class length: a specialist with their own class_duration
      // (e.g. 30-min K sessions) gets blocks of THAT length; otherwise the
      // grade/school default. Slots are built per-specialist because the slot
      // grid stride depends on the duration. (No-op when no specialist sets a
      // custom duration — identical to the previous per-grade behavior.)
      const duration = specClassDuration(spec, gradeDefaultDuration);
      const specSlots = buildTimeSlotsForGrade(
        gt.grade, duration, startMin, endMin, defaultPassingTime, defaultSetupTime, gradeTimeConfig, recessWindows, canonicalStep,
      );
      if (specSlots.length === 0) continue;
      const rankedSlots = [...specSlots].sort((a, b) => {
        if (preferAM) return a.start - b.start;
        if (preferPM) return b.start - a.start;
        return a.start - b.start;
      });

      // Two-school max slots check
      const maxSlots = getMaxSlotsPerDay(spec, day, duration, startMin, endMin);
      if (occupancy.getSpecialistDayCount(day, spec.id) >= maxSlots) continue;

      for (const slot of rankedSlots) {
        if (!skipSpecOccupancy && !occupancy.isSpecialistFree(day, slot.start, slot.end, spec.id)) continue;
        // EVERY member class must be free (single-teacher case is the 1-element list).
        let allMembersFree = true;
        for (const m of memberTeachers) {
          if (m && !occupancy.isTeacherFree(day, slot.start, slot.end, m.id)) { allMembersFree = false; break; }
        }
        if (!allMembersFree) continue;
        // FIX-P1-6: don't schedule this grade if a PLC/Admin block covers it.
        if (!occupancy.isGradeRangeFree(day, gt.grade, slot.start, slot.end)) continue;

        // Cart buffer check
        if (needsCartBuffer(spec, day, slot.start, [...allBlocks, ...blocks], defaultSetupTime)) continue;

        // Book the specialist once; book every member's class. Extra members
        // use a synthetic spec key so the group doesn't inflate the
        // specialist's per-day slot count (two-school caps).
        const groupRoom = leadTeacher?.room ?? null;
        let firstBlock: Block | null = null;
        memberTeachers.forEach((m, mi) => {
          if (mi === 0) occupancy.book(day, slot.start, slot.end, spec.id, m?.id ?? null);
          else if (m) occupancy.book(day, slot.start, slot.end, `__group_${spec.id}`, m.id);
          const block: Block = {
            generation_id: generationId,
            day_of_week: day,
            start_time: minutesToTime(slot.start),
            end_time: minutesToTime(slot.end),
            subject: spec.subject,
            specialist_id: spec.id,
            teacher_id: m?.id ?? null,
            grade: gt.grade,
            room: gt.members && gt.members.length > 0 ? groupRoom : (m?.room ?? null),
            week_label: weekLabel,
          };
          blocks.push(block);
          if (!firstBlock) firstBlock = block;
        });
        const block = firstBlock!;
        assigned = true;

        // ── Phase 3A: record preference violations on successful booking ──
        if (leadTeacher) {
          const actualSlot: "AM" | "PM" = slot.start < 720 ? "AM" : "PM";
          if (preferAM && actualSlot !== "AM") {
            preferenceViolations.push({ kind: "am_pm", teacherId: leadTeacher.id, preferred: "AM", actualSlot });
          } else if (preferPM && actualSlot !== "PM") {
            preferenceViolations.push({ kind: "am_pm", teacherId: leadTeacher.id, preferred: "PM", actualSlot });
          }
          if (leadTeacher.day_preference && leadTeacher.day_preference !== day) {
            preferenceViolations.push({
              kind: "day_preference",
              teacherId: leadTeacher.id,
              preferred: leadTeacher.day_preference,
              actualDay: day,
            });
          }
        }
        if (spec.uses_cart) {
          // Find this specialist's previous block today (latest by start_time
          // among existing same-day, same-spec blocks across allBlocks + blocks).
          let prevRoom: string | null | undefined = undefined;
          let prevStart = -1;
          for (const b of [...allBlocks, ...blocks]) {
            if (b.specialist_id !== spec.id || b.day_of_week !== day) continue;
            if (b.start_time === block.start_time) continue;
            const s = timeToMinutes(b.start_time);
            if (s < slot.start && s > prevStart) {
              prevStart = s;
              prevRoom = b.room ?? null;
            }
          }
          if (prevStart >= 0 && (prevRoom ?? null) !== (block.room ?? null)) {
            preferenceViolations.push({
              kind: "cart_back_to_back",
              specialistId: spec.id,
              day,
              slot: slot.start,
            });
          }
        }

        break;
      }
    }
  }

  return { blocks, preferenceViolations };
}

// ─── Strategy implementations ────────────────────────────────────────

function generateStandard(
  generationId: string,
  specialists: Specialist[],
  gradeTeachers: { grade: string; teacher: Teacher | null }[],
  school: any,
  recessConfigs: any[],
  classDuration: number,
  occupancy: OccupancyTracker,
  existingBlocks: Block[],
  rng?: Rng,
): StrategyResult {
  const startMin = timeToMinutes(school.start_time ?? "08:00");
  const defaultPassingTime = school.passing_time ?? 5;
  const canonicalStep = schoolCanonicalStep(school);
  const defaultSetupTime = school.setup_time ?? 15;
  const gradeTimeConfig = (school.grade_time_config as Record<string, { passingTime?: number; resetTime?: number }>) ?? {};

  // Phase 3C: Monte Carlo permutation of grade-teacher ordering +
  // randomized starting rotation. Default (rng undefined) preserves
  // the deterministic Phase 3A ordering.
  const orderedGT = rng ? shuffle(gradeTeachers, rng) : gradeTeachers;
  const rotationStart = rng ? Math.floor(rng() * Math.max(1, specialists.length)) : 0;

  // Stamp a STABLE rotation index on each class (its position in the
  // shuffled order). This drives specialist variety and is independent of
  // the per-day processing order below.
  const indexed = orderedGT.map((gt, k) => ({ ...gt, rotIndex: k }));

  // Fairness under capacity pressure: when there are more classes than
  // daily specialist slots, whoever is processed last gets starved. If we
  // used the same order every day, the SAME tail classes would get zero
  // specials all week while others got a full slate. Rotating the daily
  // processing start spreads the shortage so every class gets a roughly
  // equal share. Step by ~classes/day so each day exposes a fresh window.
  const n = indexed.length;
  const rotStep = Math.max(1, Math.floor(n / DAYS.length));

  const blocks: Block[] = [];
  const preferenceViolations: PreferenceViolation[] = [];
  let rotation = rotationStart;

  for (let dIdx = 0; dIdx < DAYS.length; dIdx++) {
    const day = DAYS[dIdx];
    const endMin = getEndMinForDay(day, school);
    const recessWindowsForGrade = (grade: string) => getRecessWindowsForDay(day, school, recessConfigs, grade);

    const rotAmt = n > 0 ? (dIdx * rotStep) % n : 0;
    const dayOrder = rotAmt === 0 ? indexed : indexed.slice(rotAmt).concat(indexed.slice(0, rotAmt));

    const r = assignDay(
      day, dayOrder, specialists, occupancy, generationId,
      () => classDuration,
      startMin, endMin, defaultPassingTime, defaultSetupTime, gradeTimeConfig, recessWindowsForGrade,
      new Set(), null, rotation, [...existingBlocks, ...blocks],
      canonicalStep,
    );
    blocks.push(...r.blocks);
    preferenceViolations.push(...r.preferenceViolations);
    const daySpecCount = specialists.filter((s) => (s.working_days ?? DAYS).includes(day)).length;
    if (daySpecCount > 0) rotation = (rotation + 1) % daySpecCount;
  }

  return { blocks, preferenceViolations };
}

function generateABWeek(
  generationId: string,
  specialists: Specialist[],
  teachers: Teacher[],
  grades: string[],
  conflictGrades: string[],
  school: any,
  recessConfigs: any[],
  classDuration: number,
  occupancy: OccupancyTracker,
  existingBlocks: Block[],
  rng?: Rng,
): StrategyResult {
  const startMin = timeToMinutes(school.start_time ?? "08:00");
  const defaultPassingTime = school.passing_time ?? 5;
  const canonicalStep = schoolCanonicalStep(school);
  const defaultSetupTime = school.setup_time ?? 15;
  const gradeTimeConfig = (school.grade_time_config as Record<string, { passingTime?: number; resetTime?: number }>) ?? {};
  const conflictSet = new Set(conflictGrades);

  const nonConflictGT: { grade: string; teacher: Teacher | null }[] = [];
  const conflictGT: { grade: string; teacher: Teacher | null }[] = [];

  for (const grade of prioritizeGrades(grades)) {
    const gradeTeacherList = teachers.filter((t) => t.grade === grade);
    const pairs = gradeTeacherList.length > 0
      ? gradeTeacherList.map((t) => ({ grade, teacher: t }))
      : [{ grade, teacher: null as Teacher | null }];

    if (conflictSet.has(grade)) {
      conflictGT.push(...pairs);
    } else {
      nonConflictGT.push(...pairs);
    }
  }

  // If no grades were explicitly flagged as conflict, split the full grade
  // list in half so Week A and Week B are actually distinct. Otherwise both
  // weeks would receive the identical non-conflict assignments and the
  // strategy would be invisible in the output.
  const splitSource = conflictGT.length > 0 ? conflictGT : nonConflictGT;
  const groupA = splitSource.filter((_, i) => i % 2 === 0);
  const groupB = splitSource.filter((_, i) => i % 2 !== 0);
  const sharedNC = conflictGT.length > 0 ? nonConflictGT : [];

  // Phase 3C: optional permutation + rotation offset.
  const orderedNC = rng ? shuffle(sharedNC, rng) : sharedNC;
  const orderedA = rng ? shuffle(groupA, rng) : groupA;
  const orderedB = rng ? shuffle(groupB, rng) : groupB;

  const blocks: Block[] = [];
  const preferenceViolations: PreferenceViolation[] = [];
  let rotation = rng ? Math.floor(rng() * Math.max(1, specialists.length)) : 0;


  for (const day of DAYS) {
    const endMin = getEndMinForDay(day, school);
    const recessWindows = getRecessWindowsForDay(day, school, recessConfigs);
    const recessWindowsForGrade = (grade: string) => getRecessWindowsForDay(day, school, recessConfigs, grade);

    const nc = assignDay(
      day, orderedNC, specialists, occupancy, generationId,
      () => classDuration,
      startMin, endMin, defaultPassingTime, defaultSetupTime, gradeTimeConfig, recessWindowsForGrade,
      new Set(), null, rotation, [...existingBlocks, ...blocks],
      canonicalStep,
    );
    blocks.push(...nc.blocks);
    preferenceViolations.push(...nc.preferenceViolations);

    // FIX-P1-3: snapshot AFTER non-conflict bookings (which apply to
    // both weeks) but BEFORE week-A bookings, so week B inherits PLC,
    // lunch, events, and shared non-conflict blocks without inheriting
    // week-A's conflict-grade bookings.
    const occupancyB = occupancy.clone();

    const wa = assignDay(
      day, orderedA, specialists, occupancy, generationId,
      () => classDuration,
      startMin, endMin, defaultPassingTime, defaultSetupTime, gradeTimeConfig, recessWindowsForGrade,
      new Set(), "A", rotation, [...existingBlocks, ...blocks],
      canonicalStep,
    );
    blocks.push(...wa.blocks);
    preferenceViolations.push(...wa.preferenceViolations);

    // Use a different rotation offset for Week B so the two weeks land on
    // distinct slots even when group splits happen to be balanced.
    const rotationB = specialists.length > 0 ? (rotation + Math.max(1, Math.floor(specialists.length / 2))) % specialists.length : rotation;
    const wb = assignDay(
      day, orderedB, specialists, occupancyB, generationId,
      () => classDuration,
      startMin, endMin, defaultPassingTime, defaultSetupTime, gradeTimeConfig, recessWindowsForGrade,
      new Set(), "B", rotationB, [...existingBlocks, ...blocks],
      canonicalStep,
    );

    blocks.push(...wb.blocks);
    preferenceViolations.push(...wb.preferenceViolations);

    const daySpecCount = specialists.filter((s) => (s.working_days ?? DAYS).includes(day)).length;
    if (daySpecCount > 0) rotation = (rotation + 1) % daySpecCount;
  }

  return { blocks, preferenceViolations };
}

// ─── AA/BB Week: 4-week rotation (AA then BB) ───────────────────────
function generateAABBWeek(
  generationId: string,
  specialists: Specialist[],
  teachers: Teacher[],
  grades: string[],
  conflictGrades: string[],
  school: any,
  recessConfigs: any[],
  classDuration: number,
  occupancy: OccupancyTracker,
  existingBlocks: Block[],
  rng?: Rng,
): StrategyResult {
  const startMin = timeToMinutes(school.start_time ?? "08:00");
  const defaultPassingTime = school.passing_time ?? 5;
  const canonicalStep = schoolCanonicalStep(school);
  const defaultSetupTime = school.setup_time ?? 15;
  const gradeTimeConfig = (school.grade_time_config as Record<string, { passingTime?: number; resetTime?: number }>) ?? {};
  const conflictSet = new Set(conflictGrades);

  const nonConflictGT: { grade: string; teacher: Teacher | null }[] = [];
  const conflictGT: { grade: string; teacher: Teacher | null }[] = [];

  for (const grade of prioritizeGrades(grades)) {
    const gradeTeacherList = teachers.filter((t) => t.grade === grade);
    const pairs = gradeTeacherList.length > 0
      ? gradeTeacherList.map((t) => ({ grade, teacher: t }))
      : [{ grade, teacher: null as Teacher | null }];

    if (conflictSet.has(grade)) {
      conflictGT.push(...pairs);
    } else {
      nonConflictGT.push(...pairs);
    }
  }

  // Same split-fallback as ab_week: if no conflict grades, halve the
  // full grade list so the AA and BB weeks aren't carbon copies.
  const splitSourceAB = conflictGT.length > 0 ? conflictGT : nonConflictGT;
  const groupA = splitSourceAB.filter((_, i) => i % 2 === 0);
  const groupB = splitSourceAB.filter((_, i) => i % 2 !== 0);
  const sharedNCAB = conflictGT.length > 0 ? nonConflictGT : [];

  // Phase 3C: optional MC permutation.
  const orderedNC = rng ? shuffle(sharedNCAB, rng) : sharedNCAB;
  const orderedA = rng ? shuffle(groupA, rng) : groupA;
  const orderedB = rng ? shuffle(groupB, rng) : groupB;

  const blocks: Block[] = [];
  const preferenceViolations: PreferenceViolation[] = [];
  let rotation = rng ? Math.floor(rng() * Math.max(1, specialists.length)) : 0;


  // AA/BB = Group A gets weeks 1&2 ("AA"), Group B gets weeks 3&4 ("BB")
  for (const day of DAYS) {
    const endMin = getEndMinForDay(day, school);
    const recessWindows = getRecessWindowsForDay(day, school, recessConfigs);
    const recessWindowsForGrade = (grade: string) => getRecessWindowsForDay(day, school, recessConfigs, grade);

    const nc = assignDay(
      day, orderedNC, specialists, occupancy, generationId,
      () => classDuration,
      startMin, endMin, defaultPassingTime, defaultSetupTime, gradeTimeConfig, recessWindowsForGrade,
      new Set(), null, rotation, [...existingBlocks, ...blocks],
      canonicalStep,
    );
    blocks.push(...nc.blocks);
    preferenceViolations.push(...nc.preferenceViolations);

    // FIX-P1-3: snapshot before AA bookings so BB inherits shared
    // pre-seed + non-conflict but not AA's conflict-grade bookings.
    const occupancyBB = occupancy.clone();

    const waa = assignDay(
      day, orderedA, specialists, occupancy, generationId,
      () => classDuration,
      startMin, endMin, defaultPassingTime, defaultSetupTime, gradeTimeConfig, recessWindowsForGrade,
      new Set(), "AA", rotation, [...existingBlocks, ...blocks],
      canonicalStep,
    );
    blocks.push(...waa.blocks);
    preferenceViolations.push(...waa.preferenceViolations);

    const rotationBB = specialists.length > 0 ? (rotation + Math.max(1, Math.floor(specialists.length / 2))) % specialists.length : rotation;
    const wbb = assignDay(
      day, orderedB, specialists, occupancyBB, generationId,
      () => classDuration,
      startMin, endMin, defaultPassingTime, defaultSetupTime, gradeTimeConfig, recessWindowsForGrade,
      new Set(), "BB", rotationBB, [...existingBlocks, ...blocks],
      canonicalStep,
    );

    blocks.push(...wbb.blocks);
    preferenceViolations.push(...wbb.preferenceViolations);

    const daySpecCount = specialists.filter((s) => (s.working_days ?? DAYS).includes(day)).length;
    if (daySpecCount > 0) rotation = (rotation + 1) % daySpecCount;
  }

  return { blocks, preferenceViolations };
}

function generateQuick30(
  generationId: string,
  specialists: Specialist[],
  gradeTeachers: { grade: string; teacher: Teacher | null }[],
  conflictGrades: string[],
  school: any,
  recessConfigs: any[],
  classDuration: number,
  occupancy: OccupancyTracker,
  existingBlocks: Block[],
  rng?: Rng,
): StrategyResult {
  const startMin = timeToMinutes(school.start_time ?? "08:00");
  const defaultPassingTime = school.passing_time ?? 5;
  const canonicalStep = schoolCanonicalStep(school);
  const defaultSetupTime = school.setup_time ?? 15;
  const gradeTimeConfig = (school.grade_time_config as Record<string, { passingTime?: number; resetTime?: number }>) ?? {};
  const conflictSet = new Set(conflictGrades);

  const orderedGT = rng ? shuffle(gradeTeachers, rng) : gradeTeachers;

  const blocks: Block[] = [];
  const preferenceViolations: PreferenceViolation[] = [];
  let rotation = rng ? Math.floor(rng() * Math.max(1, specialists.length)) : 0;

  for (const day of DAYS) {
    const endMin = getEndMinForDay(day, school);
    const recessWindows = getRecessWindowsForDay(day, school, recessConfigs);
    const recessWindowsForGrade = (grade: string) => getRecessWindowsForDay(day, school, recessConfigs, grade);

    const r = assignDay(
      day, orderedGT, specialists, occupancy, generationId,
      // Quick 30: shorten EVERY grade to 30 minutes (not just conflict grades).
      // If a coordinator picks this strategy with no conflict grades flagged,
      // the previous behaviour silently fell back to the default duration,
      // which made the chosen strategy invisible in the output.
      () => 30,
      startMin, endMin, defaultPassingTime, defaultSetupTime, gradeTimeConfig, recessWindowsForGrade,
      new Set(), null, rotation, [...existingBlocks, ...blocks],
      canonicalStep,
    );

    blocks.push(...r.blocks);
    preferenceViolations.push(...r.preferenceViolations);
    const daySpecCount = specialists.filter((s) => (s.working_days ?? DAYS).includes(day)).length;
    if (daySpecCount > 0) rotation = (rotation + 1) % daySpecCount;
  }

  return { blocks, preferenceViolations };
}

function generateBigGroup(
  generationId: string,
  specialists: Specialist[],
  teachers: Teacher[],
  grades: string[],
  conflictGrades: string[],
  school: any,
  recessConfigs: any[],
  classDuration: number,
  occupancy: OccupancyTracker,
  existingBlocks: Block[],
  rng?: Rng,
): StrategyResult {
  const conflictSet = new Set(conflictGrades);
  const bigGroupConfig: BigGroupEntry[] = (school.big_group_config as BigGroupEntry[]) ?? [];
  const bigGroupTeacherIds = new Set<string>();

  // If big_group_config has specific teacher selections, use those
  for (const entry of bigGroupConfig) {
    for (const tid of entry.teacherIds ?? []) {
      bigGroupTeacherIds.add(tid);
    }
  }

  const gradeTeachers: GradeTeacherEntry[] = [];
  for (const grade of prioritizeGrades(grades)) {
    if (conflictSet.has(grade)) {
      // Collapse the selected (or all) teachers into ONE combined group entry
      // that still carries every member — assignDay emits one block per member
      // so each class keeps attribution, occupancy protection, and shows up in
      // per-teacher views/planners. (Previously this was `teacher: null`,
      // which silently dropped the member classes from the schedule.)
      const gradeTeacherList = teachers.filter((t) => t.grade === grade);
      const configEntry = bigGroupConfig.find(e => e.grade === grade);
      if (bigGroupConfig.length > 0 && configEntry && configEntry.teacherIds?.length > 0) {
        const selected = gradeTeacherList.filter(t => configEntry.teacherIds.includes(t.id));
        const members = selected.length > 0 ? selected : gradeTeacherList;
        gradeTeachers.push({ grade, teacher: members[0] ?? null, members });
        // Keep non-selected teachers as individual entries
        const nonSelected = gradeTeacherList.filter(t => !configEntry.teacherIds.includes(t.id));
        for (const t of nonSelected) gradeTeachers.push({ grade, teacher: t });
      } else {
        // No config for this grade — combine the whole grade
        gradeTeachers.push({ grade, teacher: gradeTeacherList[0] ?? null, members: gradeTeacherList });
      }
    } else {
      const gradeTeacherList = teachers.filter((t) => t.grade === grade);
      if (gradeTeacherList.length > 0) {
        for (const t of gradeTeacherList) gradeTeachers.push({ grade, teacher: t });
      } else {
        gradeTeachers.push({ grade, teacher: null });
      }
    }
  }

  return generateStandard(generationId, specialists, gradeTeachers, school, recessConfigs, classDuration, occupancy, existingBlocks, rng);
}

function generateExtraRotation(
  generationId: string,
  specialists: Specialist[],
  gradeTeachers: { grade: string; teacher: Teacher | null }[],
  conflictGrades: string[],
  school: any,
  recessConfigs: any[],
  classDuration: number,
  occupancy: OccupancyTracker,
  existingBlocks: Block[],
  rng?: Rng,
): StrategyResult {
  const startMin = timeToMinutes(school.start_time ?? "08:00");
  const defaultPassingTime = school.passing_time ?? 5;
  const canonicalStep = schoolCanonicalStep(school);
  const defaultSetupTime = school.setup_time ?? 15;
  const gradeTimeConfig = (school.grade_time_config as Record<string, { passingTime?: number; resetTime?: number }>) ?? {};
  const skipOccupancyGrades = new Set(conflictGrades);

  const orderedGT = rng ? shuffle(gradeTeachers, rng) : gradeTeachers;

  const blocks: Block[] = [];
  const preferenceViolations: PreferenceViolation[] = [];
  let rotation = rng ? Math.floor(rng() * Math.max(1, specialists.length)) : 0;

  for (const day of DAYS) {
    const endMin = getEndMinForDay(day, school);
    const recessWindows = getRecessWindowsForDay(day, school, recessConfigs);
    const recessWindowsForGrade = (grade: string) => getRecessWindowsForDay(day, school, recessConfigs, grade);

    const r = assignDay(
      day, orderedGT, specialists, occupancy, generationId,
      () => classDuration,
      startMin, endMin, defaultPassingTime, defaultSetupTime, gradeTimeConfig, recessWindowsForGrade,
      skipOccupancyGrades, null, rotation, [...existingBlocks, ...blocks],
      canonicalStep,
    );
    blocks.push(...r.blocks);
    preferenceViolations.push(...r.preferenceViolations);
    const daySpecCount = specialists.filter((s) => (s.working_days ?? DAYS).includes(day)).length;
    if (daySpecCount > 0) rotation = (rotation + 1) % daySpecCount;
  }

  return { blocks, preferenceViolations };
}

function addMakeupBlocks(
  generationId: string,
  specialists: Specialist[],
  existingBlocks: Block[],
  school: any,
  recessConfigs: any[],
  classDuration: number,
  grades: string[],
): Block[] {
  const startMin = timeToMinutes(school.start_time ?? "08:00");
  const defaultPassingTime = school.passing_time ?? 5;
  const canonicalStep = schoolCanonicalStep(school);
  const defaultSetupTime = school.setup_time ?? 15;
  const gradeTimeConfig = (school.grade_time_config as Record<string, { passingTime?: number; resetTime?: number }>) ?? {};

  const occupancy = new OccupancyTracker();
  for (const b of existingBlocks) {
    if (!b.specialist_id) continue; // PLC/admin blocks have no specialist
    occupancy.book(b.day_of_week, timeToMinutes(b.start_time), timeToMinutes(b.end_time), b.specialist_id, b.teacher_id);
  }

  const makeupBlocks: Block[] = [];

  for (const spec of specialists) {
    let added = false;
    for (const day of DAYS) {
      if (added) break;
      if (!(spec.working_days ?? DAYS).includes(day)) continue;

      const endMin = getEndMinForDay(day, school);
      const recessWindows = getRecessWindowsForDay(day, school, recessConfigs);
    const recessWindowsForGrade = (grade: string) => getRecessWindowsForDay(day, school, recessConfigs, grade);
      const generalSlots = buildTimeSlotsForGrade(
        grades[0] ?? "K", classDuration, startMin, endMin, defaultPassingTime, defaultSetupTime, gradeTimeConfig, recessWindows, canonicalStep,
      );

      for (const slot of generalSlots) {
        if (occupancy.isSpecialistFree(day, slot.start, slot.end, spec.id)) {
          occupancy.book(day, slot.start, slot.end, spec.id, null);
          makeupBlocks.push({
            generation_id: generationId,
            day_of_week: day,
            start_time: minutesToTime(slot.start),
            end_time: minutesToTime(slot.end),
            subject: `${spec.subject} (Makeup)`,
            specialist_id: spec.id,
            teacher_id: null,
            grade: "Makeup",
            room: null,
            week_label: null,
          });
          added = true;
          break;
        }
      }
    }
  }

  return makeupBlocks;
}

// ─── Lunch Club blocks (from clubs table) ────────────────────────────
function generateLunchClubBlocks(
  generationId: string,
  specialists: Specialist[],
  school: any,
  recessConfigs: any[],
  clubs: Club[],
): Block[] {
  const blocks: Block[] = [];

  if (clubs.length > 0) {
    // Use actual clubs from DB
    for (const club of clubs) {
      if (!club.start_time || !club.end_time) continue;
      const day = club.day_of_week ? (DAY_FULL_TO_SHORT[club.day_of_week] ?? club.day_of_week) : null;

      // Find a specialist that teaches a matching subject (best effort)
      const matchSpec = specialists.find(s =>
        club.name.toLowerCase().includes(s.subject.toLowerCase())
      );

      if (day) {
        blocks.push({
          generation_id: generationId,
          day_of_week: day,
          start_time: club.start_time,
          end_time: club.end_time,
          subject: club.name,
          specialist_id: matchSpec?.id ?? null,
          teacher_id: null,
          grade: club.grades ?? "All",
          room: null,
          week_label: null,
        });
      } else {
        // No specific day — place on each working day of the matched specialist
        const workDays = matchSpec ? (matchSpec.working_days ?? DAYS) : DAYS;
        for (const d of workDays) {
          blocks.push({
            generation_id: generationId,
            day_of_week: d,
            start_time: club.start_time,
            end_time: club.end_time,
            subject: club.name,
            specialist_id: matchSpec?.id ?? null,
            teacher_id: null,
            grade: club.grades ?? "All",
            room: null,
            week_label: null,
          });
          break; // one day per club
        }
      }
    }
  } else {
    // Fallback: synthetic lunch clubs (original behavior)
    const defaultRecessWindows = getRecessWindowsForDay("Mon", school, recessConfigs);
    const lunchWindows = defaultRecessWindows.filter(w => (w.end - w.start) >= 20);
    if (lunchWindows.length === 0) return blocks;

    const lunchWindow = lunchWindows.reduce((a, b) => (b.end - b.start) > (a.end - a.start) ? b : a);

    for (const spec of specialists) {
      const workDays = spec.working_days ?? DAYS;
      const day = workDays.find(d => DAYS.includes(d)) ?? workDays[0];
      if (!day) continue;

      blocks.push({
        generation_id: generationId,
        day_of_week: day,
        start_time: minutesToTime(lunchWindow.start),
        end_time: minutesToTime(lunchWindow.end),
        subject: `${spec.subject} Lunch Club`,
        specialist_id: spec.id,
        teacher_id: null,
        grade: "All",
        room: null,
        week_label: null,
      });
    }
  }
  return blocks;
}

// ─── Event Planning blocks ───────────────────────────────────────────
function generateEventPlanningBlocks(
  generationId: string,
  specialists: Specialist[],
  existingBlocks: Block[],
  school: any,
  recessConfigs: any[],
  classDuration: number,
): Block[] {
  const blocks: Block[] = [];
  const startMin = timeToMinutes(school.start_time ?? "08:00");

  const occupiedSlots = new Set(existingBlocks.map(b => `${b.day_of_week}:${b.start_time}:${b.specialist_id}`));

  for (const spec of specialists) {
    const workDays = spec.working_days ?? DAYS;
    let placed = false;

    for (const day of workDays) {
      if (placed) break;
      const endMin = getEndMinForDay(day, school);
      const recessWindows = getRecessWindowsForDay(day, school, recessConfigs);
    const recessWindowsForGrade = (grade: string) => getRecessWindowsForDay(day, school, recessConfigs, grade);

      for (let slotStart = endMin - classDuration; slotStart >= startMin; slotStart -= classDuration) {
        const key = `${day}:${minutesToTime(slotStart)}:${spec.id}`;
        const inRecess = recessWindows.some(r => slotStart < r.end && (slotStart + classDuration) > r.start);
        if (!occupiedSlots.has(key) && !inRecess) {
          blocks.push({
            generation_id: generationId,
            day_of_week: day,
            start_time: minutesToTime(slotStart),
            end_time: minutesToTime(slotStart + classDuration),
            subject: `${spec.subject} Event Planning`,
            specialist_id: spec.id,
            teacher_id: null,
            grade: "Planning",
            room: null,
            week_label: null,
          });
          placed = true;
          break;
        }
      }
    }
  }
  return blocks;
}

// ─── Admin Rotation / PLC blocks ─────────────────────────────────────
function generateAdminRotationBlocks(
  generationId: string,
  school: any,
): Block[] {
  const raw = school.admin_rotation as any;
  const adminRotation = (Array.isArray(raw)
    ? raw
    : (raw && Array.isArray(raw.blocks) ? raw.blocks : [])) as { day: string; startTime: string; endTime: string; grades: string[]; autoSchedule?: boolean; durationMinutes?: number }[];
  if (adminRotation.length === 0) return [];

  const blocks: Block[] = [];
  for (const entry of adminRotation) {
    // Skip auto-scheduled blocks until the auto-scheduler is wired up.
    // The Review step warns the user that these will be skipped.
    if (entry.autoSchedule) continue;
    const day = DAY_FULL_TO_SHORT[entry.day] ?? entry.day;
    const grades = entry.grades ?? [];
    if (grades.length === 0) continue;

    for (const grade of grades) {
      blocks.push({
        generation_id: generationId,
        day_of_week: day,
        start_time: entry.startTime,
        end_time: entry.endTime,
        subject: "PLC/Admin",
        specialist_id: null,
        teacher_id: null,
        grade,
        room: null,
        week_label: null,
      });
    }
  }
  return blocks;
}

// ─── PLUS rotation blocks (admin-specified extra specialist sessions) ──
// Each specialist may carry a per-day PLUS rotation (an extra rotation beyond
// the normal weekly grid). We materialise the admin-specified ones as fixed
// teaching blocks so the solver seeds them as occupancy and schedules the
// regular rotation AROUND them. ("AI auto-fit" PLUS, with no explicit day/time,
// is left to the normal rotation — there is nothing fixed to seed.)
export function generatePlusRotationBlocks(
  generationId: string,
  specialists: Specialist[],
  school: any,
): Block[] {
  const defaultDur = (school?.class_duration && school.class_duration > 0) ? school.class_duration : 45;
  const blocks: Block[] = [];
  for (const spec of specialists) {
    const pr = spec.plus_rotation;
    if (!pr || typeof pr !== "object") continue;
    for (const [dayKey, entry] of Object.entries(pr)) {
      if (!entry?.active) continue;
      const day = DAY_FULL_TO_SHORT[dayKey] ?? dayKey;
      if (!DAYS.includes(day)) continue;
      for (const g of (entry.grades ?? [])) {
        if (!g?.grade) continue;
        const startStr = g.startTime || entry.startTime;
        if (!startStr) continue;
        const startMin = timeToMinutes(startStr);
        if (!Number.isFinite(startMin)) continue;
        const dur = (g.durationMinutes && g.durationMinutes > 0) ? g.durationMinutes : defaultDur;
        blocks.push({
          generation_id: generationId,
          day_of_week: day,
          start_time: minutesToTime(startMin),
          end_time: minutesToTime(startMin + dur),
          subject: spec.subject ? `${spec.subject} (PLUS)` : "PLUS",
          specialist_id: spec.id,
          teacher_id: null,
          grade: g.grade,
          room: spec.location ?? null,
          week_label: null,
        });
      }
    }
  }
  return blocks;
}

// ─── Specialist lunch block reservation ──────────────────────────────
function reserveSpecialistLunchBlocks(
  generationId: string,
  specialists: Specialist[],
  recessConfigs: any[],
  school: any,
): Block[] {
  const blocks: Block[] = [];
  const defaultRecessWindows = getRecessWindowsForDay("Mon", school, recessConfigs);
  const lunchWindows = defaultRecessWindows.filter(w => (w.end - w.start) >= 20);
  if (lunchWindows.length === 0) return blocks;

  const lunchWindow = lunchWindows.reduce((a, b) => (b.end - b.start) > (a.end - a.start) ? b : a);

  for (const spec of specialists) {
    const lunchMins = spec.lunch_minutes ?? 30;
    if (lunchMins <= 0) continue;

    const workDays = spec.working_days ?? DAYS;
    for (const day of workDays) {
      if (!DAYS.includes(day)) continue;

      // Use early release lunch window if applicable
      const dayRecessWindows = getRecessWindowsForDay(day, school, recessConfigs);
      const dayLunchWindows = dayRecessWindows.filter(w => (w.end - w.start) >= 20);
      const dayLunch = dayLunchWindows.length > 0
        ? dayLunchWindows.reduce((a, b) => (b.end - b.start) > (a.end - a.start) ? b : a)
        : lunchWindow;

      // Reserve a lunch block within the lunch window for this specialist
      const lunchStart = dayLunch.start;
      const lunchEnd = Math.min(lunchStart + lunchMins, dayLunch.end);

      blocks.push({
        generation_id: generationId,
        day_of_week: day,
        start_time: minutesToTime(lunchStart),
        end_time: minutesToTime(lunchEnd),
        subject: "Specialist Lunch",
        specialist_id: spec.id,
        teacher_id: null,
        grade: "Lunch",
        room: null,
        week_label: null,
      });
    }
  }
  return blocks;
}

// ─── Build blocked time ranges from events & calendar ────────────────
function getBlockedDayTimeRanges(
  specialEvents: any[],
  // calendarEvents are date-based no-school days (holidays) and do not affect the
  // recurring weekly block schedule — they are used only for validation warnings.
  _calendarEvents: any[],
): Map<string, RecessWindow[]> {
  // Returns day-of-week → blocked time ranges derived from special_events
  // (assemblies, school photos, etc. that have specific start/end times).

  const blocked = new Map<string, RecessWindow[]>();

  for (const ev of specialEvents) {
    if (!ev.start_time || !ev.end_time) continue;
    // Special events have a specific date — map to day of week
    if (ev.event_date) {
      const date = new Date(ev.event_date + "T00:00:00");
      const dayIdx = date.getDay(); // 0=Sun, 1=Mon...
      const dayMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const dayShort = dayMap[dayIdx];
      if (!dayShort || !DAYS.includes(dayShort)) continue;

      if (!blocked.has(dayShort)) blocked.set(dayShort, []);
      blocked.get(dayShort)!.push({
        start: timeToMinutes(ev.start_time),
        end: timeToMinutes(ev.end_time),
      });
    }
  }

  return blocked;
}

// ─── Simulated Annealing refinement ────────────────────
// Extracted to ./_annealing.ts (Phase 0); imported at the top of this file.
// Kept out of the orchestrator so the search/refinement layer can evolve
// (Phase 1) without churning generate orchestration.

// ─── XAI: block placement reason ─────────────────────────────────────
export function computePlacementReason(
  block: Block,
  context: {
    specialist?: Specialist | null;
    teacher?: Teacher | null;
    school?: any;
    conflictGrades?: string[];
    chosenStrategy?: string;
  },
): string {
  const { specialist, teacher, school, conflictGrades = [], chosenStrategy } = context;

  if (block.grade === "Lunch") return `Specialist lunch break`;
  if (block.grade === "Planning") return `Event planning block for ${specialist?.name ?? "specialist"}`;
  if (block.grade === "Makeup") return `Makeup slot for ${specialist?.subject ?? "specials"}`;

  const start = timeToMinutes(block.start_time);
  const isAM = start < 720;
  const isWeekBlock = block.week_label && block.week_label !== "all";

  if (isWeekBlock) {
    return `Scheduled in Week ${block.week_label} to balance biweekly rotation`;
  }

  if (teacher?.am_pm_preference) {
    const pref = teacher.am_pm_preference;
    const actual = isAM ? "AM" : "PM";
    if (pref === actual) {
      return `Placed in ${actual} to honor ${teacher.name}'s preference`;
    }
  }

  if (conflictGrades.includes(block.grade)) {
    if (chosenStrategy === "big_group") return `Scheduled as a big-group session for ${block.grade} conflict resolution`;
    if (chosenStrategy === "quick_30") return `30-minute session to fit ${block.grade} into the schedule`;
    if (chosenStrategy === "extra_rotation") return `Extra rotation slot assigned to cover ${block.grade}`;
  }

  const day = block.day_of_week;
  if (specialist?.grade_rotation && specialist.grade_rotation[day]) {
    return `Aligned with ${specialist.name}'s grade rotation anchor for ${day}`;
  }

  return `First available slot on ${day} — no constraints forced this time`;
}

// ─── Main schedule generation ────────────────────────────────────────
export function generateScheduleBlocks(
  generationId: string,
  specialists: Specialist[],
  teachers: Teacher[],
  grades: string[],
  school: any,
  recessConfigs: any[],
  clubs: Club[],
  specialEvents: any[],
  calendarEvents: any[],
  adminBlocks: Block[],
  lockedBlocks: Block[] = [],
  weightOverrides?: Partial<Record<keyof ScoreBreakdown, number>>,
  /** Optional extra salt mixed into the Monte Carlo seed. Lets an outer
   *  retry loop explore independent permutation streams while keeping
   *  determinism for the same (generationId, seedSalt) pair. */
  seedSalt: number = 0,
): SchedulerResult {
  // ─── E: Pre-flight feasibility ────────────────────────────────────
  // Capacity is counted in SESSIONS, not specialist-days: a specialist teaches
  // ~6–7 classes per working day, not one. The previous check compared
  // specialist-DAY count against (grades × specialists) and wrongly rejected
  // ordinary K-5 schools as "infeasible". We now estimate real session
  // capacity vs. real session demand and only flag a genuine shortfall — and
  // we surface it as an actionable warning rather than throwing, so the user
  // still gets a best-effort schedule (the solver + no_coverage warnings show
  // exactly which classes couldn't be covered).
  const feasStartMin = timeToMinutes(school.start_time ?? "08:00");
  const schoolPeriodLen = ((school.class_duration && school.class_duration > 0) ? school.class_duration : 45);
  const feasPassing = school.passing_time ?? 5;
  let sessionCapacity = 0;
  for (const s of specialists) {
    // Respect a specialist's own class_duration override (e.g. 30-min K classes
    // fit more sessions/day than the 45-min school default), so the capacity
    // estimate — and any shortfall warning — is accurate per specialist.
    const specPeriodLen = (((s.class_duration && s.class_duration > 0) ? s.class_duration : schoolPeriodLen) || 45) + feasPassing;
    for (const d of (s.working_days ?? DAYS)) {
      if (!DAYS.includes(d)) continue;
      const endMin = getEndMinForDay(d, school);
      sessionCapacity += Math.max(0, Math.floor((endMin - feasStartMin) / Math.max(1, specPeriodLen)));
    }
  }
  // Demand = one session per (class, specialist). A/B and AA/BB strategies
  // spread the same coverage across two weeks, halving weekly demand.
  const feasStrategies: string[] = (school.conflict_strategies && school.conflict_strategies.length > 0)
    ? school.conflict_strategies
    : [school.conflict_strategy ?? "standard"];
  const feasTwoWeek = feasStrategies.includes("ab_week") || feasStrategies.includes("aa_bb_week");
  const requiredSessions = Math.ceil((teachers.length * specialists.length) / (feasTwoWeek ? 2 : 1));
  // `feasibilityShortfall` is attached to the warnings later (see below) when
  // capacity genuinely cannot meet demand. No hard throw — generation proceeds.
  const feasibilityShortfall = (specialists.length > 0 && teachers.length > 0 && sessionCapacity < requiredSessions)
    ? {
        type: "capacity_shortfall",
        severity: "error" as const,
        message: `Not enough specialist time to cover every class: about ${sessionCapacity} sessions available per week vs. ${requiredSessions} needed.`,
        suggestion: "Add a specialist, expand specialist working days, or enable A/B Week to halve weekly demand. The schedule below covers as many classes as it can.",
      }
    : null;

  // Never borrow planning_minutes (often 200+) as a class length — a null/zero
  // class_duration must fall back to 45, not to the specialist's weekly prep.
  const classDuration = (school.class_duration && school.class_duration > 0) ? school.class_duration : 45;
  const strategies: string[] = (school.conflict_strategies && school.conflict_strategies.length > 0)
    ? school.conflict_strategies
    : [school.conflict_strategy ?? "standard"];
  const conflictGrades: string[] = school.conflict_grades ?? [];
  const conflictTiming: string = school.conflict_timing ?? "before";

  // Build default grade-teacher pairs
  const gradeTeachers: { grade: string; teacher: Teacher | null }[] = [];
  for (const grade of prioritizeGrades(grades)) {
    const gradeTeacherList = teachers.filter((t) => t.grade === grade);
    if (gradeTeacherList.length > 0) {
      for (const t of gradeTeacherList) gradeTeachers.push({ grade, teacher: t });
    } else {
      gradeTeachers.push({ grade, teacher: null });
    }
  }

  // Pre-seed occupancy with admin/PLC blocks and event blocks
  const occupancy = new OccupancyTracker();
  for (const ab of adminBlocks) {
    // FIX-P1-4: admin/PLC blocks legitimately carry specialist_id=null
    // (no specialist owns PLC time). Only null is a valid "no specialist"
    // value — empty string is a legacy bug, treat as null on read.
    if (ab.specialist_id != null && ab.specialist_id !== "") {
      occupancy.book(ab.day_of_week, timeToMinutes(ab.start_time), timeToMinutes(ab.end_time), ab.specialist_id, ab.teacher_id);
    }
    // FIX-P1-6: lock the (day, grade, [start,end)) range so no
    // specialist can be assigned to that grade during PLC, regardless
    // of slot granularity differences across strategies.
    occupancy.bookGradeRange(
      ab.day_of_week,
      ab.grade,
      timeToMinutes(ab.start_time),
      timeToMinutes(ab.end_time),
    );
    // Also block teacher slots for PLC grades
    // (teachers in those grades are unavailable during PLC)
    const gradeTeachersForPLC = teachers.filter(t => t.grade === ab.grade);
    for (const t of gradeTeachersForPLC) {
      occupancy.book(ab.day_of_week, timeToMinutes(ab.start_time), timeToMinutes(ab.end_time), `__plc_${t.id}`, t.id);
    }
  }

  // Pre-seed locked blocks so regeneration schedules AROUND them instead
  // of on top of them. Without this, a freshly generated block could
  // overlap a locked block whenever their durations differ (the old
  // exact-start merge filter missed those). specialist_id "" is a legacy
  // bug — treat it as null.
  for (const lb of lockedBlocks) {
    const start = timeToMinutes(lb.start_time);
    const end = timeToMinutes(lb.end_time);
    if (lb.specialist_id != null && lb.specialist_id !== "") {
      occupancy.book(lb.day_of_week, start, end, lb.specialist_id, lb.teacher_id);
    } else if (lb.teacher_id) {
      occupancy.book(lb.day_of_week, start, end, `__locked_${lb.teacher_id}`, lb.teacher_id);
    }
    // Keep the grade's class clear during a locked session for that grade.
    if (lb.grade) occupancy.bookGradeRange(lb.day_of_week, lb.grade, start, end);
  }

  // Pre-seed admin-specified PLUS rotation blocks (extra specialist sessions):
  // book the specialist and lock the grade so the regular rotation works around
  // them, exactly like a locked block. They're added to the output below.
  const plusBlocks = generatePlusRotationBlocks(generationId, specialists, school);
  for (const pb of plusBlocks) {
    const start = timeToMinutes(pb.start_time);
    const end = timeToMinutes(pb.end_time);
    if (pb.specialist_id) occupancy.book(pb.day_of_week, start, end, pb.specialist_id, null);
    if (pb.grade) occupancy.bookGradeRange(pb.day_of_week, pb.grade, start, end);
  }

  // Block specialist lunch blocks in occupancy
  const lunchBlocks = reserveSpecialistLunchBlocks(generationId, specialists, recessConfigs, school);
  for (const lb of lunchBlocks) {
    if (lb.specialist_id) {
      occupancy.book(lb.day_of_week, timeToMinutes(lb.start_time), timeToMinutes(lb.end_time), lb.specialist_id, null);
    }
  }

  // Get blocked event time ranges and merge into recess windows per day
  const blockedRanges = getBlockedDayTimeRanges(specialEvents, calendarEvents);

  // Patch recess configs with event blocks for each day
  // (We'll handle this in getRecessWindowsForDay by passing events separately — 
  //  for now, events create occupancy blocks)
  for (const [day, ranges] of blockedRanges) {
    for (const range of ranges) {
      // Block all specialists for the full event interval (not just the
      // exact start minute — interval occupancy now rejects any slot that
      // overlaps the event window).
      for (const spec of specialists) {
        occupancy.book(day, range.start, range.end, spec.id, null);
      }
    }
  }

  // Phase 3C: derive a deterministic per-generation MC seed from the
  // generation UUID. Same generation → same Monte Carlo permutation
  // stream → same winning schedule. Different generations explore
  // different permutations.
  const mcSeed = deriveSeed(deriveSeed(0x9e3779b9, generationId), `salt:${seedSalt}`);
  const scoringInput: ScoreableInput = {
    school: {
      start_time: school.start_time,
      end_time: school.end_time,
      early_release_day: school.early_release_day,
      early_release_end_time: school.early_release_end_time,
      keep_grades_together: (school as any).keep_grades_together ?? true,
      contractual_minutes_extracted: (school as any).contractual_minutes_extracted ?? null,
    },
    specialists: specialists.map((s) => ({ id: s.id, subject: s.subject, working_days: s.working_days })),
    teachers: teachers.map((t) => ({
      id: t.id,
      am_pm_preference: t.am_pm_preference,
      day_preference: t.day_preference,
      weekly_planning_minutes: t.weekly_planning_minutes,
    })),
    grades,
  };
  const scoreFn = (r: StrategyResult): number => {
    const warnings = computeWarnings(r.blocks, specialists, grades);
    return scoreSchedule(
      { blocks: r.blocks, warnings, preferenceViolations: r.preferenceViolations },
      scoringInput,
      weightOverrides,
    ).total;
  };

  // If conflict_timing is "after", user resolves conflicts manually — use standard
  if (conflictTiming === "after" || conflictGrades.length === 0) {
    const standardClosure = (rng: Rng): StrategyResult =>
      generateStandard(generationId, specialists, gradeTeachers, school, recessConfigs, classDuration, occupancy.clone(), adminBlocks, rng);
    const cal = calibrateMonteCarlo(standardClosure, mcSeed, "standard");
    const mc = monteCarloRun(standardClosure, scoreFn, { iterations: cal.iterations, seed: mcSeed, label: "standard" });
    const mcWarnings = computeWarnings(mc.best.blocks, specialists, grades);
    if (!strategyFailed(mcWarnings)) {
      const saSeed = deriveSeed(mcSeed, "sa:standard");
      const saRng = mulberry32(saSeed);
      const sa = runSimulatedAnnealing(mc.best, mc.bestScore, scoringInput, specialists, grades, school, recessConfigs, occupancy, saRng, weightOverrides);
      const finalWarnings = computeWarnings(sa.blocks, specialists, grades);
      const breakdown = scoreSchedule({ blocks: sa.blocks, warnings: finalWarnings, preferenceViolations: sa.preferenceViolations }, scoringInput, weightOverrides).breakdown;
      return {
        blocks: [...lunchBlocks, ...plusBlocks, ...sa.blocks],
        chosenStrategy: "standard",
        attemptedStrategies: [{ strategy: "standard", error_count: 0, warning_count: 0 }],
        fallbackReason: null,
        extraWarnings: feasibilityShortfall ? [feasibilityShortfall] : [],
        preferenceViolations: sa.preferenceViolations,
        monteCarloAttempts: mc.attempts,
        winningScore: sa.score,
        scoreBreakdown: breakdown as unknown as Record<string, number>,
        saIterations: sa.iterations,
        saImprovement: sa.improvement,
      };
    }
    const finalWarnings = computeWarnings(mc.best.blocks, specialists, grades);
    const breakdown = scoreSchedule({ blocks: mc.best.blocks, warnings: finalWarnings, preferenceViolations: mc.best.preferenceViolations }, scoringInput, weightOverrides).breakdown;
    return {
      blocks: [...lunchBlocks, ...plusBlocks, ...mc.best.blocks],
      chosenStrategy: "standard",
      attemptedStrategies: [{ strategy: "standard", error_count: 0, warning_count: 0 }],
      fallbackReason: null,
      extraWarnings: feasibilityShortfall ? [feasibilityShortfall] : [],
      preferenceViolations: mc.best.preferenceViolations,
      monteCarloAttempts: mc.attempts,
      winningScore: mc.bestScore,
      scoreBreakdown: breakdown as unknown as Record<string, number>,
      saIterations: 0,
      saImprovement: 0,
    };
  }

  // ─── Prompt-2: priority-ordered try/fallback loop ───
  const BASE_STRATEGIES = new Set(["ab_week", "aa_bb_week", "quick_30", "big_group", "extra_rotation", "standard"]);
  const baseOrder = strategies.filter((s) => BASE_STRATEGIES.has(s));
  if (baseOrder.length === 0) baseOrder.push("standard");
  // Always keep "standard" as the ultimate fallback. If the coordinator
  // picked only riskier tactics (e.g. extra_rotation, or ab_week under
  // tight capacity) and they all produce errors, standard is tried last so
  // a single strategy choice can never leave the school with a broken
  // schedule. It only runs if every earlier strategy errored (the loop
  // breaks on the first error-free candidate), so it costs nothing in the
  // common case.
  else if (!baseOrder.includes("standard")) baseOrder.push("standard");
  const addMakeup = strategies.includes("makeup");
  const addLunchClubs = strategies.includes("lunch_clubs");
  const addEventPlanning = strategies.includes("event_planning");

  // Build a per-strategy closure that always starts from a fresh
  // clone of the pre-seeded occupancy tracker so MC iterations don't
  // leak state into each other.
  const strategyClosure = (strategy: string): ((rng: Rng) => StrategyResult) => {
    return (rng: Rng): StrategyResult => {
      const tracker = occupancy.clone();
      switch (strategy) {
        case "ab_week":
          return generateABWeek(generationId, specialists, teachers, grades, conflictGrades, school, recessConfigs, classDuration, tracker, adminBlocks, rng);
        case "aa_bb_week":
          return generateAABBWeek(generationId, specialists, teachers, grades, conflictGrades, school, recessConfigs, classDuration, tracker, adminBlocks, rng);
        case "quick_30":
          return generateQuick30(generationId, specialists, gradeTeachers, conflictGrades, school, recessConfigs, classDuration, tracker, adminBlocks, rng);
        case "big_group":
          return generateBigGroup(generationId, specialists, teachers, grades, conflictGrades, school, recessConfigs, classDuration, tracker, adminBlocks, rng);
        case "extra_rotation":
          return generateExtraRotation(generationId, specialists, gradeTeachers, conflictGrades, school, recessConfigs, classDuration, tracker, adminBlocks, rng);
        case "standard":
        default:
          return generateStandard(generationId, specialists, gradeTeachers, school, recessConfigs, classDuration, tracker, adminBlocks, rng);
      }
    };
  };

  const attempted: StrategyAttempt[] = [];
  let baseResult: StrategyResult | null = null;
  let chosenStrategy: string | null = null;
  let fallbackReason: string | null = null;
  let totalAttempts = 0;
  let winningScore = -Infinity;
  // Cache best per-strategy MC results so the "fewest errors" fallback
  // can reuse them instead of re-running.
  const bestByStrategy: Record<string, { result: StrategyResult; score: number; attempts: number }> = {};

  for (const strategy of baseOrder) {
    const closure = strategyClosure(strategy);
    const stratSeed = deriveSeed(mcSeed, `strategy:${strategy}`);
    const cal = calibrateMonteCarlo(closure, stratSeed, strategy);
    const mc = monteCarloRun(closure, scoreFn, { iterations: cal.iterations, seed: stratSeed, label: strategy });
    totalAttempts += mc.attempts;
    bestByStrategy[strategy] = { result: mc.best, score: mc.bestScore, attempts: mc.attempts };

    const bestWarnings = computeWarnings(mc.best.blocks, specialists, grades);
    const errorCount = bestWarnings.filter((w) => w.severity === "error").length;
    attempted.push({ strategy, error_count: errorCount, warning_count: bestWarnings.length });

    // Honour priority: first strategy whose BEST MC candidate is
    // error-free wins. (Phase-2 contract: strategyFailed gates on
    // warnings; here we evaluate against best.warnings.)
    if (!strategyFailed(bestWarnings)) {
      baseResult = mc.best;
      chosenStrategy = strategy;
      winningScore = mc.bestScore;
      break;
    }
  }

  if (!baseResult) {
    let bestIdx = 0;
    for (let i = 1; i < attempted.length; i++) {
      if (attempted[i].error_count < attempted[bestIdx].error_count) bestIdx = i;
    }
    const winner = baseOrder[bestIdx];
    const cached = bestByStrategy[winner];
    baseResult = cached.result;
    winningScore = cached.score;
    chosenStrategy = winner;
    fallbackReason = "all_strategies_had_errors";
  }

  // ─── Simulated Annealing refinement pass ─────────────────────────
  let saIterations = 0;
  let saImprovement = 0;
  if (!strategyFailed(computeWarnings(baseResult.blocks, specialists, grades))) {
    const saSeed = deriveSeed(mcSeed, `sa:${chosenStrategy ?? "standard"}`);
    const saRng = mulberry32(saSeed);
    const sa = runSimulatedAnnealing(
      baseResult, winningScore, scoringInput, specialists, grades,
      school, recessConfigs, occupancy, saRng, weightOverrides,
    );
    if (!strategyFailed(computeWarnings(sa.blocks, specialists, grades))) {
      baseResult = { blocks: sa.blocks, preferenceViolations: sa.preferenceViolations };
      winningScore = sa.score;
      saIterations = sa.iterations;
      saImprovement = sa.improvement;
    }
  }

  let baseBlocks: Block[] = baseResult.blocks;
  const preferenceViolations: PreferenceViolation[] = [...baseResult.preferenceViolations];

  if (addMakeup) {
    const makeupBlocks = addMakeupBlocks(generationId, specialists, baseBlocks, school, recessConfigs, classDuration, grades);
    baseBlocks = [...baseBlocks, ...makeupBlocks];
  }
  if (addLunchClubs) {
    const lunchClubBlocks = generateLunchClubBlocks(generationId, specialists, school, recessConfigs, clubs);
    baseBlocks = [...baseBlocks, ...lunchClubBlocks];
  }
  if (addEventPlanning) {
    const eventBlocks = generateEventPlanningBlocks(generationId, specialists, baseBlocks, school, recessConfigs, classDuration);
    baseBlocks = [...baseBlocks, ...eventBlocks];
  }

  const extraWarnings: Warning[] = [];
  if (feasibilityShortfall) extraWarnings.push(feasibilityShortfall);
  if (chosenStrategy === "extra_rotation") {
    extraWarnings.push(...validateExtraRotation(baseBlocks, conflictGrades));
  }

  const finalWarnings = computeWarnings(baseBlocks, specialists, grades, teachers);
  const breakdown = scoreSchedule(
    { blocks: baseBlocks, warnings: finalWarnings, preferenceViolations },
    scoringInput,
  ).breakdown;

  return {
    blocks: [...lunchBlocks, ...plusBlocks, ...baseBlocks],
    chosenStrategy: chosenStrategy ?? "standard",
    attemptedStrategies: attempted,
    fallbackReason,
    extraWarnings,
    preferenceViolations,
    monteCarloAttempts: totalAttempts,
    winningScore,
    scoreBreakdown: breakdown as unknown as Record<string, number>,
    saIterations,
    saImprovement,
  };
}

// ─── Deno serve handler ──────────────────────────────────────────────
// Guarded so tests can import this module's pure helpers without starting the server.
const __serveHandler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = user.id;

    const { school_id, locked_block_ids } = await req.json();
    if (!school_id) {
      return new Response(JSON.stringify({ error: "school_id required" }), { status: 400, headers: corsHeaders });
    }
    const lockedIds: string[] = Array.isArray(locked_block_ids) ? locked_block_ids : [];

    const { data: school, error: schoolErr } = await supabase
      .from("schools")
      .select("*")
      .eq("id", school_id)
      .single();
    if (schoolErr || !school) {
      return new Response(JSON.stringify({ error: "School not found" }), { status: 404, headers: corsHeaders });
    }

    // Fetch all related data in parallel
    const [specRes, teachRes, recessRes, clubsRes, eventsRes, calendarRes, weightProfileRes] = await Promise.all([
      supabase.from("specialists").select("*").eq("school_id", school_id),
      supabase.from("classroom_teachers").select("*").eq("school_id", school_id),
      supabase.from("recess_lunch_config").select("*").eq("school_id", school_id),
      supabase.from("clubs").select("*").eq("school_id", school_id),
      supabase.from("special_events").select("*").eq("school_id", school_id),
      supabase.from("parsed_calendar_events").select("*").eq("school_id", school_id).eq("approved", true),
      supabase.from("scoring_weight_profiles").select("*").eq("school_id", school_id).maybeSingle(),
    ]);

    const specialists: Specialist[] = (specRes.data ?? []).map((s: any) => ({
      id: s.id,
      name: s.name,
      subject: s.subject,
      working_days: s.working_days,
      planning_minutes: s.planning_minutes,
      lunch_minutes: s.lunch_minutes,
      uses_cart: s.uses_cart ?? false,
      two_schools: s.two_schools ?? false,
      is_part_time: s.is_part_time ?? false,
      part_time_planning_minutes: s.part_time_planning_minutes,
      part_time_lunch_minutes: s.part_time_lunch_minutes,
      grade_rotation: s.grade_rotation as Record<string, string[]> | null,
      location: s.location,
      second_location: s.second_location,
      weekly_planning_minutes: s.weekly_planning_minutes,
      class_duration: s.class_duration ?? null,
      plus_rotation: (s.plus_rotation ?? null) as Specialist["plus_rotation"],
    }));

    const teachers: Teacher[] = (teachRes.data ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      grade: t.grade,
      room: t.room,
      am_pm_preference: t.am_pm_preference,
      day_preference: t.day_preference,
      planning_minutes: t.planning_minutes,
      weekly_planning_minutes: t.weekly_planning_minutes,
      lunch_minutes: t.lunch_minutes,
    }));

    const recessConfigs = recessRes.data ?? [];
    const clubs: Club[] = (clubsRes.data ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      day_of_week: c.day_of_week,
      grades: c.grades,
      start_time: c.start_time,
      end_time: c.end_time,
    }));
    const specialEvents = eventsRes.data ?? [];
    const calendarEvents = calendarRes.data ?? [];
    const grades: string[] = school.grades_served ?? [];

    // Use learned weights if sample_count >= 5
    const weightProfile = weightProfileRes.data;
    const weightOverrides: Partial<Record<keyof ScoreBreakdown, number>> | undefined =
      weightProfile && (weightProfile.sample_count ?? 0) >= 5
        ? (weightProfile.weights as Partial<Record<keyof ScoreBreakdown, number>>)
        : undefined;

    if (specialists.length === 0 || grades.length === 0) {
      return new Response(
        JSON.stringify({ error: "Need at least one specialist and one grade to generate" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Phase 3A: deterministic quote pick (no Math.random in scheduler-touching code).
    let quoteSeed = 0;
    for (let i = 0; i < school_id.length; i++) quoteSeed = (quoteSeed * 31 + school_id.charCodeAt(i)) >>> 0;
    const quote = quotes[quoteSeed % quotes.length];

    const { data: lastGen } = await supabase
      .from("schedule_generations")
      .select("version")
      .eq("school_id", school_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (lastGen?.version ?? 0) + 1;

    const { data: generation, error: genErr } = await supabase
      .from("schedule_generations")
      .insert({
        school_id,
        version: nextVersion,
        status: "complete",
        quote: JSON.stringify(quote),
        generated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (genErr || !generation) {
      return new Response(JSON.stringify({ error: "Failed to create generation" }), { status: 500, headers: corsHeaders });
    }

    // Fetch locked blocks and carry them forward
    let lockedBlocks: Block[] = [];
    if (lockedIds.length > 0) {
      const { data: existingLocked } = await supabase
        .from("schedule_blocks")
        .select("*")
        .in("id", lockedIds);
      lockedBlocks = (existingLocked ?? []).map((b: any) => ({
        generation_id: generation.id,
        day_of_week: b.day_of_week,
        start_time: b.start_time,
        end_time: b.end_time,
        subject: b.subject,
        specialist_id: b.specialist_id || null, // FIX-P1-4: coerce "" → null
        teacher_id: b.teacher_id,
        grade: b.grade,
        room: b.room,
        week_label: b.week_label,
        // Carry user/AI annotations forward — replans must not silently drop
        // a teacher's notes or the block's explanation.
        notes: b.notes ?? null,
        is_override: b.is_override ?? false,
        placement_reason: b.placement_reason ?? null,
        ai_explanation: b.ai_explanation ?? null,
      }));
    }

    // Generate admin/PLC blocks FIRST so they're fed into occupancy
    const adminBlocks = generateAdminRotationBlocks(generation.id, school);

    // Generate schedule with all constraints (Prompt 2: returns orchestration result).
    // lockedBlocks are pre-seeded into occupancy so generation routes around them.
    //
    // HIGH-QUALITY MODE: run the full pipeline up to MAX_ATTEMPTS times with
    // independent random seeds and keep the best result by the verifier rubric
    // (100 - sum(|soft penalties|)/4). Stop early when we reach TARGET_QUALITY,
    // or when the wall-clock budget is exhausted. Users said they're happy to
    // wait longer for a near-perfect schedule.
    const qualityPct = qualityPercent;
    const TARGET_QUALITY = 99;
    // CPU is the binding constraint on Edge Functions (~2s before the
    // runtime kills the request). Each attempt costs ~700ms of CPU, so
    // 2 attempts is the safe ceiling for the synchronous path. Background
    // refinement (best-of-N) runs after we return.
    const MAX_ATTEMPTS = 2;
    const CPU_BUDGET_MS = 1200; // Reserve >800ms for save + return.
    const tStartOuter = performance.now();

    let schedulerResult: SchedulerResult | null = null;
    let bestQuality = -1;
    let bestAttempt = -1;
    let attemptsRun = 0;
    let cumulativeAttemptMs = 0;

    // Returns its result rather than assigning the outer `schedulerResult`
    // directly: assigning a captured variable only inside a closure defeats
    // TypeScript's control-flow analysis (it would treat schedulerResult as
    // perpetually null and mark the post-guard code unreachable → `never`).
    const runAttempt = (attempt: number): { candidate: SchedulerResult; quality: number } => {
      const t0 = performance.now();
      const candidate = generateScheduleBlocks(
        generation.id, specialists, teachers, grades, school, recessConfigs,
        clubs, specialEvents, calendarEvents, adminBlocks, lockedBlocks,
        weightOverrides, attempt,
      );
      const dt = performance.now() - t0;
      cumulativeAttemptMs += dt;
      const quality = qualityPct(candidate.scoreBreakdown as any);
      console.log(`[HQ] attempt ${attempt} → quality ${quality}% (${Math.round(dt)}ms, cum ${Math.round(cumulativeAttemptMs)}ms)`);
      attemptsRun++;
      return { candidate, quality };
    };

    // The schedulerResult assignments below live in the OUTER scope (not a
    // closure) so control-flow analysis tracks them and the
    // `if (!schedulerResult)` guard narrows correctly.
    try {
      // Attempt 0 — must succeed at least once to have any result to save.
      let r0: { candidate: SchedulerResult; quality: number };
      try {
        r0 = runAttempt(0);
      } catch (err) {
        console.error(`[HQ] attempt 0 threw, retrying once:`, err);
        r0 = runAttempt(0);
      }
      bestQuality = r0.quality;
      bestAttempt = 0;
      schedulerResult = r0.candidate;

      for (let attempt = 1; attempt < MAX_ATTEMPTS && bestQuality < TARGET_QUALITY; attempt++) {
        // Hard CPU-aware break: stop while we still have headroom to save.
        if (cumulativeAttemptMs > CPU_BUDGET_MS) {
          console.log(`[HQ] cpu budget hit after ${attemptsRun} attempts (${Math.round(cumulativeAttemptMs)}ms) — saving best (${bestQuality}%)`);
          break;
        }
        try {
          const r = runAttempt(attempt);
          if (r.quality > bestQuality) {
            bestQuality = r.quality;
            bestAttempt = attempt;
            schedulerResult = r.candidate;
          }
        } catch (err) {
          console.error(`[HQ] attempt ${attempt} threw:`, err);
        }
      }
    } catch (loopErr) {
      // CPU exceeded or unexpected fatal — bail out and save best so far.
      console.error(`[HQ] loop aborted, saving best so far:`, loopErr);
    }

    if (!schedulerResult) {
      throw new Error("Schedule generation produced no candidates");
    }
    console.log(`[HQ] best ${bestQuality}% from attempt ${bestAttempt} of ${attemptsRun} (${Math.round(performance.now() - tStartOuter)}ms), saving...`);
    const generatedBlocks = schedulerResult.blocks;

    // Lunch reservations already created inside generateScheduleBlocks for occupancy tracking
    // Do NOT call reserveSpecialistLunchBlocks again here — it would create duplicates

    // Merge: locked blocks first, admin blocks, then generated blocks (which
    // include lunch blocks). Safety net — drop any generated block that still
    // truly overlaps (by interval) a locked block on the same specialist/teacher
    // or an admin/PLC block for the same grade. Generation already avoids these,
    // but a belt-and-suspenders interval check guards against drift.
    const overlap = (s1: string, e1: string, s2: string, e2: string) =>
      timeToMinutes(s1) < timeToMinutes(e2) && timeToMinutes(s2) < timeToMinutes(e1);

    const nonConflicting = generatedBlocks.filter(b => {
      for (const lb of lockedBlocks) {
        if (lb.day_of_week !== b.day_of_week) continue;
        if (!weeksCoincide(lb.week_label, b.week_label)) continue;
        const sameOwner =
          (b.specialist_id && b.specialist_id === lb.specialist_id) ||
          (b.teacher_id && b.teacher_id === lb.teacher_id);
        if (sameOwner && overlap(b.start_time, b.end_time, lb.start_time, lb.end_time)) return false;
      }
      for (const ab of adminBlocks) {
        if (ab.day_of_week !== b.day_of_week || ab.grade !== b.grade) continue;
        if (overlap(b.start_time, b.end_time, ab.start_time, ab.end_time)) return false;
      }
      return true;
    });

    // Build lookup maps for computePlacementReason
    const specById = Object.fromEntries(specialists.map(s => [s.id, s]));
    const teacherById = Object.fromEntries(teachers.map(t => [t.id, t]));
    const conflictGrades: string[] = school.conflict_grades ?? [];

    const blocksWithReason = [...lockedBlocks, ...adminBlocks, ...nonConflicting].map(b => ({
      ...b,
      // Keep a carried-forward reason (locked blocks on replan) over a freshly
      // computed one.
      placement_reason: b.placement_reason ?? computePlacementReason(b, {
        specialist: b.specialist_id ? specById[b.specialist_id] : null,
        teacher: b.teacher_id ? teacherById[b.teacher_id] : null,
        school,
        conflictGrades,
        chosenStrategy: schedulerResult.chosenStrategy,
      }),
    }));

    const blocks = blocksWithReason;

    if (blocks.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < blocks.length; i += batchSize) {
        const batch = blocks.slice(i, i + batchSize);
        const { error: insertErr } = await supabase.from("schedule_blocks").insert(batch);
        if (insertErr) {
          console.error("Block insert error:", insertErr);
          return new Response(
            JSON.stringify({ error: `Block insert failed: ${insertErr.message}`, code: insertErr.code }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // Move the expensive post-processing (validators, metadata update,
    // activity log) into a background task so the user gets their schedule
    // back before the CPU budget can be exceeded by validation passes.
    const finalize = async () => {
      try {
        const baseWarnings = computeWarnings(blocks, specialists, grades, teachers);
        const extraKeys = new Set<string>();
        for (const w of schedulerResult!.extraWarnings) {
          if (w.type === "extra_rotation_failed") {
            const m = w.message.match(/on (\w+) at (\d{2}:\d{2})/);
            if (m) extraKeys.add(`${m[1]}:${m[2]}`);
          }
        }
        const filteredBase = baseWarnings.filter((w) => {
          if (w.type !== "double_booked") return true;
          const m = w.message.match(/on (\w+) at (\d{2}:\d{2})/);
          return !m || !extraKeys.has(`${m[1]}:${m[2]}`);
        });
        const calendarWarnings = validateCalendar(calendarEvents);
        const planningWarnings = validatePlanningTime(blocks, specialists, school);
        const cohesionWarnings = validateGradeCohesion(blocks, grades, school);
        const extraPltWarnings = validateExtraPlt(blocks, specialists, school);
        const contractSubjectWarnings = validateContractualSubjects(blocks, school);
        const contractTeacherWarnings = validateContractualTeachers(blocks, specialists, teachers, school);
        const warnings = [
          ...filteredBase,
          ...schedulerResult!.extraWarnings,
          ...calendarWarnings,
          ...planningWarnings,
          ...cohesionWarnings,
          ...extraPltWarnings,
          ...contractSubjectWarnings,
          ...contractTeacherWarnings,
        ];
        // Confidence signal (power 1): compute from the headroom (capacity) + a
        // convergence proxy off the inline SA telemetry, and persist so the UI
        // can read it. The fuller signal comes from background refine-schedule.
        const qualityConfidence = computeQualityConfidence({
          breakdown: schedulerResult!.scoreBreakdown,
          specialists,
          gradeCount: grades.length,
          school,
          refinement: {
            rounds: schedulerResult!.saIterations,
            lastImprovementRound: schedulerResult!.saImprovement > 0 ? schedulerResult!.saIterations - 1 : -1,
          },
        });
        await supabase.from("schedule_generations").update({
          warnings,
          chosen_strategy: schedulerResult!.chosenStrategy,
          attempted_strategies: schedulerResult!.attemptedStrategies,
          fallback_reason: schedulerResult!.fallbackReason,
          monte_carlo_attempts: schedulerResult!.monteCarloAttempts,
          winning_score: schedulerResult!.winningScore,
          score_breakdown: schedulerResult!.scoreBreakdown,
          sa_iterations: schedulerResult!.saIterations,
          sa_improvement: schedulerResult!.saImprovement,
          quality_confidence: qualityConfidence,
        }).eq("id", generation.id);
        await supabase.from("activity_log").insert({
          user_id: userId,
          workspace_id: school.workspace_id,
          action: "schedule_generated",
          details: {
            school_id,
            version: nextVersion,
            blocks_count: blocks.length,
            warnings_count: warnings.length,
            strategy: (school.conflict_strategies && school.conflict_strategies.length > 0) ? school.conflict_strategies : [school.conflict_strategy ?? "standard"],
            chosen_strategy: schedulerResult!.chosenStrategy,
            fallback_reason: schedulerResult!.fallbackReason,
            monte_carlo_attempts: schedulerResult!.monteCarloAttempts,
            winning_score: schedulerResult!.winningScore,
          },
        });
      } catch (err) {
        console.error("[finalize] background post-processing failed:", err);
      }
    };
    try {
      // @ts-ignore — EdgeRuntime is provided by Supabase edge runtime.
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(finalize());
      } else {
        // Fallback for local dev — best-effort fire-and-forget.
        finalize().catch(() => {});
      }
    } catch {
      finalize().catch(() => {});
    }

    return new Response(
      JSON.stringify({
        generation_id: generation.id,
        version: nextVersion,
        blocks_count: blocks.length,
        // Warnings/score finalize in the background; the UI re-fetches the
        // generation row to pick them up.
        warnings_count: 0,
        warnings: [],
        quote,
        chosen_strategy: schedulerResult.chosenStrategy,
        attempted_strategies: schedulerResult.attemptedStrategies,
        fallback_reason: schedulerResult.fallbackReason,
        preference_violations: schedulerResult.preferenceViolations,
        preference_violations_count: schedulerResult.preferenceViolations.length,
        monte_carlo_attempts: schedulerResult.monteCarloAttempts,
        winning_score: schedulerResult.winningScore,
        score_breakdown: schedulerResult.scoreBreakdown,
        sa_iterations: schedulerResult.saIterations,
        sa_improvement: schedulerResult.saImprovement,
        finalizing: true,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    if (err instanceof MonteCarloBudgetExceededError) {
      console.error("Generate schedule budget exceeded:", err.message);
      return new Response(
        JSON.stringify({
          error: err.message,
          code: "monte_carlo_budget_exceeded",
          calibration_ms: err.calibrationMs,
          projected_ms: err.projectedMs,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    // Note: capacity shortfall is surfaced as a soft warning (capacity_shortfall),
    // not a hard error, so the user still gets a best-effort schedule.
    console.error("Generate schedule error:", err);

    return new Response(
      JSON.stringify({ error: (err instanceof Error ? err.message : String(err)) || "Internal error" }),
      { status: 500, headers: corsHeaders }
    );
  }
};

if (import.meta.main) {
  Deno.serve(__serveHandler);
}
