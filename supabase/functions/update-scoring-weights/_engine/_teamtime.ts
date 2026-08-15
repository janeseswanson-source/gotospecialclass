// _teamtime — how long a GRADE's classroom teachers are out of their rooms.
//
// One measurement serves two opposing bounds, so they can never disagree:
//
//   allOutMin        the longest stretch in which EVERY teacher of the grade is
//                    simultaneously at specials. This is the grade-level PD
//                    window the PM wants scheduled — "try to allow a block of
//                    time rotations the grade level is together for PD".
//                    Bigger is better, up to the target (90 or 120 min).
//
//   maxTeacherRunMin the longest back-to-back stretch any ONE teacher of the
//                    grade is out. This is the principal's objection — "5th
//                    grade all day no classroom teacher" — and is CAPPED.
//
// Computing both from the same intervals is what stops the target and the cap
// from being measured differently and quietly fighting each other.
//
// A block only frees a teacher when the teacher is NOT expected to attend:
// `teacher_accompanies` specialists (Library/Garden-style) keep the teacher in
// the room, so they neither free the grade for PD nor count toward the cap.

import { weeksCoincide, type Block } from "./index.ts";

/** Reserved pseudo-grades that never represent a class being out. */
const RESERVED_GRADES = new Set(["lunch", "planning", "makeup", "all", ""]);

/** Two adjacent blocks with a gap this small read as one continuous stretch. */
export const RUN_GAP_MAX_MIN = 15;

export interface TeamTimeTeacher {
  id: string;
  grade?: string | null;
}

export interface TeamTimeSpecialist {
  id: string;
  teacher_accompanies?: boolean | null;
}

export interface TeamTimeOptions {
  /** Percent of a grade's classes that must be out to count as a window.
   *  100 = every class (default). 80 lets 4-of-5 count — see the notes on
   *  over-rotated grades below. */
  quorumPct?: number;
}

export interface GradeOutWindow {
  grade: string;
  day: string;
  /** "" for an unlabelled (every-week) schedule. */
  weekLabel: string;
  /** Longest stretch with at least `quorumMin` of the grade's classes out. */
  allOutMin: number;
  /** Clock times of that stretch, for display. */
  startMin: number | null;
  endMin: number | null;
  /** Longest back-to-back stretch for any single teacher of the grade. */
  maxTeacherRunMin: number;
  /** How many classes had to be out at once to count. */
  quorumMin: number;
  /** Classes in the grade (teachers, not blocks). */
  classCount: number;
  /** Classes that were out at the peak of the window. */
  outCount: number;
}

function toMin(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Merge a teacher's blocks into continuous runs (gap <= RUN_GAP_MAX_MIN). */
function mergeRuns(intervals: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const runs: Array<{ start: number; end: number }> = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = runs[runs.length - 1];
    if (sorted[i].start - cur.end <= RUN_GAP_MAX_MIN) {
      cur.end = Math.max(cur.end, sorted[i].end);
    } else {
      runs.push({ ...sorted[i] });
    }
  }
  return runs;
}

/**
 * Longest sub-interval covered by at least `need` of the given runs.
 * Classic sweep: +1 at each start, −1 at each end, in time order.
 */
function longestWithCoverage(
  runsByTeacher: Array<Array<{ start: number; end: number }>>,
  need: number,
): { minutes: number; start: number | null; end: number | null; peak: number } {
  type Ev = { t: number; delta: number };
  const events: Ev[] = [];
  for (const runs of runsByTeacher) {
    for (const r of runs) {
      if (r.end <= r.start) continue;
      events.push({ t: r.start, delta: 1 });
      events.push({ t: r.end, delta: -1 });
    }
  }
  if (events.length === 0 || need <= 0) return { minutes: 0, start: null, end: null, peak: 0 };
  // Ends before starts at the same instant: two blocks that merely touch do
  // not overlap.
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);

  let coverage = 0;
  let peak = 0;
  let bestMin = 0;
  let bestStart: number | null = null;
  let bestEnd: number | null = null;
  let segStart: number | null = null;

  for (const ev of events) {
    const wasEnough = coverage >= need;
    coverage += ev.delta;
    peak = Math.max(peak, coverage);
    const isEnough = coverage >= need;
    if (!wasEnough && isEnough) {
      segStart = ev.t;
    } else if (wasEnough && !isEnough && segStart !== null) {
      const span = ev.t - segStart;
      if (span > bestMin) {
        bestMin = span;
        bestStart = segStart;
        bestEnd = ev.t;
      }
      segStart = null;
    }
  }
  return { minutes: bestMin, start: bestStart, end: bestEnd, peak };
}

