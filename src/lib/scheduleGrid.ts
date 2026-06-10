// Shared helpers for the Master Schedule grid: time-slot generation,
// recess/lunch band derivation, conflict detection, and auto-fit drop math.
import type { BlockData, RecessBand } from "@/components/schedule/ScheduleGrid";

export const GRID_STEP_MIN = 5;
export const MIN_BLOCK_MIN = 20;

export function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function formatTimeHM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/**
 * Build the left-rail time slots from the school's start/end time.
 * Always returns a complete grid stepped by GRID_STEP_MIN so off-grid blocks
 * (e.g. 8:05) still sit in a slot.
 */
export function buildTimeSlots(
  schoolStart?: string | null,
  schoolEnd?: string | null,
  blocks: BlockData[] = [],
  step: number = GRID_STEP_MIN,
): string[] {
  const blockTimes = blocks.flatMap((b) => [parseTime(b.start_time), parseTime(b.end_time)]);
  let start = schoolStart ? parseTime(schoolStart) : (blockTimes.length ? Math.min(...blockTimes) : 8 * 60);
  let end = schoolEnd ? parseTime(schoolEnd) : (blockTimes.length ? Math.max(...blockTimes) : 15 * 60);
  if (blockTimes.length) {
    start = Math.min(start, ...blockTimes);
    end = Math.max(end, ...blockTimes);
  }
  // Snap to step
  start = Math.floor(start / step) * step;
  end = Math.ceil(end / step) * step;
  const slots: string[] = [];
  for (let t = start; t <= end; t += step) slots.push(formatTimeHM(t));
  return slots;
}

/**
 * Compact time slots: only times where something actually happens
 * (block starts + school start/end + recess bounds). Eliminates rows of
 * empty 5-minute filler.
 */
export function buildCompactTimeSlots(
  schoolStart: string | null | undefined,
  schoolEnd: string | null | undefined,
  blocks: BlockData[] = [],
  recessBands: RecessBand[] = [],
): string[] {
  const set = new Set<number>();
  if (schoolStart) set.add(parseTime(schoolStart));
  if (schoolEnd) set.add(parseTime(schoolEnd));
  blocks.forEach((b) => set.add(parseTime(b.start_time)));
  recessBands.forEach((r) => {
    set.add(parseTime(r.start_time));
    set.add(parseTime(r.end_time));
  });
  if (set.size === 0) return [];
  return Array.from(set).sort((a, b) => a - b).map(formatTimeHM);
}



/** Convert recess_lunch_config rows into RecessBand objects for the grid.
 * Optional `bandLabels` maps `grade_band` keys to a human-readable label
 * (e.g. "Primary 1-3") that the user customized in the wizard.
 */
export function buildRecessBands(rows: any[], bandLabels?: Record<string, string>): RecessBand[] {
  const bands: RecessBand[] = [];
  const labelFor = (key: string) => {
    if (!key || key === "all") return "";
    const custom = bandLabels?.[key];
    return custom ? ` · ${custom}` : ` (${key})`;
  };
  rows.forEach((r, i) => {
    const suffix = labelFor(r.grade_band);
    if (r.am_recess_start && r.am_recess_end) {
      bands.push({ id: `am-${r.id ?? i}`, label: `AM Recess${suffix}`, start_time: r.am_recess_start, end_time: r.am_recess_end });
    }
    if (r.lunch_start && r.lunch_end) {
      bands.push({ id: `lunch-${r.id ?? i}`, label: `Lunch${suffix}`, start_time: r.lunch_start, end_time: r.lunch_end });
    }
    if (r.pm_recess_start && r.pm_recess_end) {
      bands.push({ id: `pm-${r.id ?? i}`, label: `PM Recess${suffix}`, start_time: r.pm_recess_start, end_time: r.pm_recess_end });
    }
  });
  return bands;
}

// --- Conflict detection (single source of truth for grid + warning panel) ---
//
// A "conflict" = two blocks whose time intervals overlap on the same day, in
// coinciding weeks, that share the same specialist OR the same teacher.
// Entities are matched by **id** (falling back to name only when an id is
// absent) so two people with the same display name don't trip phantom
// conflicts — and so 45-min/30-min overlaps at different start minutes are
// still caught (interval overlap, not exact-start equality).

/** Minimal block shape needed for conflict detection. `BlockData` satisfies it. */
export interface ConflictBlock {
  id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  specialist_id?: string | null;
  teacher_id?: string | null;
  specialist_name?: string | null;
  teacher_name?: string | null;
  grade?: string | null;
  week_label?: string | null;
}

