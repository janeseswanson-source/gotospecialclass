// Simulated Annealing refinement (extracted from index.ts in Phase 0 —
// behavior-preserving). Single-move local search over a constructive solution:
// swap two same-specialist sessions, relocate one session, or de-cluster a
// (grade,subject,day) duplicate. Every candidate is re-validated by
// computeWarnings (which mirrors the SSOT) and re-scored; Metropolis acceptance
// with geometric cooling.
//
// Invariants preserved here (do not weaken):
//   - Big-Group members (same specialist+grade+identical slot, different
//     teachers, same week) are excluded from mutation so the group never splits.
//   - "Never manufacture an idle day": a specialist's last block on a day may
//     only move within that day.
//   - Every accepted candidate is occupancy-legal (specialist/teacher/grade-lock
//     free) and passes strategyFailed (no error-severity warnings).
//
// NOTE ON THE index.ts CYCLE: this module imports leaf helpers + types from
// index.ts, and index.ts imports runSimulatedAnnealing/buildOccupancyFromBlocks
// back. That import cycle is safe because every cross-module reference here is
// used only inside function bodies (called at runtime), never at module top
// level — so neither module observes the other's bindings before they are
// initialized. (A future cleanup could lift the shared leaf helpers into a
// dependency-free _slots.ts to drop the cycle entirely.)

import { type Rng } from "./_random.ts";
import { scoreSchedule, type ScoreableInput, type ScoreBreakdown } from "./_scoring.ts";
import { type OccupancyTracker } from "./_occupancy.ts";
import {
  DAYS,
  timeToMinutes,
  minutesToTime,
  schoolCanonicalStep,
  getEndMinForDay,
  getRecessWindowsForDay,
  buildTimeSlotsForGrade,
  computeWarnings,
  strategyFailed,
  type Block,
  type Specialist,
  type StrategyResult,
  type PreferenceViolation,
  schoolRotationsStartMin,
} from "./index.ts";

export function buildOccupancyFromBlocks(
  baseOccupancy: OccupancyTracker,
  blocks: Block[],
): OccupancyTracker {
  const occ = baseOccupancy.clone();
  for (const b of blocks) {
    if (!b.specialist_id) continue;
    occ.book(b.day_of_week, timeToMinutes(b.start_time), timeToMinutes(b.end_time), b.specialist_id, b.teacher_id);
  }
  return occ;
}

/** Tuning for a simulated-annealing run. All fields are deterministic inputs;
 *  the same options + same seed ⇒ the same result. */
export interface SAOptions {
  /** Deterministic iteration budget (hard cap on the cooling loop). The actual
   *  count is governed by min(maxIterations, iters-to-reach-T_MIN) — a pure
   *  function of the config, NOT of wall-clock. Default 1000 (legacy behavior). */
  maxIterations?: number;
  /** Wall-clock SAFETY cutoff in ms. This is a last-resort guard against a
   *  pathological runaway (e.g. a scorer that hangs); for the configured
   *  iteration budget it is NEVER reached in normal operation, so it never
   *  changes output. Checked only periodically. Default 30000. */
  safetyMs?: number;
  /** Optional extra objective folded into the ACCEPT comparison only (e.g. the
   *  Phase-2 minimal-perturbation penalty). Returns a value ADDED to the
   *  optimizer score when deciding acceptance; the returned `score` stays the
   *  pure scoreSchedule total. Default: no adjustment (exact legacy behavior). */
  objectiveAdjust?: (blocks: Block[]) => number;
}

