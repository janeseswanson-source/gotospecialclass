// Shared schedule-constraint validator.
//
// Single source of truth for "is this block placement legal?" used by every
// PERSIST path so that AI/manual edits obey the SAME rules the generator
// enforces at generation time:
//   - end must be after start
//   - block must sit within school hours (early-release aware)
//   - block must not overlap the grade's recess/lunch windows
//   - block must not overlap a PLC/Admin grade-range lock for its grade
//   - the specialist must not be double-booked (interval overlap, same week)
//   - the class/teacher must not be double-booked (interval overlap, same week)
//
// The recess-window and school-hours logic intentionally mirrors
// generate-schedule/index.ts (getRecessWindowsForDay / getEndMinForDay /
// selectRecessConfigsForGrade) so the validator never disagrees with the
// generator. PLC grade-range locks are derived from the persisted PLC/Admin
// blocks (rows with specialist_id = null and a grade), which is exactly what
// the generator pre-seeds into its OccupancyTracker.

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

const DAY_FULL_TO_SHORT: Record<string, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
};

export type ViolationCode =
  | "end_before_start"
  | "outside_hours"
  | "recess"
  | "plc"
  | "specialist_double_book"
  | "teacher_double_book";

export interface ConstraintBlock {
  id?: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  specialist_id?: string | null;
  teacher_id?: string | null;
  grade?: string | null;
  week_label?: string | null;
  subject?: string | null;
}

interface RecessWindow {
  start: number;
  end: number;
}

type Interval = [number, number];

