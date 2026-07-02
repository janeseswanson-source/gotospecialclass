// Phase 1b — Large Neighborhood Search (ruin-and-recreate) around SA.
//
// Single swap/move/shuffle mutations (SA) get stuck in local optima. LNS escapes
// them by DESTROYING a coherent chunk of the schedule and RECREATING it from
// scratch, which can cross valleys a single move cannot.
//
//   Destroy : remove a coherent subset of teaching sessions —
//             one specialist's whole week, one weekday, or one grade's rotation.
//   Recreate: greedily re-place EXACTLY those sessions into free slots, using the
//             same occupancy-validated slot enumeration the constructive
//             strategies + SA use (so every placement is SSOT-legal).
//   Accept  : Metropolis (occasional uphill) on the running state, but the
//             function RETURNS THE BEST schedule it ever saw — so the result can
//             never score below the input. Quality is monotonic.
//
// Invariants (identical to SA — see _annealing.ts):
//   - Big-Group combined members (same specialist+grade+identical slot, different
//     teachers, same week) are NEVER destroyed, so the group can never split.
//   - "Never manufacture an idle day": a rebuild is rejected unless every
//     specialist keeps at least the working-days-with-blocks they had before
//     (activeDays(before) ⊆ activeDays(after)). This is exactly SA's
//     last-block-on-a-day guard, generalized.
//   - Lunch / Planning / Makeup / admin / PLUS blocks are never touched.
//   - Every accepted rebuild passes computeWarnings with zero error-severity
//     warnings (the SSOT mirror) — and is re-validated by callers/persist paths.
//
// Determinism: result is a pure function of (seed, inputs, rounds). No wall-clock
// affects output; an optional safetyMs is a never-reached valve (see SAOptions).

import { type Rng } from "./_random.ts";
import { scoreSchedule, type ScoreableInput, type ScoreBreakdown } from "./_scoring.ts";
import { type OccupancyTracker } from "./_occupancy.ts";
import { buildOccupancyFromBlocks } from "./_annealing.ts";
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
  weeksCoincide,
  canSpecialistTeachGradeOnDay,
  specClassDuration,
  type Block,
  type Specialist,
  type StrategyResult,
  type PreferenceViolation,
} from "./index.ts";

export interface LNSOptions {
  /** Number of destroy-and-recreate rounds (the deterministic budget). */
  rounds?: number;
  /** Metropolis start temperature (uphill acceptance, like SA). */
  tStart?: number;
  /** Geometric cooling per round. */
  cooling?: number;
  /** Never-reached wall-clock safety valve (ms). Does not affect output. */
  safetyMs?: number;
  /** Optional extra objective folded into accept + best-tracking (e.g. the
   *  Phase-2 minimal-perturbation penalty). Added to the optimizer score; the
   *  returned `score` stays the pure scoreSchedule total of the best-combined
   *  candidate. Default: no adjustment (exact legacy behavior). */
  objectiveAdjust?: (blocks: Block[]) => number;
}

export interface LNSResult {
  blocks: Block[];
  preferenceViolations: PreferenceViolation[];
  score: number;
  rounds: number;
  accepted: number;
  improvement: number;
  /** Round index (0-based) at which `bestScore` last improved, or -1 if the
   *  initial schedule was never beaten. Feeds the convergence indicator
   *  (Phase 1c): an improvement late in the budget ⇒ "still improving". */
  lastImprovementRound: number;
}

const MUTABLE_NON_GRADES = new Set(["Lunch", "Planning", "Makeup"]);

/** A teaching block is mutable iff it has a specialist + teacher, is not a
 *  lunch/planning/makeup row, and is not a Big-Group combined member. */
function isMutable(b: Block, combinedMembers: Set<Block>): boolean {
  return (
    !!b.specialist_id && !!b.teacher_id &&
    !MUTABLE_NON_GRADES.has(b.grade) &&
    !combinedMembers.has(b)
  );
}

/** Identify Big-Group combined members (same specialist+grade+identical slot,
 *  different teachers, same week) — excluded from destruction so the group can
 *  never be split. Identical logic to SA's combinedMembers detection. */