export function runSimulatedAnnealing(
  initialResult: StrategyResult,
  initialScore: number,
  scoringInput: ScoreableInput,
  specialists: Specialist[],
  grades: string[],
  school: any,
  recessConfigs: any[],
  baseOccupancy: OccupancyTracker,
  rng: Rng,
  weightOverrides?: Partial<Record<keyof ScoreBreakdown, number>>,
  opts?: SAOptions,
): { blocks: Block[]; preferenceViolations: PreferenceViolation[]; score: number; iterations: number; improvement: number } {
  // Phase 1a — DETERMINISM: the iteration budget is a fixed, seeded count
  // (maxIterations) and the cooling schedule is deterministic, so the same seed
  // yields the same result. The previous wall-clock budget (SA_TIME_BUDGET_MS)
  // made the iteration count depend on machine speed — removed. Wall-clock now
  // only acts as a never-reached safety valve (SA_SAFETY_MS), checked
  // periodically, that does not change output for in-budget runs.
  const SA_MAX_ITER = Math.max(0, opts?.maxIterations ?? 1000);
  const SA_T_START = 50;
  const SA_COOLING = 0.985;
  const SA_T_MIN = 0.5;
  const SA_SAFETY_MS = opts?.safetyMs ?? 30000;
  // Default no-op ⇒ accept comparison is exactly the pure score delta (legacy).
  const adjust = opts?.objectiveAdjust ?? (() => 0);

  let currentBlocks = initialResult.blocks.slice();
  let currentViolations = initialResult.preferenceViolations.slice();
  let currentScore = initialScore;
  let T = SA_T_START;
  let iterations = 0;
  const t0 = performance.now();

  const classStartMin = schoolRotationsStartMin(school);

  // Big-Group sessions (same specialist + grade + exact slot, different
  // teachers, same week) are taught TOGETHER. SA must never move one member
  // independently or the group splits across slots — so we exclude every
  // combined-group member from the mutation candidate set. Computed once: these
  // blocks are never mutated, so the object references stay valid across
  // iterations (move/swap only replace the blocks they touch).
  const combinedMembers = new Set<Block>();
  for (const b of currentBlocks) {
    if (!b.specialist_id || !b.teacher_id) continue;
    for (const o of currentBlocks) {
      if (o === b) continue;
      if (
        o.specialist_id === b.specialist_id && o.grade === b.grade &&
        o.day_of_week === b.day_of_week && o.start_time === b.start_time &&
        o.end_time === b.end_time && o.teacher_id !== b.teacher_id &&
        (o.week_label ?? null) === (b.week_label ?? null)
      ) { combinedMembers.add(b); break; }
    }
  }

  for (let iter = 0; iter < SA_MAX_ITER && T >= SA_T_MIN; iter++) {
    // SAFETY VALVE ONLY (see SAOptions.safetyMs). Checked every 128 iterations
    // so it cannot act as a fine-grained budget. For the configured iteration
    // budget this is never reached, so it does not affect output / determinism.
    if ((iter & 127) === 0 && performance.now() - t0 > SA_SAFETY_MS) {
      console.warn(`[SA] safety cutoff at iter ${iter}/${SA_MAX_ITER} after ${SA_SAFETY_MS}ms — lower maxIterations for inline use`);
      break;
    }
    iterations++;

    // Only mutate real teaching blocks (not lunch/planning/admin/combined-group blocks)
    const teachingBlocks = currentBlocks.filter(b =>
      b.specialist_id && b.teacher_id && b.grade !== "Lunch" && b.grade !== "Planning" && b.grade !== "Makeup" &&
      !combinedMembers.has(b)
    );
    if (teachingBlocks.length < 2) break;

    // Choose mutation type: 0 = swap, 1 = move, 2 = anti-cluster shuffle
    const mutationType = Math.floor(rng() * 3);
    let candidateBlocks: Block[] | null = null;

    if (mutationType === 0) {
      // SWAP: pick two blocks with same specialist but different teachers
      const bySpec: Record<string, Block[]> = {};
      for (const b of teachingBlocks) {
        if (!b.specialist_id) continue;
        (bySpec[b.specialist_id] ??= []).push(b);
      }
      const eligibleSpecs = Object.entries(bySpec).filter(([, bs]) => {
        const uniqueTeachers = new Set(bs.map(b => b.teacher_id)).size;
        return uniqueTeachers >= 2;
      });
      if (eligibleSpecs.length === 0) { T *= SA_COOLING; continue; }

      const [, specBlocks] = eligibleSpecs[Math.floor(rng() * eligibleSpecs.length)];
      const idxA = Math.floor(rng() * specBlocks.length);
      let idxB = Math.floor(rng() * (specBlocks.length - 1));
      if (idxB >= idxA) idxB++;
      const blockA = specBlocks[idxA];
      const blockB = specBlocks[idxB];
      if (blockA.teacher_id === blockB.teacher_id) { T *= SA_COOLING; continue; }

      // Build occupancy without blockA and blockB
      const testBlocks = currentBlocks.filter(b => b !== blockA && b !== blockB);
      const occ = buildOccupancyFromBlocks(baseOccupancy, testBlocks);

      // Try swap: A gets B's slot, B gets A's slot
      const newA: Block = { ...blockA, day_of_week: blockB.day_of_week, start_time: blockB.start_time, end_time: blockB.end_time };
      const newB: Block = { ...blockB, day_of_week: blockA.day_of_week, start_time: blockA.start_time, end_time: blockA.end_time };

      const aStart = timeToMinutes(newA.start_time);
      const aEnd = timeToMinutes(newA.end_time);
      const bStart = timeToMinutes(newB.start_time);
      const bEnd = timeToMinutes(newB.end_time);

      if (!occ.isSpecialistFree(newA.day_of_week, aStart, aEnd, newA.specialist_id!)) { T *= SA_COOLING; continue; }
      if (newA.teacher_id && !occ.isTeacherFree(newA.day_of_week, aStart, aEnd, newA.teacher_id)) { T *= SA_COOLING; continue; }
      if (!occ.isGradeRangeFree(newA.day_of_week, newA.grade, aStart, aEnd)) { T *= SA_COOLING; continue; }

      occ.book(newA.day_of_week, aStart, aEnd, newA.specialist_id!, newA.teacher_id);
      if (!occ.isSpecialistFree(newB.day_of_week, bStart, bEnd, newB.specialist_id!)) { T *= SA_COOLING; continue; }
      if (newB.teacher_id && !occ.isTeacherFree(newB.day_of_week, bStart, bEnd, newB.teacher_id)) { T *= SA_COOLING; continue; }
      if (!occ.isGradeRangeFree(newB.day_of_week, newB.grade, bStart, bEnd)) { T *= SA_COOLING; continue; }

      candidateBlocks = currentBlocks.map(b => b === blockA ? newA : b === blockB ? newB : b);
    } else if (mutationType === 1) {
      // MOVE: pick one block and relocate to a free slot for same (specialist, teacher)
      const blockToMove = teachingBlocks[Math.floor(rng() * teachingBlocks.length)];
      const spec = specialists.find(s => s.id === blockToMove.specialist_id);
      if (!spec) { T *= SA_COOLING; continue; }

      const duration = timeToMinutes(blockToMove.end_time) - timeToMinutes(blockToMove.start_time);
      let workDays = (spec.working_days ?? DAYS).filter(d => DAYS.includes(d));
      if (workDays.length === 0) { T *= SA_COOLING; continue; }

      // Never manufacture an idle day: if this is the specialist's LAST block
      // on its day, it may only move within that day, not to another one.
      const isLastOnDay = !teachingBlocks.some(
        (b) => b !== blockToMove && b.specialist_id === blockToMove.specialist_id && b.day_of_week === blockToMove.day_of_week,
      );
      if (isLastOnDay) workDays = [blockToMove.day_of_week];

      // Build candidate free slots across all working days
      const testBlocks = currentBlocks.filter(b => b !== blockToMove);
      const occ = buildOccupancyFromBlocks(baseOccupancy, testBlocks);

      // Candidate starts = the grade's period grid ∪ start times already used
      // on that day. The union keeps SA's balancing freedom (it can slide into
      // any existing "row" on any day) while never inventing a NEW off-grid
      // start time — this keeps the printed grid to a handful of clean rows
      // instead of dozens of 5-minute-offset ones.
      const saPassing = school.passing_time ?? 5;
      const saCanonicalStep = schoolCanonicalStep(school);
      const saSetup = school.setup_time ?? 15;
      const saGradeTimeConfig = (school.grade_time_config as Record<string, { passingTime?: number; resetTime?: number }>) ?? {};
      const freeSlots: Array<{ day: string; start: number; end: number }> = [];
      for (const day of workDays) {
        const endMin = getEndMinForDay(day, school);
        const recessWindows = getRecessWindowsForDay(day, school, recessConfigs, blockToMove.grade);
        const candidateStarts = new Set<number>(
          buildTimeSlotsForGrade(
            blockToMove.grade, duration, classStartMin, endMin,
            saPassing, saSetup, saGradeTimeConfig, recessWindows, saCanonicalStep,
          ).map((sl) => sl.start),
        );
        for (const b of currentBlocks) {
          if (b.day_of_week === day) candidateStarts.add(timeToMinutes(b.start_time));
        }
        for (const s of [...candidateStarts].sort((x, y) => x - y)) {
          const e = s + duration;
          if (s < classStartMin || e > endMin) continue;
          if (recessWindows.some(r => s < r.end && e > r.start)) continue;
          if (!occ.isSpecialistFree(day, s, e, blockToMove.specialist_id!)) continue;
          if (blockToMove.teacher_id && !occ.isTeacherFree(day, s, e, blockToMove.teacher_id)) continue;
          if (!occ.isGradeRangeFree(day, blockToMove.grade, s, e)) continue;
          freeSlots.push({ day, start: s, end: e });
          if (freeSlots.length >= 10) break;
        }
        if (freeSlots.length >= 10) break;
      }
      if (freeSlots.length === 0) { T *= SA_COOLING; continue; }

      const chosen = freeSlots[Math.floor(rng() * freeSlots.length)];
      // Don't move to the same slot
      if (chosen.day === blockToMove.day_of_week &&
          chosen.start === timeToMinutes(blockToMove.start_time)) { T *= SA_COOLING; continue; }

      const newBlock: Block = {
        ...blockToMove,
        day_of_week: chosen.day,
        start_time: minutesToTime(chosen.start),
        end_time: minutesToTime(chosen.end),
      };
      candidateBlocks = currentBlocks.map(b => b === blockToMove ? newBlock : b);
    } else {
      // ANTI-CLUSTER SHUFFLE: find a (grade, subject, day) duplicate and
      // relocate one occurrence to a day that doesn't already have that
      // subject for the grade. Directly attacks subject_day_clustering.
      const subjDayMap = new Map<string, Block[]>();
      const gradeSubjDays = new Map<string, Set<string>>();
      for (const b of teachingBlocks) {
        const k = `${b.grade}|${b.subject ?? ""}|${b.day_of_week}`;
        (subjDayMap.get(k) ?? subjDayMap.set(k, []).get(k)!).push(b);
        const gk = `${b.grade}|${b.subject ?? ""}`;
        (gradeSubjDays.get(gk) ?? gradeSubjDays.set(gk, new Set()).get(gk)!).add(b.day_of_week);
      }
      const dupGroups: Block[][] = [];
      for (const g of subjDayMap.values()) if (g.length >= 2) dupGroups.push(g);
      if (dupGroups.length === 0) { T *= SA_COOLING; continue; }

      const group = dupGroups[Math.floor(rng() * dupGroups.length)];
      const blockToMove = group[Math.floor(rng() * group.length)];
      const spec = specialists.find(s => s.id === blockToMove.specialist_id);
      if (!spec) { T *= SA_COOLING; continue; }
      // Never strand a specialist on an idle day: if this is the only block
      // on this day for this specialist, skip — matches the MOVE guard.
      const isLastOnDay = !teachingBlocks.some(
        (b) => b !== blockToMove && b.specialist_id === blockToMove.specialist_id && b.day_of_week === blockToMove.day_of_week,
      );
      if (isLastOnDay) { T *= SA_COOLING; continue; }
      const usedDays = gradeSubjDays.get(`${blockToMove.grade}|${blockToMove.subject ?? ""}`) ?? new Set();
      const duration = timeToMinutes(blockToMove.end_time) - timeToMinutes(blockToMove.start_time);
      const workDays = (spec.working_days ?? DAYS).filter(d => DAYS.includes(d) && !usedDays.has(d));
      if (workDays.length === 0) { T *= SA_COOLING; continue; }


      const testBlocks = currentBlocks.filter(b => b !== blockToMove);
      const occ = buildOccupancyFromBlocks(baseOccupancy, testBlocks);
      const saPassing = school.passing_time ?? 5;
      const saCanonicalStep = schoolCanonicalStep(school);
      const saSetup = school.setup_time ?? 15;
      const saGradeTimeConfig = (school.grade_time_config as Record<string, { passingTime?: number; resetTime?: number }>) ?? {};
      const freeSlots: Array<{ day: string; start: number; end: number }> = [];
      for (const day of workDays) {
        const endMin = getEndMinForDay(day, school);
        const recessWindows = getRecessWindowsForDay(day, school, recessConfigs, blockToMove.grade);
        const candidateStarts = new Set<number>(
          buildTimeSlotsForGrade(blockToMove.grade, duration, classStartMin, endMin, saPassing, saSetup, saGradeTimeConfig, recessWindows, saCanonicalStep).map(sl => sl.start),
        );
        for (const b of currentBlocks) if (b.day_of_week === day) candidateStarts.add(timeToMinutes(b.start_time));
        for (const s of [...candidateStarts].sort((x, y) => x - y)) {
          const e = s + duration;
          if (s < classStartMin || e > endMin) continue;
          if (recessWindows.some(r => s < r.end && e > r.start)) continue;
          if (!occ.isSpecialistFree(day, s, e, blockToMove.specialist_id!)) continue;
          if (blockToMove.teacher_id && !occ.isTeacherFree(day, s, e, blockToMove.teacher_id)) continue;
          if (!occ.isGradeRangeFree(day, blockToMove.grade, s, e)) continue;
          freeSlots.push({ day, start: s, end: e });
          if (freeSlots.length >= 10) break;
        }
        if (freeSlots.length >= 10) break;
      }
      if (freeSlots.length === 0) { T *= SA_COOLING; continue; }
      const chosen = freeSlots[Math.floor(rng() * freeSlots.length)];
      const newBlock: Block = {
        ...blockToMove,
        day_of_week: chosen.day,
        start_time: minutesToTime(chosen.start),
        end_time: minutesToTime(chosen.end),
      };
      candidateBlocks = currentBlocks.map(b => b === blockToMove ? newBlock : b);
    }

    if (!candidateBlocks) { T *= SA_COOLING; continue; }

    // Score the candidate
    const candWarnings = computeWarnings(candidateBlocks, specialists, grades);
    if (strategyFailed(candWarnings)) { T *= SA_COOLING; continue; }

    const candScore = scoreSchedule(
      { blocks: candidateBlocks, warnings: candWarnings, preferenceViolations: currentViolations },
      scoringInput,
      weightOverrides,
    ).total;

    // Accept on the ADJUSTED objective (pure score + objectiveAdjust). With the
    // default no-op adjust this is identical to the pure score delta.
    const delta = (candScore + adjust(candidateBlocks)) - (currentScore + adjust(currentBlocks));
    if (delta > 0 || rng() < Math.exp(delta / T)) {
      currentBlocks = candidateBlocks;
      currentScore = candScore;
    }

    T *= SA_COOLING;
  }

  return {
    blocks: currentBlocks,
    preferenceViolations: currentViolations,
    score: currentScore,
    iterations,
    improvement: currentScore - initialScore,
  };
}
