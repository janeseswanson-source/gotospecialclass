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
 *  (in which case the round is abandoned and the current state kept). */
function recreate(
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

  let currentBlocks = initialResult.blocks.slice();
  let currentScore = initialScore;
  const violations = initialResult.preferenceViolations.slice();

  let bestBlocks = currentBlocks.slice();
  let bestScore = currentScore;
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

    // Choose a destroy operator (seeded): 0=specialist, 1=weekday, 2=grade.
    const op = Math.floor(rng() * 3);
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

    const rebuilt = recreate(destroyed, survivors, specialists, baseOccupancy, school, recessConfigs, classStartMin, rng);
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

    const delta = candScore - currentScore;
    if (delta > 0 || rng() < Math.exp(delta / T)) {
      currentBlocks = rebuilt;
      currentScore = candScore;
      accepted++;
      if (candScore > bestScore) {
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
