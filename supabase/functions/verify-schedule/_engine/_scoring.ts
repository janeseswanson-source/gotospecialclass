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
import { computeGradeOutWindows, bestPdWindowPerGrade } from "./_teamtime.ts";

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
  grade_day_spread: number;
  wheel_alignment: number;
  contract_min: number;
  subject_gap: number;
  subject_day_clustering: number;
  teacher_planning: number;
  grade_pd_window: number;
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
    rotation_wheel_grades?: string[] | null;
    grade_pd_enabled?: boolean | null;
    grade_pd_target_minutes?: number | null;
    grade_pd_quorum_pct?: number | null;
    contractual_minutes_extracted?: ContractExtract | null;
  };
  specialists: Array<{ id: string; subject?: string | null; working_days?: string[] | null; teacher_accompanies?: boolean | null }>;
  teachers: Array<{ id: string; grade?: string | null; am_pm_preference?: string | null; day_preference?: string | null; weekly_planning_minutes?: number | null }>;
  grades: string[];
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// ─── Wheel mode (PM: "if there are four 1st grade classrooms then the grade
// should be 1 for each specialist") ─────────────────────────────────────────
// A "wheel" means all specialists service the SAME grade's classrooms in one
// time slot, so that grade's teachers are free simultaneously (PLC) and the
// office knows when each grade is at specials. Config rides the dormant
// `schools.rotation_wheel_grades` column:
//   null / undefined → wheel mode ON for every grade (product default)
//   []               → wheel mode OFF (escape hatch: exact pre-wheel engine)
//   ["1","2"]        → wheel mode ON, restricted to the listed grades
export function wheelEnabled(
  school: { rotation_wheel_grades?: string[] | null } | null | undefined,
): boolean {
  const v = school?.rotation_wheel_grades;
  if (v == null) return true;
  return v.length > 0;
}

