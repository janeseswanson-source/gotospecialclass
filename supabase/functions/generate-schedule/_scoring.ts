// Phase 3B: schedule scoring for the Monte Carlo optimizer.
//
// scoreSchedule takes the result of one strategy run plus the input it
// was given and returns a single number (`total`) plus a transparent
// `breakdown` so we can log why one candidate beat another. Higher is
// better. Errors dominate (-1000 each) so any candidate with an error
// loses to any candidate without one — exactly mirroring the
// strategyFailed() gate used by the priority orchestrator.
//
// WEIGHTS (do not tune without updating the plan):
//   error                       -1000  per warning of severity "error"
//   warning                       -50  per warning of severity "warning"
//   full_week_coverage           +100  per grade booked on every working day
//   am_pm_satisfied               +10  per teacher with am_pm pref & no violation
//   day_pref_satisfied            +20  per teacher with day pref & no violation
//   planning_target_met           +30  per specialist with no planning_shortfall
//   cart_back_to_back              -5  per cart_back_to_back violation
//   k_grade_after_780              -3  per K block starting at/after 13:00
//   spec_dayload_stdev             -1  × stdev of per-day blocks per specialist

import type { Block, Warning, PreferenceViolation } from "./index.ts";

export interface ScoreBreakdown {
  errors: number;
  warnings: number;
  full_week_coverage: number;
  am_pm_satisfied: number;
  day_pref_satisfied: number;
  planning_target_met: number;
  cart_back_to_back: number;
  k_grade_after_780: number;
  spec_dayload_stdev: number;
  class_repeats: number;
  grade_cohesion: number;
  contract_min: number;
}

export interface ScoreResult {
  total: number;
  breakdown: ScoreBreakdown;
}

// Minimal shape — we only read what we need so callers can pass any
// object that has these fields (avoids a hard import-cycle on the big
// scheduler types).
export interface ScoreableResult {
  blocks: Block[];
  warnings: Warning[];
  preferenceViolations: PreferenceViolation[];
}

export interface ContractSubjectMin { grade?: string | null; subject?: string | null; weekly_minutes?: number | null }
export interface ContractTeacherMin { role?: string | null; planning_minutes?: number | null; duty_free_minutes?: number | null }
export interface ContractExtract {
  subjects?: ContractSubjectMin[] | null;
  teachers?: ContractTeacherMin[] | null;
}

