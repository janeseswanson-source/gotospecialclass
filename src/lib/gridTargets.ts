// gridTargets — the ONE pure, SSOT-mirroring decision function for "can this
// block land on that (day, slot)?" It is shared by:
//   • the @dnd-kit drag wash (paint legal targets green, show the reason on
//     illegal hover), computed once per drag via `legalTargets`, and
//   • the commit path in MasterSchedulePage (`handleBlockDrop`), via `evaluateDrop`,
// so the highlight can never disagree with what actually happens on drop.
//
// The UI still never *invents* a placement: this only mirrors the SSOT rules the
// engine also enforces (interval overlap per specialist/teacher, recess/lunch
// bands, school hours). Conflict *fixes* still go through resolve-conflicts-ai.
import type { BlockData, RecessBand } from "@/components/schedule/ScheduleGrid";
import {
  computeAutoFit,
  computeConflictIds,
  computeConflictPairs,
  parseTime,
  swapPlacements,
} from "./scheduleGrid";

export interface GridConstraints {
  recessBands: RecessBand[];
  schoolStart?: string | null;
  schoolEnd?: string | null;
}

/** A placement to persist for one block (matches the schedule_blocks update shape). */
export interface BlockChange {
  id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  is_override: true;
}

export type DropKind = "move" | "swap" | "self" | "locked";

export interface DropEval {
  kind: DropKind;
  legal: boolean;
  /** Human reason when illegal (used in the drag tooltip + toast). */
  reason?: string;
  /** True when a move was shortened to fit the available gap. */
  shortened?: boolean;
  shortenedTo?: number;
  /** The optimistic placements to apply + persist (present when legal). */
  changes?: BlockChange[];
}

/**
 * Why a candidate arrangement is illegal for the moved block(s): a same
 * specialist/teacher overlap, or landing on recess/lunch/outside school hours.
 * Ported verbatim from MasterSchedulePage so the highlight and the commit agree.
 */
export function placementProblem(
  candidate: BlockData[],
  movedIds: string[],
  c: GridConstraints,
): string | null {
  const conflictIds = computeConflictIds(candidate);
  for (const id of movedIds) {
    if (!conflictIds.has(id)) continue;
    let partner: BlockData | null = null;
    for (const { a, b } of computeConflictPairs(candidate)) {
      if (a.id === id) { partner = b as BlockData; break; }
      if (b.id === id) { partner = a as BlockData; break; }
    }
    const me = candidate.find((x) => x.id === id);
    const who = partner?.teacher_name || partner?.specialist_name || partner?.subject || "another class";
    return `${me?.subject ?? "That block"} would clash with ${who} at the same time. Try an empty slot.`;
  }
  for (const id of movedIds) {
    const b = candidate.find((x) => x.id === id);
    if (!b) continue;
    const s = parseTime(b.start_time), e = parseTime(b.end_time);
    if (c.recessBands.some((band) => s < parseTime(band.end_time) && parseTime(band.start_time) < e)) {
      return `${b.subject ?? "That block"} would land on recess or lunch.`;
    }
    if (c.schoolStart && s < parseTime(c.schoolStart)) return `${b.subject ?? "That block"} would start before school opens.`;
    if (c.schoolEnd && e > parseTime(c.schoolEnd)) return `${b.subject ?? "That block"} would run past the end of the day.`;
  }
  return null;
}

/** The block occupying (day, slot), applying the same week-label + interval rule
 *  the drop handler uses. `null` = the slot is free. */
export function occupantAt(
  block: BlockData,
  allBlocks: BlockData[],
  targetDay: string,
  targetTime: string,
): BlockData | null {
  const t = parseTime(targetTime);
  return (
    allBlocks.find(
      (b) =>
        b.id !== block.id &&
        b.day_of_week === targetDay &&
        !(b.week_label && block.week_label && b.week_label !== block.week_label) &&
        t >= parseTime(b.start_time) && t < parseTime(b.end_time),
    ) ?? null
  );
}