function findCombinedMembers(blocks: Block[]): Set<Block> {
  const combined = new Set<Block>();
  for (const b of blocks) {
    if (!b.specialist_id || !b.teacher_id) continue;
    for (const o of blocks) {
      if (o === b) continue;
      if (
        o.specialist_id === b.specialist_id && o.grade === b.grade &&
        o.day_of_week === b.day_of_week && o.start_time === b.start_time &&
        o.end_time === b.end_time && o.teacher_id !== b.teacher_id &&
        (o.week_label ?? null) === (b.week_label ?? null)
      ) { combined.add(b); break; }
    }
  }
  return combined;
}

/** Per specialist, the set of weekdays they currently have ≥1 teaching block on.
 *  Used by the idle-day guard. */
function activeDaysBySpecialist(blocks: Block[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const b of blocks) {
    if (!b.specialist_id || !b.teacher_id) continue;
    if (MUTABLE_NON_GRADES.has(b.grade)) continue;
    (m.get(b.specialist_id) ?? m.set(b.specialist_id, new Set()).get(b.specialist_id)!).add(b.day_of_week);
  }
  return m;
}

/** Enumerate occupancy-legal candidate slots for a session, mirroring SA's MOVE
 *  enumeration: the grade's period grid ∪ start times already used on the day,
 *  filtered by hours, recess, and specialist/teacher/grade-lock freedom. */