export interface ScoreableInput {
  school: {
    start_time?: string;
    end_time?: string;
    early_release_day?: string;
    early_release_end_time?: string;
    keep_grades_together?: boolean | null;
    contractual_minutes_extracted?: ContractExtract | null;
  };
  specialists: Array<{ id: string; subject?: string | null; working_days?: string[] | null }>;
  teachers: Array<{ id: string; am_pm_preference?: string | null; day_preference?: string | null }>;
  grades: string[];
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function stdev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

export const DEFAULT_WEIGHTS: Record<keyof ScoreBreakdown, number> = {
  errors: -1000,
  warnings: -50,
  full_week_coverage: 100,
  am_pm_satisfied: 10,
  day_pref_satisfied: 20,
  planning_target_met: 30,
  cart_back_to_back: -5,
  k_grade_after_780: -3,
  spec_dayload_stdev: -1,
  class_repeats: -8,
  // Soft nudges: keep < cart penalty so they never dominate hard constraints.
  grade_cohesion: -4,    // per extra day a grade spans beyond its cohesion target
  contract_min: -0.05,   // per minute short on contractual subject/teacher minimums
};

export function scoreSchedule(
  result: ScoreableResult,
  input: ScoreableInput,
  weightOverrides?: Partial<Record<keyof ScoreBreakdown, number>>,
): ScoreResult {
  const w = weightOverrides ? { ...DEFAULT_WEIGHTS, ...weightOverrides } : DEFAULT_WEIGHTS;
  const { blocks, warnings, preferenceViolations } = result;

  // 1. Errors / warnings.
  let errorCount = 0;
  let warningCount = 0;
  let planningShortfallSpecs = new Set<string>();
  for (const w of warnings) {
    if (w.severity === "error") errorCount++;
    else if (w.severity === "warning") warningCount++;
    if (w.type === "planning_shortfall") {
      // message starts with "<spec.name> has ..." — we can't easily
      // recover the id, so we treat planning_target_met as a global:
      // award +30 × (specialists − warnings with this type).
      planningShortfallSpecs.add(w.message);
    }
  }

  // 2. Full-week coverage: a grade scores +100 if it has at least one
  // specialist block on every *schedulable* day — i.e. every weekday on
  // which at least one specialist actually works. Basing this on real
  // specialist availability (rather than a flat 5-day week) keeps the
  // reward achievable: if nobody works Friday, Friday can't be required
  // for coverage, so the optimizer can still discriminate good schedules.
  const specialistDays = new Set<string>();
  for (const s of input.specialists) {
    for (const d of (s.working_days ?? DAYS)) {
      if (DAYS.includes(d)) specialistDays.add(d);
    }
  }
  const coverageDays = DAYS.filter((d) => specialistDays.has(d));
  const requiredDays = coverageDays.length > 0 ? coverageDays : DAYS;
  let fullWeekCoverage = 0;
  for (const grade of input.grades) {
    const days = new Set(
      blocks
        .filter((b) => b.grade === grade && b.specialist_id)
        .map((b) => b.day_of_week),
    );
    if (requiredDays.every((d) => days.has(d))) fullWeekCoverage++;
  }

  // 3. Preference satisfaction (per teacher, not per violation).
  const teachersWithAmPm = input.teachers.filter((t) => t.am_pm_preference);
  const teachersWithDay = input.teachers.filter((t) => t.day_preference);
  const violatedAmPm = new Set(
    preferenceViolations.filter((v) => v.kind === "am_pm").map((v: any) => v.teacherId),
  );
  const violatedDay = new Set(
    preferenceViolations.filter((v) => v.kind === "day_preference").map((v: any) => v.teacherId),
  );
  const amPmSatisfied = teachersWithAmPm.filter((t) => !violatedAmPm.has(t.id)).length;
  const dayPrefSatisfied = teachersWithDay.filter((t) => !violatedDay.has(t.id)).length;

  // 4. Planning target met: +30 per specialist NOT in a planning_shortfall warning.
  const planningTargetMet = Math.max(0, input.specialists.length - planningShortfallSpecs.size);

  // 5. Cart back-to-back violations (per occurrence).
  const cartBackToBack = preferenceViolations.filter((v) => v.kind === "cart_back_to_back").length;

  // 6. K-grade blocks scheduled at/after 13:00 (780 min).
  const kAfter780 = blocks.filter(
    (b) =>
      (b.grade === "K" || b.grade === "TK") &&
      b.specialist_id != null &&
      timeToMinutes(b.start_time) >= 780,
  ).length;

  // 7. Per-specialist day-load stdev (load balance).
  const dayCounts: Record<string, number[]> = {};
  for (const spec of input.specialists) dayCounts[spec.id] = DAYS.map(() => 0);
  for (const b of blocks) {
    if (!b.specialist_id) continue;
    const idx = DAYS.indexOf(b.day_of_week);
    if (idx < 0) continue;
    if (!dayCounts[b.specialist_id]) continue;
    dayCounts[b.specialist_id][idx]++;
  }
  const stdevs = Object.values(dayCounts).map(stdev);
  const avgStdev = stdevs.length ? stdevs.reduce((a, b) => a + b, 0) / stdevs.length : 0;

  // 8. Per-class specialist repeats. A class should ideally see distinct
  // specialists across the week (the canonical specials rotation). Penalise
  // each extra visit to a specialist the same class already has, which
  // discourages "Library twice, no PE" schedules. Gentle weight (−8) so it
  // breaks ties between conflict-free candidates without overriding
  // coverage (+100) or preferences.
  const perClassSpec: Record<string, Record<string, number>> = {};
  for (const b of blocks) {
    if (!b.specialist_id || !b.teacher_id) continue;
    if (b.grade === "Lunch" || b.grade === "Planning" || b.grade === "Makeup") continue;
    (perClassSpec[b.teacher_id] ??= {});
    perClassSpec[b.teacher_id][b.specialist_id] = (perClassSpec[b.teacher_id][b.specialist_id] ?? 0) + 1;
  }
  let classRepeats = 0;
  for (const specCounts of Object.values(perClassSpec)) {
    for (const n of Object.values(specCounts)) if (n > 1) classRepeats += n - 1;
  }

  // 9. Grade cohesion: penalize each extra day a grade's sessions span
  // beyond ceil(sessions / 2) (matches the validateGradeCohesion check
  // in index.ts). Only active when keep_grades_together is not false.
  let cohesionExtraDays = 0;
  if (input.school?.keep_grades_together !== false) {
    for (const grade of input.grades) {
      const gradeBlocks = blocks.filter((b) => b.grade === grade && b.specialist_id);
      if (gradeBlocks.length === 0) continue;
      const daysUsed = new Set(gradeBlocks.map((b) => b.day_of_week)).size;
      const idealDays = Math.max(1, Math.ceil(gradeBlocks.length / 2));
      if (daysUsed > idealDays) cohesionExtraDays += daysUsed - idealDays;
    }
  }

  // 10. Contract minimums: compute shortfall minutes directly from
  // school.contractual_minutes_extracted so the optimizer sees them
  // every iteration (post-gen warnings are emitted only once).
  let contractShortfallMin = 0;
  const extracted = input.school?.contractual_minutes_extracted ?? null;
  if (extracted) {
    // Per-(grade, subject) scheduled minutes.
    const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
    if (extracted.subjects?.length) {
      const scheduled = new Map<string, number>();
      for (const b of blocks) {
        if (!b.specialist_id) continue;
        if (b.grade === "Lunch" || b.grade === "Planning") continue;
        const key = `${norm(b.grade).replace(/^grade\s+/, "").replace(/\s+/g, "")}|${norm(b.subject)}`;
        scheduled.set(key, (scheduled.get(key) ?? 0) + (timeToMinutes(b.end_time) - timeToMinutes(b.start_time)));
      }
      for (const req of extracted.subjects) {
        const required = Number(req.weekly_minutes ?? 0);
        if (required <= 0) continue;
        const key = `${norm(req.grade).replace(/^grade\s+/, "").replace(/\s+/g, "")}|${norm(req.subject)}`;
        const have = scheduled.get(key) ?? 0;
        if (have < required) contractShortfallMin += required - have;
      }
    }
    if (extracted.teachers?.length) {
      for (const req of extracted.teachers) {
        const role = norm(req.role);
        if (!role) continue;
        const matchingSpecs = input.specialists.filter((s) => {
          const sub = norm(s.subject);
          return sub && (sub.includes(role) || role.includes(sub));
        });
        for (const spec of matchingSpecs) {
          const reqPlanning = Number(req.planning_minutes ?? 0);
          const reqDutyFree = Number(req.duty_free_minutes ?? 0);
          if (reqPlanning > 0) {
            const have = blocks
              .filter((b) => b.specialist_id === spec.id && b.grade === "Planning")
              .reduce((acc, b) => acc + (timeToMinutes(b.end_time) - timeToMinutes(b.start_time)), 0);
            if (have < reqPlanning) contractShortfallMin += reqPlanning - have;
          }
          if (reqDutyFree > 0) {
            const have = blocks
              .filter((b) => b.specialist_id === spec.id && b.grade === "Lunch")
              .reduce((acc, b) => acc + (timeToMinutes(b.end_time) - timeToMinutes(b.start_time)), 0);
            if (have < reqDutyFree) contractShortfallMin += reqDutyFree - have;
          }
        }
      }
    }
  }

  const breakdown: ScoreBreakdown = {
    errors: errorCount * w.errors,
    warnings: warningCount * w.warnings,
    full_week_coverage: fullWeekCoverage * w.full_week_coverage,
    am_pm_satisfied: amPmSatisfied * w.am_pm_satisfied,
    day_pref_satisfied: dayPrefSatisfied * w.day_pref_satisfied,
    planning_target_met: planningTargetMet * w.planning_target_met,
    cart_back_to_back: cartBackToBack * w.cart_back_to_back,
    k_grade_after_780: kAfter780 * w.k_grade_after_780,
    spec_dayload_stdev: avgStdev * w.spec_dayload_stdev,
    class_repeats: classRepeats * w.class_repeats,
    grade_cohesion: cohesionExtraDays * w.grade_cohesion,
    contract_min: contractShortfallMin * w.contract_min,
  };

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total, breakdown };
}