/**
 * Evaluate a single (day, slot) as a drop target for `block`. Pure — the same
 * call decides the green wash and, on drop, the persisted change.
 */
export function evaluateDrop(opts: {
  block: BlockData;
  allBlocks: BlockData[];
  targetDay: string;
  targetTime: string;
  lockedIds?: Set<string>;
} & GridConstraints): DropEval {
  const { block, allBlocks, targetDay, targetTime, lockedIds } = opts;
  const constraints: GridConstraints = {
    recessBands: opts.recessBands,
    schoolStart: opts.schoolStart,
    schoolEnd: opts.schoolEnd,
  };

  if (lockedIds?.has(block.id)) {
    return { kind: "locked", legal: false, reason: "This block is locked. Unlock it first to move it." };
  }

  // The block's own current slot is a no-op, not a target.
  if (block.day_of_week === targetDay && parseTime(block.start_time) === parseTime(targetTime)) {
    return { kind: "self", legal: false };
  }

  const target = occupantAt(block, allBlocks, targetDay, targetTime);

  if (target) {
    // SWAP — each block takes the other's slot but keeps its own length.
    if (lockedIds?.has(target.id)) {
      return { kind: "swap", legal: false, reason: "That block is locked — unlock it to swap." };
    }
    const swapped = swapPlacements(block, target);
    const aNew: BlockChange = { id: block.id, ...swapped.a, is_override: true };
    const bNew: BlockChange = { id: target.id, ...swapped.b, is_override: true };
    const candidate = allBlocks.map((b) =>
      b.id === block.id ? { ...b, ...swapped.a, is_override: true }
        : b.id === target.id ? { ...b, ...swapped.b, is_override: true }
          : b,
    );
    const problem = placementProblem(candidate, [block.id, target.id], constraints);
    if (problem) return { kind: "swap", legal: false, reason: problem };
    return { kind: "swap", legal: true, changes: [aNew, bNew] };
  }

  // MOVE to a free slot — keep length but shrink to fit the next barrier.
  const fit = computeAutoFit({
    movingBlock: block,
    targetDay,
    targetTime,
    allBlocks,
    recessBands: opts.recessBands,
    schoolEnd: opts.schoolEnd,
  });
  if (!fit.ok) return { kind: "move", legal: false, reason: fit.reason };

  const moveNew: BlockChange = { id: block.id, day_of_week: targetDay, start_time: fit.start, end_time: fit.end, is_override: true };
  const candidate = allBlocks.map((b) =>
    b.id === block.id ? { ...b, day_of_week: targetDay, start_time: fit.start, end_time: fit.end, is_override: true } : b,
  );
  const problem = placementProblem(candidate, [block.id], constraints);
  if (problem) return { kind: "move", legal: false, reason: problem };
  return { kind: "move", legal: true, shortened: fit.shortened, shortenedTo: fit.duration, changes: [moveNew] };
}

/**
 * Evaluate EVERY (day, slot) once for a block being dragged — the map the grid
 * paints (legal cells get the green wash; illegal hovers show `.reason`).
 * Keyed by `${day}-${time}` to match the grid's cell keys.
 */
export function legalTargets(opts: {
  block: BlockData;
  allBlocks: BlockData[];
  days: string[];
  timeSlots: string[];
  lockedIds?: Set<string>;
} & GridConstraints): Map<string, DropEval> {
  const map = new Map<string, DropEval>();
  for (const day of opts.days) {
    for (const time of opts.timeSlots) {
      map.set(
        `${day}-${time}`,
        evaluateDrop({
          block: opts.block,
          allBlocks: opts.allBlocks,
          targetDay: day,
          targetTime: time,
          lockedIds: opts.lockedIds,
          recessBands: opts.recessBands,
          schoolStart: opts.schoolStart,
          schoolEnd: opts.schoolEnd,
        }),
      );
    }
  }
  return map;
}
