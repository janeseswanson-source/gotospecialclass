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

/** Convert recess_lunch_config rows into RecessBand objects for the grid. */
export function buildRecessBands(rows: any[]): RecessBand[] {
  const bands: RecessBand[] = [];
  rows.forEach((r, i) => {
    const band = r.grade_band && r.grade_band !== "all" ? ` (${r.grade_band})` : "";
    if (r.am_recess_start && r.am_recess_end) {
      bands.push({ id: `am-${r.id ?? i}`, label: `AM Recess${band}`, start_time: r.am_recess_start, end_time: r.am_recess_end });
    }
    if (r.lunch_start && r.lunch_end) {
      bands.push({ id: `lunch-${r.id ?? i}`, label: `Lunch${band}`, start_time: r.lunch_start, end_time: r.lunch_end });
    }
    if (r.pm_recess_start && r.pm_recess_end) {
      bands.push({ id: `pm-${r.id ?? i}`, label: `PM Recess${band}`, start_time: r.pm_recess_start, end_time: r.pm_recess_end });
    }
  });
  return bands;
}

/** Compute conflict IDs (same specialist or same teacher overlapping on the same day). */
export function computeConflictIds(blocks: BlockData[]): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      if (a.day_of_week !== b.day_of_week) continue;
      const overlaps = parseTime(a.start_time) < parseTime(b.end_time) && parseTime(b.start_time) < parseTime(a.end_time);
      if (!overlaps) continue;
      const sameSpec = a.specialist_name && a.specialist_name === b.specialist_name;
      const sameTeacher = a.teacher_name && a.teacher_name === b.teacher_name;
      // Different week labels (A vs B) are allowed to share a slot
      const sameWeek = (a.week_label ?? null) === (b.week_label ?? null);
      if ((sameSpec || sameTeacher) && sameWeek) {
        ids.add(a.id);
        ids.add(b.id);
      }
    }
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