function findFreeSlots(
  grade: string,
  duration: number,
  specialistId: string,
  teacherId: string | null,
  workDays: string[],
  workingBlocks: Block[],
  occ: OccupancyTracker,
  school: any,
  recessConfigs: any[],
  classStartMin: number,
  limit: number,
): Array<{ day: string; start: number; end: number }> {
  const passing = school.passing_time ?? 5;
  const canonicalStep = schoolCanonicalStep(school);
  const setup = school.setup_time ?? 15;
  const gradeTimeConfig = (school.grade_time_config as Record<string, { passingTime?: number; resetTime?: number }>) ?? {};
  const out: Array<{ day: string; start: number; end: number }> = [];
  for (const day of workDays) {
    const endMin = getEndMinForDay(day, school);
    const recessWindows = getRecessWindowsForDay(day, school, recessConfigs, grade);
    const candidateStarts = new Set<number>(
      buildTimeSlotsForGrade(grade, duration, classStartMin, endMin, passing, setup, gradeTimeConfig, recessWindows, canonicalStep).map((sl) => sl.start),
    );
    for (const b of workingBlocks) if (b.day_of_week === day) candidateStarts.add(timeToMinutes(b.start_time));
    for (const s of [...candidateStarts].sort((x, y) => x - y)) {
      const e = s + duration;
      if (s < classStartMin || e > endMin) continue;
      if (recessWindows.some((r) => s < r.end && e > r.start)) continue;
      if (!occ.isSpecialistFree(day, s, e, specialistId)) continue;
      if (teacherId && !occ.isTeacherFree(day, s, e, teacherId)) continue;
      if (!occ.isGradeRangeFree(day, grade, s, e)) continue;
      out.push({ day, start: s, end: e });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Attempt to recreate `destroyed` sessions on top of `survivors`. Returns the
 *  rebuilt block list, or null if any session could not be legally re-placed
 *  (in which case the round is abandoned and the current state kept).
 *
 *  Exported for reuse by minimal-perturbation replanning (Phase 2): re-placing
 *  exactly the sessions invalidated by an input change, leaving survivors put. */
export function recreate(
  destroyed: Block[],
  survivors: Block[],
  specialists: Specialist[],
  baseOccupancy: OccupancyTracker,
  school: any,
  recessConfigs: any[],
  classStartMin: number,
  rng: Rng,
): Block[] | null {
  const occ = buildOccupancyFromBlocks(baseOccupancy, survivors);
  const working = survivors.slice();
  // Seeded placement order: hardest-first heuristics aside, a stable shuffle by
  // a derived key keeps determinism while varying order across rounds.
  const order = destroyed
    .map((b, i) => ({ b, k: (rng() * 1e9) >>> 0, i }))
    .sort((a, z) => (a.k - z.k) || (a.i - z.i))
    .map((x) => x.b);

  for (const sess of order) {
    const spec = specialists.find((s) => s.id === sess.specialist_id);
    if (!spec) return null;
    const duration = timeToMinutes(sess.end_time) - timeToMinutes(sess.start_time);
    const workDays = (spec.working_days ?? DAYS).filter((d) => DAYS.includes(d));
    if (workDays.length === 0) return null;
    const slots = findFreeSlots(
      sess.grade, duration, sess.specialist_id!, sess.teacher_id,
      workDays, working, occ, school, recessConfigs, classStartMin, 16,
    );
    if (slots.length === 0) return null;
    const chosen = slots[Math.floor(rng() * slots.length)];
    const placed: Block = {
      ...sess,
      day_of_week: chosen.day,
      start_time: minutesToTime(chosen.start),
      end_time: minutesToTime(chosen.end),
    };
    occ.book(chosen.day, chosen.start, chosen.end, placed.specialist_id!, placed.teacher_id);
    working.push(placed);
  }
  return working;
}

// ─── Reassignment operator (drives class_repeats to its floor) ───────────────
//
// The destroy/recreate above re-places sessions but KEEPS each session's
// specialist, so it can never change WHICH specialist a class sees — meaning the
// class_repeats penalty is frozen the instant the schedule is constructed. This
// operator is the missing piece: it re-places one class's sessions onto DISTINCT
// specialists, so a class that wrongly sees one specialist twice (and misses
// another) is repaired toward "each session a different specialist".

/** Week-aware occupancy: like buildOccupancyFromBlocks, but only books blocks
 *  whose week coincides with `week` (so an A-week placement isn't blocked by a
 *  B-week session). Half-open intervals; same rules the SSOT mirrors. */
function buildWeekOccupancy(base: OccupancyTracker, blocks: Block[], week: string | null): OccupancyTracker {
  const occ = base.clone();
  for (const b of blocks) {
    if (!b.specialist_id) continue;
    if (!weeksCoincide(b.week_label ?? null, week)) continue;
    occ.book(b.day_of_week, timeToMinutes(b.start_time), timeToMinutes(b.end_time), b.specialist_id, b.teacher_id);
  }
  return occ;
}

/** Teacher ids whose class currently sees some specialist more than once
 *  (i.e. has an avoidable/structural repeat) — the targets for reassignment. */
function classesWithRepeats(blocks: Block[]): string[] {
  const perClass = new Map<string, Map<string, number>>();
  for (const b of blocks) {
    if (!b.teacher_id || !b.specialist_id) continue;
    const m = perClass.get(b.teacher_id) ?? perClass.set(b.teacher_id, new Map()).get(b.teacher_id)!;
    m.set(b.specialist_id, (m.get(b.specialist_id) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const [tid, m] of perClass) {
    for (const n of m.values()) if (n > 1) { out.push(tid); break; }
  }
  return out;
}

/** Re-place one class's `classSessions` onto DISTINCT specialists (where legal),
 *  leaving `survivors` untouched. Returns the rebuilt full block list, or null if
 *  any session cannot be legally placed (round abandoned). Week-aware + grade-
 *  rotation aware; every placement is occupancy-legal. */
function reassignClassDistinct(
  classSessions: Block[],
  survivors: Block[],
  specialists: Specialist[],
  baseOccupancy: OccupancyTracker,
  school: any,
  recessConfigs: any[],
  classStartMin: number,
  rng: Rng,
): Block[] | null {
  if (classSessions.length === 0) return null;
  const teacherId = classSessions[0].teacher_id!;
  const grade = classSessions[0].grade;

  // Deterministic session order (week, then current slot).
  const sessions = [...classSessions].sort((a, b) =>
    (a.week_label ?? "").localeCompare(b.week_label ?? "") ||
    a.day_of_week.localeCompare(b.day_of_week) ||
    a.start_time.localeCompare(b.start_time));

  // Seeded specialist order; distinct (unused-for-this-class) specialists are
  // always tried before any the class already sees, so we maximize distinctness.
  const specOrder = specialists
    .map((s, i) => ({ s, k: (rng() * 1e9) >>> 0, i }))
    .sort((a, z) => (a.k - z.k) || (a.i - z.i))
    .map((x) => x.s);

  // Seed "already seen" with the specialists this class keeps in surviving
  // sessions (e.g. Big-Group blocks), so we don't re-introduce a repeat there.
  const usedSpecs = new Set<string>();
  for (const b of survivors) {
    if (b.teacher_id === teacherId && b.specialist_id) usedSpecs.add(b.specialist_id);
  }

  const placed: Block[] = [];
  for (const sess of sessions) {
    const W = sess.week_label ?? null;
    const baseDuration = timeToMinutes(sess.end_time) - timeToMinutes(sess.start_time);
    const working = [...survivors, ...placed].filter((b) => weeksCoincide(b.week_label ?? null, W));
    const occ = buildWeekOccupancy(baseOccupancy, [...survivors, ...placed], W);

    const candidates = [
      ...specOrder.filter((s) => !usedSpecs.has(s.id)),
      ...specOrder.filter((s) => usedSpecs.has(s.id)),
    ];
    let placedThis = false;
    for (const cand of candidates) {
      const workDays = (cand.working_days ?? DAYS).filter((d) => DAYS.includes(d) && canSpecialistTeachGradeOnDay(cand, grade, d));
      if (workDays.length === 0) continue;
      const dur = specClassDuration(cand, baseDuration);
      const slots = findFreeSlots(grade, dur, cand.id, teacherId, workDays, working, occ, school, recessConfigs, classStartMin, 16);
      if (slots.length === 0) continue;
      // Clustering-aware (WEEK-BLIND, matching the scorer): avoid a day where this
      // grade already has cand.subject in ANY week, so reassigning to fix a repeat
      // doesn't create a same-day duplicate.
      const clusteredDays = new Set(
        [...survivors, ...placed].filter((b) => b.grade === grade && b.subject === cand.subject).map((b) => b.day_of_week),
      );
      const clean = slots.filter((s) => !clusteredDays.has(s.day));
      const pickFrom = clean.length > 0 ? clean : slots;
      const chosen = pickFrom[Math.floor(rng() * pickFrom.length)];
      placed.push({
        ...sess,
        specialist_id: cand.id,
        subject: cand.subject,
        day_of_week: chosen.day,
        start_time: minutesToTime(chosen.start),
        end_time: minutesToTime(chosen.end),
        room: cand.location ?? sess.room ?? null,
      });
      usedSpecs.add(cand.id);
      placedThis = true;
      break;
    }
    if (!placedThis) return null;
  }
  return [...survivors, ...placed];
}

/** True if no specialist lost an active working-day (idle-day guard). */
function idleDayGuardOk(before: Block[], after: Block[]): boolean {
  const a = activeDaysBySpecialist(before);
  const b = activeDaysBySpecialist(after);
  for (const [spec, daysBefore] of a) {
    const daysAfter = b.get(spec) ?? new Set<string>();
    for (const d of daysBefore) if (!daysAfter.has(d)) return false;
  }
  return true;
}

// ─── Directed greedy repair (deterministic descent on the dominant penalties) ─
//
// Random LNS plateaus on the structured ASSIGNMENT penalties (class_repeats,
// subject_day_clustering). This pass instead applies the single highest-value
// TARGETED move repeatedly until none improves: (1) reassign a repeating class
// onto distinct specialists, (2) move a same-day subject duplicate to a clean
// day. Every accepted move is SSOT-legal, Big-Group/idle-day safe, and strictly
// improves the score — so it converges to a local optimum far better than random
// search, and is the workhorse that actually drives quality toward the ceiling.

/** Same-day (grade, subject) duplicates → relocate one to a day without that
 *  subject for the grade, keeping its specialist/teacher (a de-cluster move).
 *  Exported for the edit-tools' SCOPED improve_quality pass (clustering-only
 *  focus must not trigger the whole-class reassignment directedRepair does). */
export function declusterOnce(
  current: Block[],
  combined: Set<Block>,
  baseOccupancy: OccupancyTracker,
  school: any,
  recessConfigs: any[],
  classStartMin: number,
  rng: Rng,
  accept: (cand: Block[]) => boolean,
): boolean {
  // Group WEEK-BLIND to match the scorer's (grade|subject|day) clustering key, so
  // we also catch cross-week duplicates (e.g. Art on Friday in BOTH A and B weeks,
  // which the rubric penalizes even though they're different weeks).
  const byKey = new Map<string, Block[]>();
  for (const b of current) {
    if (!isMutable(b, combined)) continue;
    const k = `${b.grade}|${b.subject ?? ""}|${b.day_of_week}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(b);
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const blk of group) {
      const survivors = current.filter((b) => b !== blk);
      const W = blk.week_label ?? null;
      const working = survivors.filter((b) => weeksCoincide(b.week_label ?? null, W));
      // Clean days = days where this (grade, subject) appears in NO week (week-blind),
      // so the relocate actually lowers the week-blind clustering count.
      const usedDays = new Set(
        survivors.filter((b) => b.grade === blk.grade && b.subject === blk.subject).map((b) => b.day_of_week),
      );
      const occ = buildWeekOccupancy(baseOccupancy, survivors, W);
      const duration = timeToMinutes(blk.end_time) - timeToMinutes(blk.start_time);
      const workDays = DAYS.filter((d) => !usedDays.has(d));
      const slots = findFreeSlots(blk.grade, duration, blk.specialist_id!, blk.teacher_id, workDays, working, occ, school, recessConfigs, classStartMin, 12);
      if (slots.length === 0) continue;
      const chosen = slots[Math.floor(rng() * slots.length)];
      const moved: Block = { ...blk, day_of_week: chosen.day, start_time: minutesToTime(chosen.start), end_time: minutesToTime(chosen.end) };
      const cand = survivors.concat([moved]);
      if (accept(cand)) return true;
    }
  }
  return false;
}

export interface RepairContext {
  scoringInput: ScoreableInput;
  specialists: Specialist[];
  grades: string[];
  school: any;
  recessConfigs: any[];
  baseOccupancy: OccupancyTracker;
  weightOverrides?: Partial<Record<keyof ScoreBreakdown, number>>;
}

/** Greedy descent: reassign repeating classes onto distinct specialists and
 *  de-cluster same-day duplicates until no targeted move improves the score.
 *  Deterministic given `rng`. Returns the improved (or unchanged) block list. */
export function directedRepair(blocks: Block[], ctx: RepairContext, rng: Rng, maxRounds = 60): Block[] {
  const { scoringInput, specialists, grades, school, recessConfigs, baseOccupancy, weightOverrides } = ctx;
  const classStartMin = timeToMinutes(school.start_time ?? "08:00");
  let current = blocks.slice();
  const scoreOf = (bs: Block[]): number =>
    scoreSchedule({ blocks: bs, warnings: computeWarnings(bs, specialists, grades), preferenceViolations: [] }, scoringInput, weightOverrides).total;
  let curScore = scoreOf(current);

  // Accept a candidate only if legal, idle-day-safe, and strictly better.
  const accept = (cand: Block[]): boolean => {
    if (!idleDayGuardOk(current, cand)) return false;
    const w = computeWarnings(cand, specialists, grades);
    if (strategyFailed(w)) return false;
    const s = scoreSchedule({ blocks: cand, warnings: w, preferenceViolations: [] }, scoringInput, weightOverrides).total;
    if (s > curScore + 1e-9) { current = cand; curScore = s; return true; }
    return false;
  };

  for (let round = 0; round < maxRounds; round++) {
    let improved = false;
    const combined = findCombinedMembers(current);

    // 1. Reassign each repeating class onto distinct specialists.
    for (const tid of classesWithRepeats(current.filter((b) => isMutable(b, combined)))) {
      const classSessions = current.filter((b) => isMutable(b, combined) && b.teacher_id === tid);
      if (classSessions.length === 0) continue;
      const classSet = new Set(classSessions);
      const survivors = current.filter((b) => !classSet.has(b));
      const rebuilt = reassignClassDistinct(classSessions, survivors, specialists, baseOccupancy, school, recessConfigs, classStartMin, rng);
      if (rebuilt && accept(rebuilt)) improved = true;
    }

    // 2. De-cluster same-day subject duplicates.
    if (declusterOnce(current, combined, baseOccupancy, school, recessConfigs, classStartMin, rng, accept)) improved = true;

    if (!improved) break;
  }
  return current;
}

export function runLNS(
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
  opts?: LNSOptions,
): LNSResult {
  const ROUNDS = Math.max(0, opts?.rounds ?? 60);
  const T_START = opts?.tStart ?? 30;
  const COOLING = opts?.cooling ?? 0.97;
  const SAFETY_MS = opts?.safetyMs ?? 30000;
  // Default no-op ⇒ accept + best-tracking are exactly the pure score (legacy).
  const adjust = opts?.objectiveAdjust ?? (() => 0);

  let currentBlocks = initialResult.blocks.slice();
  let currentScore = initialScore;
  const violations = initialResult.preferenceViolations.slice();

  let bestBlocks = currentBlocks.slice();
  let bestScore = currentScore;
  // Best is tracked by the ADJUSTED objective so a minimal-perturbation candidate
  // of equal pure quality is preferred; bestScore stays the pure score.
  let bestCombined = currentScore + adjust(currentBlocks);
  let lastImprovementRound = -1;

  const classStartMin = timeToMinutes(school.start_time ?? "08:00");
  let T = T_START;
  let accepted = 0;
  let rounds = 0;
  const t0 = performance.now();

  for (let r = 0; r < ROUNDS; r++) {
    if ((r & 31) === 0 && performance.now() - t0 > SAFETY_MS) {
      console.warn(`[LNS] safety cutoff at round ${r}/${ROUNDS} after ${SAFETY_MS}ms`);
      break;
    }
    rounds++;

    const combined = findCombinedMembers(currentBlocks);
    const mutable = currentBlocks.filter((b) => isMutable(b, combined));
    if (mutable.length < 2) break;

    // Choose an operator (seeded): 0=destroy specialist, 1=destroy weekday,
    // 2=destroy grade, 3=REASSIGN a repeating class onto distinct specialists.
    const op = Math.floor(rng() * 4);
    let rebuilt: Block[] | null;
    if (op === 3) {
      // Reassignment: only operator that changes which specialist a class sees.
      const repeatClasses = classesWithRepeats(mutable);
      if (repeatClasses.length === 0) { T *= COOLING; continue; }
      const target = repeatClasses[Math.floor(rng() * repeatClasses.length)];
      const classSessions = mutable.filter((b) => b.teacher_id === target);
      const classSet = new Set(classSessions);
      const survivors = currentBlocks.filter((b) => !classSet.has(b));
      rebuilt = reassignClassDistinct(classSessions, survivors, specialists, baseOccupancy, school, recessConfigs, classStartMin, rng);
    } else {
      let destroyed: Block[];
      if (op === 0) {
        const specs = [...new Set(mutable.map((b) => b.specialist_id!))];
        const target = specs[Math.floor(rng() * specs.length)];
        destroyed = mutable.filter((b) => b.specialist_id === target);
      } else if (op === 1) {
        const days = [...new Set(mutable.map((b) => b.day_of_week))];
        const target = days[Math.floor(rng() * days.length)];
        destroyed = mutable.filter((b) => b.day_of_week === target);
      } else {
        const gs = [...new Set(mutable.map((b) => b.grade))];
        const target = gs[Math.floor(rng() * gs.length)];
        destroyed = mutable.filter((b) => b.grade === target);
      }
      if (destroyed.length === 0) { T *= COOLING; continue; }
      const destroyedSet = new Set(destroyed);
      const survivors = currentBlocks.filter((b) => !destroyedSet.has(b));
      rebuilt = recreate(destroyed, survivors, specialists, baseOccupancy, school, recessConfigs, classStartMin, rng);
    }
    if (!rebuilt) { T *= COOLING; continue; }

    // Idle-day guard + hard-constraint gate (SSOT mirror).
    if (!idleDayGuardOk(currentBlocks, rebuilt)) { T *= COOLING; continue; }
    const warnings = computeWarnings(rebuilt, specialists, grades);
    if (strategyFailed(warnings)) { T *= COOLING; continue; }

    const candScore = scoreSchedule(
      { blocks: rebuilt, warnings, preferenceViolations: violations },
      scoringInput,
      weightOverrides,
    ).total;

    // Accept + best-track on the ADJUSTED objective. With the default no-op
    // adjust this reduces to the pure score (identical to legacy behavior).
    const candCombined = candScore + adjust(rebuilt);
    const delta = candCombined - (currentScore + adjust(currentBlocks));
    if (delta > 0 || rng() < Math.exp(delta / T)) {
      currentBlocks = rebuilt;
      currentScore = candScore;
      accepted++;
      if (candCombined > bestCombined) {
        bestCombined = candCombined;
        bestScore = candScore;
        bestBlocks = rebuilt.slice();
        lastImprovementRound = r;
      }
    }
    T *= COOLING;
  }

  return {
    blocks: bestBlocks,
    preferenceViolations: violations,
    score: bestScore,
    rounds,
    accepted,
    improvement: bestScore - initialScore,
    lastImprovementRound,
  };
}
