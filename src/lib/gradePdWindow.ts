// Grade-level PD window, measured on the client for display.
//
// MIRRORS `supabase/functions/generate-schedule/_teamtime.ts`. The engine
// scores and warns on this; the Admin View and exports SHOW it. Keeping a
// small mirror here (rather than round-tripping through the database) means
// the band renders for a schedule generated before the feature existed —
// exactly the situation every existing school is in.
//
// If you change the definition, change it in both files. `gradePdWindow.test.ts`
// pins the shared cases.

const RESERVED_GRADES = new Set(['lunch', 'planning', 'makeup', 'all', '']);

/** Adjacent blocks closer than this read as one continuous stretch. */
export const RUN_GAP_MAX_MIN = 15;

export interface PdBlock {
  day_of_week: string;
  start_time: string;
  end_time: string;
  grade?: string | null;
  specialist_id?: string | null;
  teacher_id?: string | null;
  week_label?: string | null;
}

export interface PdTeacher {
  id: string;
  grade?: string | null;
}

export interface GradePdWindow {
  grade: string;
  day: string;
  weekLabel: string;
  /** Longest stretch with the grade's whole team (or quorum) out at once. */
  minutes: number;
  startMin: number | null;
  endMin: number | null;
  classCount: number;
  outCount: number;
}

function toMin(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Same rule as the engine's weeksCoincide: an unlabelled block runs every week. */
function weeksCoincide(a: string | null, b: string | null): boolean {
  if (a === null || b === null || a === 'all' || b === 'all') return true;
  return a === b;
}

function mergeRuns(intervals: Array<{ start: number; end: number }>) {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const runs = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = runs[runs.length - 1];
    if (sorted[i].start - cur.end <= RUN_GAP_MAX_MIN) cur.end = Math.max(cur.end, sorted[i].end);
    else runs.push({ ...sorted[i] });
  }
  return runs;
}

function longestWithCoverage(runsByTeacher: Array<Array<{ start: number; end: number }>>, need: number) {
  const events: Array<{ t: number; delta: number }> = [];
  for (const runs of runsByTeacher) {
    for (const r of runs) {
      if (r.end <= r.start) continue;
      events.push({ t: r.start, delta: 1 }, { t: r.end, delta: -1 });
    }
  }
  if (events.length === 0 || need <= 0) return { minutes: 0, start: null as number | null, end: null as number | null, peak: 0 };
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);

  let coverage = 0, peak = 0, bestMin = 0;
  let bestStart: number | null = null, bestEnd: number | null = null, segStart: number | null = null;
  for (const ev of events) {
    const was = coverage >= need;
    coverage += ev.delta;
    peak = Math.max(peak, coverage);
    const is = coverage >= need;
    if (!was && is) segStart = ev.t;
    else if (was && !is && segStart !== null) {
      if (ev.t - segStart > bestMin) { bestMin = ev.t - segStart; bestStart = segStart; bestEnd = ev.t; }
      segStart = null;
    }
  }
  return { minutes: bestMin, start: bestStart, end: bestEnd, peak };
}

/**
 * The PD window each grade gets, keyed by grade. Across A/B weeks a window
 * only counts if it recurs in every label (the weakest link); within that, the
 * grade's best day wins.
 */
export function gradePdWindows(
  blocks: PdBlock[],
  teachers: PdTeacher[],
  accompaniedSpecialistIds: Set<string> = new Set(),
  quorumPct = 100,
): Map<string, GradePdWindow> {
  const pct = Math.min(100, Math.max(1, quorumPct));
  const teachersByGrade = new Map<string, string[]>();
  for (const t of teachers) {
    const g = String(t.grade ?? '').trim();
    if (!g || RESERVED_GRADES.has(g.toLowerCase())) continue;
    (teachersByGrade.get(g) ?? teachersByGrade.set(g, []).get(g)!).push(t.id);
  }

  const labels = new Set<string>();
  for (const b of blocks) if (b.week_label) labels.add(b.week_label);
  const labelList = labels.size > 0 ? [...labels] : [''];
  const days = new Set(blocks.map((b) => b.day_of_week).filter(Boolean));

  const perGradeDay = new Map<string, GradePdWindow[]>();
  for (const [grade, ids] of teachersByGrade) {
    const quorumMin = Math.max(1, Math.ceil((ids.length * pct) / 100));
    for (const day of days) {
      for (const label of labelList) {
        const runsByTeacher: Array<Array<{ start: number; end: number }>> = [];
        for (const tid of ids) {
          const intervals = blocks
            .filter((b) =>
              b.teacher_id === tid &&
              b.specialist_id &&
              b.day_of_week === day &&
              weeksCoincide(b.week_label ?? null, label || null) &&
              !RESERVED_GRADES.has(String(b.grade ?? '').trim().toLowerCase()) &&
              !accompaniedSpecialistIds.has(b.specialist_id))
            .map((b) => ({ start: toMin(b.start_time), end: toMin(b.end_time) }));
          const runs = mergeRuns(intervals);
          if (runs.length > 0) runsByTeacher.push(runs);
        }
        const { minutes, start, end, peak } = longestWithCoverage(runsByTeacher, quorumMin);
        if (minutes === 0) continue;
        const key = `${grade}|${day}`;
        (perGradeDay.get(key) ?? perGradeDay.set(key, []).get(key)!).push({
          grade, day, weekLabel: label, minutes, startMin: start, endMin: end,
          classCount: ids.length, outCount: peak,
        });
      }
    }
  }

  const best = new Map<string, GradePdWindow>();
  for (const list of perGradeDay.values()) {
    // Weakest label = what the grade can rely on every week.
    const weakest = list.reduce((acc, w) => (w.minutes < acc.minutes ? w : acc), list[0]);
    // A day is only a real window if it holds in EVERY active label.
    if (list.length < labelList.length) continue;
    const cur = best.get(weakest.grade);
    if (!cur || weakest.minutes > cur.minutes) best.set(weakest.grade, weakest);
  }
  return best;
}
