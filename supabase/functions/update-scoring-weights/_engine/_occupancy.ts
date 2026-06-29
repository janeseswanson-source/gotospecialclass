// Occupancy tracker (extracted from index.ts in Phase 0 — behavior-preserving).
//
// Interval-based: every booking is a half-open [start, end) minute range
// keyed by `${day}:${id}`. Availability is tested by real time-overlap,
// NOT by an exact start-minute match. This is the linchpin correctness
// fix — without it, two blocks of different durations (Quick 30, events,
// locked blocks, AI-resolver inserts) could share time on the same
// specialist/teacher and never be detected as a conflict.
//
// This mirrors the legality rules of the SSOT validator
// (_shared/constraints.ts) for in-generation placement: specialist/teacher
// double-book and PLC/Admin grade-range locks. The SSOT remains the gate for
// everything that PERSISTS; this tracker is the fast in-loop mirror.

export type Interval = [number, number];

export function intervalsOverlap(ranges: Interval[] | undefined, start: number, end: number): boolean {
  if (!ranges) return false;
  for (const [s, e] of ranges) {
    if (start < e && end > s) return true;
  }
  return false;
}

export class OccupancyTracker {
  // key `${day}:${specId}` → booked intervals for that specialist that day.
  private specialist: Record<string, Interval[]> = {};
  // key `${day}:${teacherId}` → booked intervals for that teacher/class.
  private teacher: Record<string, Interval[]> = {};
  // FIX-P1-6: grade-range locks (PLC/Admin blocks for a grade — no
  // specialist may teach that grade during any overlapping slot).
  // Stored per `day:grade` as a list of [start, end) minute ranges.
  private gradeRanges: Record<string, Interval[]> = {};

  isSpecialistFree(day: string, slotStart: number, slotEnd: number, specId: string): boolean {
    return !intervalsOverlap(this.specialist[`${day}:${specId}`], slotStart, slotEnd);
  }

  isTeacherFree(day: string, slotStart: number, slotEnd: number, teacherId: string): boolean {
    return !intervalsOverlap(this.teacher[`${day}:${teacherId}`], slotStart, slotEnd);
  }

  book(day: string, slotStart: number, slotEnd: number, specId: string, teacherId: string | null) {
    (this.specialist[`${day}:${specId}`] ??= []).push([slotStart, slotEnd]);
    if (teacherId) {
      (this.teacher[`${day}:${teacherId}`] ??= []).push([slotStart, slotEnd]);
    }
  }

  // FIX-P1-6: lock an entire (day, grade, [start,end)) range for any
  // specialist scheduling — used for PLC/Admin blocks.
  bookGradeRange(day: string, grade: string, start: number, end: number) {
    (this.gradeRanges[`${day}:${grade}`] ??= []).push([start, end]);
  }

  isGradeRangeFree(day: string, grade: string, slotStart: number, slotEnd: number): boolean {
    return !intervalsOverlap(this.gradeRanges[`${day}:${grade}`], slotStart, slotEnd);
  }

  // Prompt-2: deep-copy so each strategy attempt starts from the same
  // pre-seeded baseline (admin/PLC + lunch + event blocks) without
  // mutations leaking across attempts.
  clone(): OccupancyTracker {
    const copy = new OccupancyTracker();
    for (const [k, v] of Object.entries(this.specialist)) copy.specialist[k] = v.map((r) => [r[0], r[1]] as Interval);
    for (const [k, v] of Object.entries(this.teacher)) copy.teacher[k] = v.map((r) => [r[0], r[1]] as Interval);
    for (const [k, v] of Object.entries(this.gradeRanges)) copy.gradeRanges[k] = v.map((r) => [r[0], r[1]] as Interval);
    return copy;
  }

  /** Count of blocks booked for a specialist on a given day (interval count). */
  getSpecialistDayCount(day: string, specId: string): number {
    return this.specialist[`${day}:${specId}`]?.length ?? 0;
  }
}