export function timeToMinutes(t?: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** A null/empty week label means "every week", so it coincides with any label. */
function weeksCoincide(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return true;
  return a === b;
}

/** True if [s,e) overlaps any [a,b) interval (half-open: touching is allowed). */
function overlapsAny(ivs: Interval[] | undefined, s: number, e: number): boolean {
  if (!ivs) return false;
  for (const [a, b] of ivs) if (s < b && e > a) return true;
  return false;
}

// ─── School hours (early-release aware) ──────────────────────────────
export function getDayStartMin(school: any): number {
  return timeToMinutes(school?.start_time) ?? 8 * 60;
}

export function getEndMinForDay(day: string, school: any): number {
  const earlyReleaseDay = school?.early_release_day ?? "";
  const shortDay = DAY_FULL_TO_SHORT[earlyReleaseDay] ?? earlyReleaseDay;
  if (shortDay && day === shortDay && school?.early_release_end_time) {
    return timeToMinutes(school.early_release_end_time) ?? (timeToMinutes(school?.end_time) ?? 15 * 60);
  }
  return timeToMinutes(school?.end_time) ?? 15 * 60;
}

// ─── Grade → recess config selection (mirrors the generator) ──────────
function gradeBandHeuristic(grade: string): "primary" | "intermediate" {
  const g = String(grade).trim().toUpperCase();
  if (g === "K" || g === "TK" || g === "PREK" || g === "PRE-K" || g === "1" || g === "2") {
    return "primary";
  }
  return "intermediate";
}

function selectRecessConfigsForGrade(recessConfigs: any[], grade?: string | null, gradeBands?: any[]): any[] {
  if (!grade) return recessConfigs;
  if (Array.isArray(gradeBands) && gradeBands.length > 0) {
    const band = gradeBands.find((b: any) => Array.isArray(b?.grades) && b.grades.includes(grade));
    if (band?.key) {
      const rows = recessConfigs.filter((rc) => rc.grade_band === band.key);
      if (rows.length > 0) return rows;
    }
  }
  const wantBand = gradeBandHeuristic(grade);
  const matching = recessConfigs.filter((rc) => rc.grade_band === wantBand);
  if (matching.length > 0) return matching;
  const allBand = recessConfigs.filter((rc) => rc.grade_band === "all" || !rc.grade_band);
  if (allBand.length > 0) return allBand;
  return recessConfigs;
}

export function getRecessWindowsForDay(
  day: string,
  school: any,
  recessConfigs: any[],
  grade?: string | null,
): RecessWindow[] {
  const earlyReleaseDay = school?.early_release_day ?? "";
  const shortDay = DAY_FULL_TO_SHORT[earlyReleaseDay] ?? earlyReleaseDay;
  const isEarlyRelease = !!shortDay && day === shortDay;

  const applicable = selectRecessConfigsForGrade(recessConfigs, grade, school?.recess_grade_bands);
  const windows: RecessWindow[] = [];

  for (const rc of applicable) {
    if (isEarlyRelease) {
      const amStart = rc.early_release_am_recess_start ?? rc.am_recess_start;
      const amEnd = rc.early_release_am_recess_end ?? rc.am_recess_end;
      const am0 = timeToMinutes(amStart);
      const am1 = timeToMinutes(amEnd);
      if (am0 !== null && am1 !== null) windows.push({ start: am0, end: am1 });

      const lunchStart = rc.early_release_lunch_start ?? rc.lunch_start;
      const lunchEnd = rc.early_release_lunch_end ?? rc.lunch_end;
      const l0 = timeToMinutes(lunchStart);
      const l1 = timeToMinutes(lunchEnd);
      if (l0 !== null && l1 !== null) windows.push({ start: l0, end: l1 });

      const pmStart = rc.early_release_pm_recess_start ?? rc.pm_recess_start;
      const pmEnd = rc.early_release_pm_recess_end ?? rc.pm_recess_end;
      const p0 = timeToMinutes(pmStart);
      const p1 = timeToMinutes(pmEnd);
      if (p0 !== null && p1 !== null) {
        const endMin = getEndMinForDay(day, school);
        if (p0 < endMin) windows.push({ start: p0, end: p1 });
      }
    } else {
      const am0 = timeToMinutes(rc.am_recess_start);
      const am1 = timeToMinutes(rc.am_recess_end);
      if (am0 !== null && am1 !== null) windows.push({ start: am0, end: am1 });
      const l0 = timeToMinutes(rc.lunch_start);
      const l1 = timeToMinutes(rc.lunch_end);
      if (l0 !== null && l1 !== null) windows.push({ start: l0, end: l1 });
      const p0 = timeToMinutes(rc.pm_recess_start);
      const p1 = timeToMinutes(rc.pm_recess_end);
      if (p0 !== null && p1 !== null) windows.push({ start: p0, end: p1 });
    }
  }
  return windows;
}

// ─── Validator context ────────────────────────────────────────────────
export interface ConstraintContext {
  school: any;
  recessConfigs: any[];
  /** PLC/Admin grade-range locks keyed `${day}:${grade}` → busy intervals. */
  gradeRangeLocks: Record<string, Interval[]>;
}

/** A block is a grade-range lock (PLC/Admin/etc) when it owns a grade's class
 *  time without a specialist — exactly what the generator treats as a lock. */
function isGradeLock(b: ConstraintBlock): boolean {
  return (b.specialist_id == null || b.specialist_id === "") && !!b.grade;
}

export function buildConstraintContext(
  school: any,
  recessConfigs: any[],
  allBlocks: ConstraintBlock[],
): ConstraintContext {
  const gradeRangeLocks: Record<string, Interval[]> = {};
  for (const b of allBlocks) {
    if (!isGradeLock(b)) continue;
    const s = timeToMinutes(b.start_time);
    const e = timeToMinutes(b.end_time);
    if (s === null || e === null) continue;
    (gradeRangeLocks[`${b.day_of_week}:${b.grade}`] ??= []).push([s, e]);
  }
  return { school, recessConfigs: recessConfigs ?? [], gradeRangeLocks };
}

/**
 * Return the list of constraint violations for placing `candidate` given the
 * full set of `allBlocks`. An empty array means the placement is legal.
 *
 * Intended for TEACHING blocks (a specialist teaching a grade/class). Callers
 * should not pass PLC/lunch/recess blocks — those legitimately occupy those
 * windows and are the source of the locks, not subject to them.
 */
export function violations(
  candidate: ConstraintBlock,
  allBlocks: ConstraintBlock[],
  ctx: ConstraintContext,
): ViolationCode[] {
  const out: ViolationCode[] = [];
  const start = timeToMinutes(candidate.start_time);
  const end = timeToMinutes(candidate.end_time);

  // Malformed time → treat as end-before-start; nothing else is meaningful.
  if (start === null || end === null || end <= start) {
    out.push("end_before_start");
    return out;
  }

  // School hours (early-release aware).
  const dayStart = getDayStartMin(ctx.school);
  const dayEnd = getEndMinForDay(candidate.day_of_week, ctx.school);
  if (start < dayStart || end > dayEnd) out.push("outside_hours");

  // Recess / lunch for this grade's band.
  if (candidate.grade) {
    const recess = getRecessWindowsForDay(candidate.day_of_week, ctx.school, ctx.recessConfigs, candidate.grade);
    if (recess.some((w) => start < w.end && end > w.start)) out.push("recess");

    // PLC/Admin grade-range lock — but don't let a block collide with itself
    // if it happens to be a lock (it shouldn't be, but be safe).
    const locks = (ctx.gradeRangeLocks[`${candidate.day_of_week}:${candidate.grade}`] ?? [])
      .filter((iv) => {
        // Exclude the candidate's own interval if it is itself a lock row.
        if (!isGradeLock(candidate)) return true;
        return !(iv[0] === start && iv[1] === end);
      });
    if (overlapsAny(locks, start, end)) out.push("plc");
  }

  // Specialist / teacher double-booking (interval overlap, coinciding weeks).
  for (const o of allBlocks) {
    if (candidate.id && o.id === candidate.id) continue;
    if (o.day_of_week !== candidate.day_of_week) continue;
    if (!weeksCoincide(o.week_label, candidate.week_label)) continue;
    const os = timeToMinutes(o.start_time);
    const oe = timeToMinutes(o.end_time);
    if (os === null || oe === null) continue;
    if (!(start < oe && os < end)) continue;
    if (candidate.specialist_id && o.specialist_id === candidate.specialist_id) {
      if (!out.includes("specialist_double_book")) out.push("specialist_double_book");
    }
    if (candidate.teacher_id && o.teacher_id === candidate.teacher_id) {
      if (!out.includes("teacher_double_book")) out.push("teacher_double_book");
    }
  }

  return out;
}

/** Convenience: true when the candidate has zero violations. */
export function isLegalPlacement(
  candidate: ConstraintBlock,
  allBlocks: ConstraintBlock[],
  ctx: ConstraintContext,
): boolean {
  return violations(candidate, allBlocks, ctx).length === 0;
}

/** Human-readable label for a violation code (for error messages / logs). */
export function describeViolation(code: ViolationCode): string {
  switch (code) {
    case "end_before_start": return "end time is not after start time";
    case "outside_hours": return "falls outside school hours";
    case "recess": return "overlaps a recess/lunch window for this grade";
    case "plc": return "overlaps a PLC/Admin block for this grade";
    case "specialist_double_book": return "double-books the specialist";
    case "teacher_double_book": return "double-books the class/teacher";
  }
}