/** Same entity when ids are present and equal; else fall back to non-empty name equality. */
function entitiesMatch(aId?: string | null, aName?: string | null, bId?: string | null, bName?: string | null): boolean {
  if (aId && bId) return aId === bId;
  return !!aName && aName === bName;
}

/** A null/empty week label means "every week", so it coincides with any label. */
function weeksCoincide(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return true;
  return a === b;
}

/** True if two blocks' time intervals overlap on the same day in coinciding weeks. */
function intervalsOverlap(a: ConflictBlock, b: ConflictBlock): boolean {
  if (a.day_of_week !== b.day_of_week) return false;
  if (!weeksCoincide(a.week_label, b.week_label)) return false;
  return parseTime(a.start_time) < parseTime(b.end_time) && parseTime(b.start_time) < parseTime(a.end_time);
}

export type ConflictKind = "specialist" | "teacher";

export interface ConflictPair {
  a: ConflictBlock;
  b: ConflictBlock;
  kinds: ConflictKind[];
}

/** All conflicting block pairs, with which entity (specialist/teacher) collides. */
export function computeConflictPairs(blocks: ConflictBlock[]): ConflictPair[] {
  const pairs: ConflictPair[] = [];
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      if (a.id === b.id) continue;
      if (!intervalsOverlap(a, b)) continue;
      const kinds: ConflictKind[] = [];
      if ((a.specialist_id || a.specialist_name) && entitiesMatch(a.specialist_id, a.specialist_name, b.specialist_id, b.specialist_name)) {
        kinds.push("specialist");
      }
      if ((a.teacher_id || a.teacher_name) && entitiesMatch(a.teacher_id, a.teacher_name, b.teacher_id, b.teacher_name)) {
        kinds.push("teacher");
      }
      if (kinds.length) pairs.push({ a, b, kinds });
    }
  }
  return pairs;
}

/** Conflict IDs (same specialist or same teacher overlapping on the same day). */
export function computeConflictIds(blocks: ConflictBlock[]): Set<string> {
  const ids = new Set<string>();
  for (const { a, b } of computeConflictPairs(blocks)) {
    ids.add(a.id);
    ids.add(b.id);
  }
  return ids;
}

export interface AutoFitResult {
  ok: boolean;
  start: string;
  end: string;
  duration: number;
  shortened: boolean;
  reason?: string;
}

/**
 * Snap a dropped block to a new (day, slot) and shrink its duration so it
 * doesn't collide with the next block, recess band, or school end.
 * Returns ok=false with a reason if the available space is below MIN_BLOCK_MIN.
 */
export function computeAutoFit(opts: {
  movingBlock: BlockData;
  targetDay: string;
  targetTime: string;
  allBlocks: BlockData[];
  recessBands: RecessBand[];
  schoolEnd?: string | null;
  minDuration?: number;
}): AutoFitResult {
  const { movingBlock, targetDay, targetTime, allBlocks, recessBands, schoolEnd } = opts;
  const minDuration = opts.minDuration ?? MIN_BLOCK_MIN;
  const desired = parseTime(movingBlock.end_time) - parseTime(movingBlock.start_time);
  const slotStart = parseTime(targetTime);

  // Find earliest barrier strictly after slotStart on this day
  let barrier = schoolEnd ? parseTime(schoolEnd) : Number.POSITIVE_INFINITY;

  allBlocks
    .filter((b) => b.id !== movingBlock.id && b.day_of_week === targetDay)
    .forEach((b) => {
      const bStart = parseTime(b.start_time);
      const bEnd = parseTime(b.end_time);
      // If slotStart is already inside another block, that's a collision: barrier=slotStart
      if (slotStart >= bStart && slotStart < bEnd) {
        barrier = Math.min(barrier, slotStart); // forces avail=0 -> reject
      } else if (bStart >= slotStart) {
        barrier = Math.min(barrier, bStart);
      }
    });

  recessBands.forEach((r) => {
    const rs = parseTime(r.start_time);
    const re = parseTime(r.end_time);
    if (slotStart >= rs && slotStart < re) {
      barrier = Math.min(barrier, slotStart);
    } else if (rs >= slotStart) {
      barrier = Math.min(barrier, rs);
    }
  });

  const avail = barrier - slotStart;
  if (avail < minDuration) {
    return {
      ok: false,
      start: targetTime,
      end: targetTime,
      duration: 0,
      shortened: false,
      reason: avail <= 0 ? "Slot is occupied" : `Only ${avail} min available (min ${minDuration})`,
    };
  }

  const duration = Math.min(desired, avail);
  return {
    ok: true,
    start: formatTimeHM(slotStart),
    end: formatTimeHM(slotStart + duration),
    duration,
    shortened: duration < desired,
  };
}