export function wheelGradeFilter(
  school: { rotation_wheel_grades?: string[] | null } | null | undefined,
): (grade: string) => boolean {
  const v = school?.rotation_wheel_grades;
  if (v == null || v.length === 0) return () => true;
  const set = new Set(v.map((g) => g.trim().toUpperCase()));
  return (grade: string) => set.has(grade.trim().toUpperCase());
}

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
  k_grade_after_780: -20,
  spec_dayload_stdev: -1,
  class_repeats: -25,
  // Soft nudges: keep < cart penalty so they never dominate hard constraints.
  grade_cohesion: -4,    // per extra day a grade spans beyond its cohesion target
  // Per extra DISTINCT GRADE a specialist teaches on one day beyond the first —
  // the "Grade 5 then 4 then K then 2 on Monday" complaint. MUST exceed the
  // 15/dupe subject_day_clustering penalty: for a day with N sessions across d
  // grades the combined cost is 15·(N−d) + w·(d−1), so any w < 15 makes MORE
  // grades per day strictly cheaper and the term would be self-defeating.
  grade_day_spread: -20,
  // Per extra DISTINCT GRADE inside one teaching wave (same day + start time
  // + week label) — the PM's "wheel": every specialist services the same
  // grade's classrooms at once so that grade's teachers can meet. MUTUALLY
  // EXCLUSIVE with grade_day_spread (see 9b/9c): a wheel forces each
  // specialist through many grades per day, which spread penalizes at the
  // same magnitude — with both active every wheel move would be score-
  // neutral at best. Magnitude: matches the spread term it replaces (score
  // scale stays stable), stays < class_repeats (-25) so purifying a wave can
  // never justify manufacturing a repeat, and > subject_day_clustering (-15)
  // so de-clustering doesn't casually re-mix a wave. Coverage (+100) and
  // errors (-1000) dwarf it — a partial/mixed wheel is always preferred over
  // dropping a class ("unless it is a different wheel due to amount of
  // classes for that grade").
  wheel_alignment: -20,
  contract_min: -0.05,   // per minute short on contractual subject/teacher minimums
  // Phase 4: verifier-aligned penalties.
  subject_gap: -40,            // per (grade, specialist) pair with zero sessions
  subject_day_clustering: -15, // per duplicate of same subject on same day for same grade
  // A classroom teacher's contractual planning time is the time their class is
  // out at specials. Penalise each minute a teacher's weekly specials coverage
  // falls short of their guaranteed weekly_planning_minutes.
  teacher_planning: -0.05,
  // Per MINUTE a grade falls short of its shared PD window (the PM's "block of
  // time rotations the grade level is together for PD"). Magnitude chosen so
  // the term guides without ever overruling structure:
  //   * a full 90-min miss costs 27 — well under class_repeats (25) x2, so a
  //     schedule never manufactures repeats to buy PD time;
  //   * coverage (+100) dominates it 4:1, so a class is never dropped for PD;
  //   * it pulls the SAME direction as wheel_alignment (-20): a pure wheel wave
  //     IS the maximal PD intersection, so the two reinforce each other;
  //   * a cap breach is a -50 warning vs +27 max here, so target and cap order
  //     themselves correctly with no extra machinery.
  // Objective-only — deliberately NOT in the quality% rubric.
  grade_pd_window: -0.3,
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

  // 9b. Grade-day spread: per (specialist, day), each DISTINCT teaching grade
  // beyond the first — a specialist bouncing 5 → 4 → K → 2 in one day is what
  // coordinators call "grades not together". Reserved pseudo-grades (Lunch /
  // Planning / Makeup) and whole-school "All" blocks (lunch clubs) don't count.
  // Same keep_grades_together gate as cohesion (same user intent).
  //
  // MUTUAL EXCLUSION with 9c: when wheel mode is on, spread is SKIPPED. A
  // wheel-pure day necessarily walks each specialist through one grade per
  // wave (many grades/day) — with both terms active at equal weight every
  // wheel-purifying move would be fought to a standstill.
  const wheelOn = wheelEnabled(input.school);
  const NON_GRADES = new Set(["lunch", "planning", "makeup", "all", ""]);
  let gradeDaySpread = 0;
  if (!wheelOn && input.school?.keep_grades_together !== false) {
    const gradesBySpecDay = new Map<string, Set<string>>();
    for (const b of blocks) {
      if (!b.specialist_id) continue;
      const g = String(b.grade ?? "").trim();
      if (NON_GRADES.has(g.toLowerCase())) continue;
      const key = `${b.specialist_id}|${b.day_of_week}`;
      (gradesBySpecDay.get(key) ?? gradesBySpecDay.set(key, new Set()).get(key)!).add(g);
    }
    for (const set of gradesBySpecDay.values()) gradeDaySpread += Math.max(0, set.size - 1);
  }

  // 9c. Wheel alignment: per teaching wave (same day + start time + week
  // label), each DISTINCT grade beyond the first. A pure wave = every
  // specialist servicing the same grade = that grade's teachers free at once.
  // Keyed on start_time only (not end) so a shorter K session sharing a wave
  // start still counts as the same wave. A block with NO week label runs in
  // every week, so it joins each label's wave. Soft: coverage and repeats
  // dominate. (Mirrored by dayWheelPenalty in _adjacency.ts — keep in sync.)
  let wheelMixedWaves = 0;
  if (wheelOn) {
    const inWheel = wheelGradeFilter(input.school);
    const weekLabels = new Set<string>();
    for (const b of blocks) if (b.week_label) weekLabels.add(b.week_label);
    const gradesByWave = new Map<string, Set<string>>();
    for (const b of blocks) {
      if (!b.specialist_id) continue;
      const g = String(b.grade ?? "").trim();
      if (NON_GRADES.has(g.toLowerCase())) continue;
      if (!inWheel(g)) continue;
      const labels = b.week_label ? [b.week_label] : (weekLabels.size ? [...weekLabels] : [""]);
      for (const l of labels) {
        const key = `${b.day_of_week}|${b.start_time}|${l}`;
        (gradesByWave.get(key) ?? gradesByWave.set(key, new Set()).get(key)!).add(g);
      }
    }
    for (const set of gradesByWave.values()) wheelMixedWaves += Math.max(0, set.size - 1);
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

  // 11. Subject gap: penalise each (grade × specialist) pair with zero
  //     sessions this week — directly targets "grade X never sees Music".
  let subjectGapPairs = 0;
  const pairKey = (g: string, sid: string) => `${g}|||${sid}`;
  const pairsSeen = new Set<string>();
  for (const b of blocks) {
    if (!b.specialist_id) continue;
    if (b.grade === "Lunch" || b.grade === "Planning" || b.grade === "Makeup") continue;
    pairsSeen.add(pairKey(b.grade, b.specialist_id));
  }
  for (const grade of input.grades) {
    for (const spec of input.specialists) {
      if (!pairsSeen.has(pairKey(grade, spec.id))) subjectGapPairs++;
    }
  }

  // 12. Same (grade, subject) twice on the same day = clustering dupe.
  let dayClusterDupes = 0;
  const subjDayCount = new Map<string, number>();
  for (const b of blocks) {
    if (!b.specialist_id) continue;
    if (b.grade === "Lunch" || b.grade === "Planning" || b.grade === "Makeup") continue;
    const k = `${b.grade}|${b.subject ?? ""}|${b.day_of_week}`;
    subjDayCount.set(k, (subjDayCount.get(k) ?? 0) + 1);
  }
  for (const n of subjDayCount.values()) if (n > 1) dayClusterDupes += n - 1;

  // 13. Teacher planning shortfall: each classroom teacher's specials minutes
  //     (their class out at a specialist = their guaranteed planning time) must
  //     reach weekly_planning_minutes. Penalise the shortfall in minutes.
  let teacherPlanningShortfall = 0;
  const teacherSpecialsMin = new Map<string, number>();
  // A specialist the classroom teacher ATTENDS WITH their class buys no
  // planning time — counting it would overstate prep and hide a real
  // shortfall ("so it is not a prep minutes unequal use of time").
  const accompaniedSpecIds = new Set(
    input.specialists.filter((sp) => sp.teacher_accompanies).map((sp) => sp.id),
  );
  for (const b of blocks) {
    if (!b.specialist_id || !b.teacher_id) continue;
    if (b.grade === "Lunch" || b.grade === "Planning" || b.grade === "Makeup") continue;
    if (accompaniedSpecIds.has(b.specialist_id)) continue;
    teacherSpecialsMin.set(b.teacher_id, (teacherSpecialsMin.get(b.teacher_id) ?? 0) + (timeToMinutes(b.end_time) - timeToMinutes(b.start_time)));
  }
  for (const t of input.teachers) {
    const required = Number(t.weekly_planning_minutes ?? 0);
    if (required <= 0) continue;
    const have = teacherSpecialsMin.get(t.id) ?? 0;
    if (have < required) teacherPlanningShortfall += required - have;
  }

  // 14. Grade-level PD window: minutes each grade falls short of the target
  //     block in which its whole team is simultaneously at specials. Uses the
  //     SAME measurement as the team_out_stretch cap (see _teamtime.ts).
  let pdShortfallMin = 0;
  const pdTarget = Number(input.school?.grade_pd_target_minutes ?? 0);
  if (input.school?.grade_pd_enabled !== false && pdTarget > 0 && input.teachers.length > 0) {
    const windows = computeGradeOutWindows(blocks, input.teachers, input.specialists, {
      quorumPct: Number(input.school?.grade_pd_quorum_pct ?? 100),
    });
    const best = bestPdWindowPerGrade(windows);
    const specialistCount = input.specialists.length;
    for (const g of input.grades) {
      const win = best.get(g);
      const classCount = win?.classCount
        ?? input.teachers.filter((t) => String(t.grade ?? "").trim() === g).length;
      if (classCount === 0) continue;
      // Structurally impossible windows are reported as a warning, not priced
      // as a penalty — charging for it would just add constant noise to every
      // candidate and drown the differences the optimizer can actually act on.
      if (classCount > specialistCount) continue;
      const got = win?.allOutMin ?? 0;
      if (got < pdTarget) pdShortfallMin += pdTarget - got;
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
    grade_day_spread: gradeDaySpread * w.grade_day_spread,
    wheel_alignment: wheelMixedWaves * w.wheel_alignment,
    contract_min: contractShortfallMin * w.contract_min,
    subject_gap: subjectGapPairs * w.subject_gap,
    subject_day_clustering: dayClusterDupes * w.subject_day_clustering,
    teacher_planning: teacherPlanningShortfall * w.teacher_planning,
    grade_pd_window: pdShortfallMin * w.grade_pd_window,
  };

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total, breakdown };
}