/**
 * Per (grade, day, week label): the grade-wide out-of-class window and the
 * worst single-teacher run. Grades with no classes are skipped.
 */
export function computeGradeOutWindows(
  blocks: Block[],
  teachers: TeamTimeTeacher[],
  specialists: TeamTimeSpecialist[],
  opts: TeamTimeOptions = {},
): GradeOutWindow[] {
  const quorumPct = Math.min(100, Math.max(1, Number(opts.quorumPct ?? 100)));
  const accompanied = new Set(
    specialists.filter((s) => s.teacher_accompanies).map((s) => s.id),
  );

  // Grade -> its teachers (each teacher is one class).
  const teachersByGrade = new Map<string, string[]>();
  for (const t of teachers) {
    const g = String(t.grade ?? "").trim();
    if (!g || RESERVED_GRADES.has(g.toLowerCase())) continue;
    (teachersByGrade.get(g) ?? teachersByGrade.set(g, []).get(g)!).push(t.id);
  }
  if (teachersByGrade.size === 0) return [];

  // Every week label in play; a label-less block runs in all of them.
  const labels = new Set<string>();
  for (const b of blocks) if (b.week_label) labels.add(b.week_label);
  const labelList = labels.size > 0 ? [...labels] : [""];

  const days = new Set<string>();
  for (const b of blocks) if (b.day_of_week) days.add(b.day_of_week);

  const out: GradeOutWindow[] = [];
  for (const [grade, teacherIds] of teachersByGrade) {
    const classCount = teacherIds.length;
    // ceil so 100% really means everyone, and 80% of 5 is 4.
    const quorumMin = Math.max(1, Math.ceil((classCount * quorumPct) / 100));

    for (const day of days) {
      for (const label of labelList) {
        const runsByTeacher: Array<Array<{ start: number; end: number }>> = [];
        let maxTeacherRunMin = 0;

        for (const tid of teacherIds) {
          const intervals: Array<{ start: number; end: number }> = [];
          for (const b of blocks) {
            if (b.teacher_id !== tid) continue;
            if (!b.specialist_id) continue;
            if (b.day_of_week !== day) continue;
            if (!weeksCoincide(b.week_label ?? null, label || null)) continue;
            if (RESERVED_GRADES.has(String(b.grade ?? "").trim().toLowerCase())) continue;
            // The teacher stays with this class — they are not free.
            if (accompanied.has(b.specialist_id)) continue;
            intervals.push({ start: toMin(b.start_time), end: toMin(b.end_time) });
          }
          const runs = mergeRuns(intervals);
          for (const r of runs) maxTeacherRunMin = Math.max(maxTeacherRunMin, r.end - r.start);
          if (runs.length > 0) runsByTeacher.push(runs);
        }

        const { minutes, start, end, peak } = longestWithCoverage(runsByTeacher, quorumMin);
        if (minutes === 0 && maxTeacherRunMin === 0) continue; // nothing happened
        out.push({
          grade,
          day,
          weekLabel: label,
          allOutMin: minutes,
          startMin: start,
          endMin: end,
          maxTeacherRunMin,
          quorumMin,
          classCount,
          outCount: peak,
        });
      }
    }
  }
  return out;
}

/**
 * The PD window a grade actually gets each week.
 *
 * Across A/B weeks a window only counts if it recurs in EVERY active label —
 * a slot that exists only in Week A is not a weekly PD block. Within that, the
 * grade's best day wins.
 */
export function bestPdWindowPerGrade(windows: GradeOutWindow[]): Map<string, GradeOutWindow> {
  const byGradeDay = new Map<string, GradeOutWindow[]>();
  for (const w of windows) {
    const k = `${w.grade}|${w.day}`;
    (byGradeDay.get(k) ?? byGradeDay.set(k, []).get(k)!).push(w);
  }

  const best = new Map<string, GradeOutWindow>();
  for (const [k, list] of byGradeDay) {
    const grade = k.split("|")[0];
    // Weakest link across labels: what the grade can rely on EVERY week.
    const weakest = list.reduce((acc, w) => (w.allOutMin < acc.allOutMin ? w : acc), list[0]);
    const cur = best.get(grade);
    if (!cur || weakest.allOutMin > cur.allOutMin) best.set(grade, weakest);
  }
  return best;
}
