// Grade-adjacency post-pass: "Grade 5, Grade 5, recess, then Grade 3, Grade 3".
//
// grade_day_spread (scoring) groups a specialist's grades onto the same days,
// but nothing orders them WITHIN a day — coordinators read 5,3,5,3 as chaos.
// reorderGradeRuns permutes which class occupies which of a specialist's
// EXISTING slots on a day so same-grade classes sit in contiguous runs. The
// slot set (start/end times) never changes; only the class↔slot assignment.
//
// Legality per move is the SSOT validator (recess windows per grade, PLC
// grade locks, teacher double-book across ALL specialists, school hours) plus
// two score guards, because exactly two breakdown terms are order-sensitive
// within a specialist-day:
//   - k_grade_after_780: a K/TK block must never move from before 13:00 to
//     13:00+ (the reverse is fine — it can only help).
//   - am_pm_satisfied: a teacher whose sessions currently honor an AM/PM
//     preference must not be flipped across noon. (preferenceViolations are a
//     frozen input to scoring, so a NEW violation wouldn't even be scored —
//     it would just silently betray the preference.)
// Every other term (spread, clustering, cohesion, repeats, stdev, coverage,
// contract, planning) is permutation-invariant within a day, so under these
// guards the pass is provably score-non-decreasing and can be applied last.
//
// Big-Group members (same specialist + identical slot, taught together) move
// as one UNIT. Mixed durations never swap (a 30-min class can't take a 45-min
// slot). Deterministic and idempotent; identity is always a legal fallback.
import {
  timeToMinutes as sharedTimeToMinutes,
  buildConstraintContext,
  violations,
} from "../../_shared/constraints.ts";

// Structural block shape (compatible with the engine's Block and the SSOT's
// ConstraintBlock — kept local so this module has no import cycle on index.ts).
export interface AdjBlock {
  id?: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  specialist_id?: string | null;
  teacher_id?: string | null;
  grade?: string | null;
  subject?: string | null;
  week_label?: string | null;
  [k: string]: unknown;
}

export interface AdjacencyContext {
  school: any;
  recessConfigs: any[];
  /** Teachers with AM/PM preferences — guards a satisfied preference. */
  teachers?: Array<{ id: string; am_pm_preference?: string | null }>;
  /** Blocks that constrain occupancy but must never move (admin/PLC, lunch,
   *  PLUS, meeting, locked). They are ALSO excluded from movement when they
   *  appear in `blocks` (matched by identity of day+times+specialist+subject). */
  fixedContext?: AdjBlock[];
}

export interface ReorderStats {
  specialistDays: number;
  changedDays: number;
  movedBlocks: number;
  runsBefore: number;
  runsAfter: number;
}

const NON_TEACHING_GRADES = new Set(["Lunch", "Planning", "Makeup"]);
const FIXED_SUBJECTS = ["Specialist Lunch", "Specialist Meeting", "PLC/Admin"];
const NOON = 12 * 60;
const K_LATE_THRESHOLD = 780; // 13:00 — mirrors k_grade_after_780

const toMin = (t: string): number => sharedTimeToMinutes(t) ?? 0;

function isMovable(b: AdjBlock): boolean {
  if (!b.specialist_id) return false;
  if (b.grade && NON_TEACHING_GRADES.has(b.grade)) return false;
  const subj = b.subject ?? "";
  if (FIXED_SUBJECTS.includes(subj) || subj.includes("PLUS") || subj.includes("(Makeup)")) return false;
  if (subj.includes("Lunch Club")) return false; // pinned to lunch windows
  return true;
}

/** Count maximal same-grade runs in a day's chronologically-sorted blocks. */
export function countGradeRuns(dayBlocks: AdjBlock[]): number {
  const sorted = [...dayBlocks].sort((a, b) => toMin(a.start_time) - toMin(b.start_time));
  let runs = 0;
  let prev: string | null = null;
  for (const b of sorted) {
    const g = b.grade ?? "";
    if (g !== prev) { runs++; prev = g; }
  }
  return runs;
}

interface Slot { start: number; end: number }
interface Unit {
  members: AdjBlock[];       // 1 block, or several for a taught-together group
  grade: string;
  originalStart: number;
  duration: number;
}

export function reorderGradeRuns(
  blocks: AdjBlock[],
  ctx: AdjacencyContext,
): { blocks: AdjBlock[]; stats: ReorderStats } {
  const stats: ReorderStats = { specialistDays: 0, changedDays: 0, movedBlocks: 0, runsBefore: 0, runsAfter: 0 };
  const fixedContext = ctx.fixedContext ?? [];

  // Fixed-context identity set (a block may appear both in `blocks` and in
  // fixedContext when callers pass the merged list — never move those).
  const fixedKey = (b: AdjBlock) => `${b.specialist_id ?? ""}|${b.day_of_week}|${b.start_time}|${b.end_time}|${b.subject ?? ""}`;
  const fixedSet = new Set(fixedContext.map(fixedKey));

  // The SSOT context (grade locks) comes from EVERYTHING — locks never move.
  const allForCtx = [...blocks, ...fixedContext];
  const ssotCtx = buildConstraintContext(ctx.school, ctx.recessConfigs, allForCtx as any[]);

  const teacherPref = new Map<string, string>();
  for (const t of ctx.teachers ?? []) {
    if (t.am_pm_preference === "AM" || t.am_pm_preference === "PM") teacherPref.set(t.id, t.am_pm_preference);
  }

  const out = blocks.map((b) => ({ ...b }));

  // Group movable blocks by (specialist, day, week).
  const groups = new Map<string, number[]>(); // key -> indexes into `out`
  out.forEach((b, i) => {
    if (!isMovable(b) || fixedSet.has(fixedKey(b))) return;
    const key = `${b.specialist_id}|${b.day_of_week}|${b.week_label ?? "all"}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(i);
  });

  const sortedKeys = [...groups.keys()].sort();
  for (const key of sortedKeys) {
    const idxs = groups.get(key)!;
    if (idxs.length < 2) continue;
    stats.specialistDays++;

    // Merge into slot-units: blocks sharing the exact slot = one unit
    // (taught-together Big-Group members must move together).
    const unitsBySlot = new Map<string, Unit>();
    for (const i of idxs) {
      const b = out[i];
      const sKey = `${b.start_time}|${b.end_time}`;
      let u = unitsBySlot.get(sKey);
      if (!u) {
        u = { members: [], grade: b.grade ?? "", originalStart: toMin(b.start_time), duration: toMin(b.end_time) - toMin(b.start_time) };
        unitsBySlot.set(sKey, u);
      }
      u.members.push(b);
    }
    const units = [...unitsBySlot.values()];
    if (units.length < 2) continue;

    // SNAPSHOT (copies, not references) — the assignment loop mutates out[i],
    // and the revert below must restore the pre-reorder times.
    const dayBlocksBefore = idxs.map((i) => ({ ...out[i] }));
    stats.runsBefore += countGradeRuns(dayBlocksBefore);

    // Per-duration classes: only equal-length units may exchange slots.
    const byDuration = new Map<number, Unit[]>();
    for (const u of units) (byDuration.get(u.duration) ?? byDuration.set(u.duration, []).get(u.duration)!).push(u);

    // Context for legality: every block EXCEPT this group's own units. Within
    // a group, slots are pairwise disjoint intervals of ONE specialist and one
    // teacher appears at most once per day (repeats live on other days), so
    // intra-group clashes are impossible by construction.
    const groupIdxSet = new Set(idxs);
    const outsideBlocks = [
      ...out.filter((_, i) => !groupIdxSet.has(i)),
      ...fixedContext,
    ];

    const legalAt = (u: Unit, slot: Slot): boolean => {
      for (const m of u.members) {
        // K-guard: never move a pre-13:00 K/TK block to 13:00+.
        const g = (m.grade ?? "").toUpperCase();
        if ((g === "K" || g === "TK") && u.originalStart < K_LATE_THRESHOLD && slot.start >= K_LATE_THRESHOLD) return false;
        // AM/PM guard: never flip a teacher whose preference this block honors.
        const pref = m.teacher_id ? teacherPref.get(m.teacher_id) : undefined;
        if (pref) {
          const wasSide = u.originalStart < NOON ? "AM" : "PM";
          const newSide = slot.start < NOON ? "AM" : "PM";
          if (wasSide === pref && newSide !== pref) return false;
        }
        const cand = {
          ...m,
          id: m.id ?? `adj_${key}_${u.originalStart}`,
          start_time: `${String(Math.floor(slot.start / 60)).padStart(2, "0")}:${String(slot.start % 60).padStart(2, "0")}`,
          end_time: `${String(Math.floor(slot.end / 60)).padStart(2, "0")}:${String(slot.end % 60).padStart(2, "0")}`,
        };
        if (violations(cand as any, outsideBlocks as any[], ssotCtx).length > 0) return false;
      }
      return true;
    };

    let dayChanged = false;
    for (const [, dUnits] of [...byDuration.entries()].sort((a, b) => a[0] - b[0])) {
      if (dUnits.length < 2) continue;
      const slots: Slot[] = dUnits
        .map((u) => ({ start: u.originalStart, end: u.originalStart + u.duration }))
        .sort((a, b) => a.start - b.start);

      // Target order: grades sorted by their earliest original slot (keeps
      // early grades early → minimal churn), tie-broken by grade string;
      // within a grade, preserve original chronology.
      const gradeFirstStart = new Map<string, number>();
      for (const u of dUnits) {
        const cur = gradeFirstStart.get(u.grade);
        if (cur === undefined || u.originalStart < cur) gradeFirstStart.set(u.grade, u.originalStart);
      }
      const target = [...dUnits].sort((a, b) =>
        (gradeFirstStart.get(a.grade)! - gradeFirstStart.get(b.grade)!) ||
        a.grade.localeCompare(b.grade) ||
        (a.originalStart - b.originalStart));

      // Greedy assignment with pin-on-conflict retry. Identity is always
      // legal (original placement was), so this terminates with a legal map.
      const originalOccupant = new Map<number, Unit>(); // slot.start -> unit
      for (const u of dUnits) originalOccupant.set(u.originalStart, u);
      const pinned = new Map<Unit, Slot>();

      let assignment: Map<Unit, Slot> | null = null;
      for (let attempt = 0; attempt <= dUnits.length; attempt++) {
        const trial = new Map<Unit, Slot>(pinned);
        const free = target.filter((u) => !pinned.has(u));
        let failSlot: Slot | null = null;
        for (const s of slots) {
          if ([...pinned.values()].some((ps) => ps.start === s.start)) continue;
          const uIdx = free.findIndex((u) => (u.originalStart === s.start) || legalAt(u, s));
          if (uIdx === -1) { failSlot = s; break; }
          trial.set(free[uIdx], s);
          free.splice(uIdx, 1);
        }
        if (!failSlot) { assignment = trial; break; }
        // Pin the slot's ORIGINAL occupant back home and retry without it.
        const homeUnit = originalOccupant.get(failSlot.start);
        if (!homeUnit || pinned.has(homeUnit)) break; // cannot repair → keep identity
        pinned.set(homeUnit, { start: homeUnit.originalStart, end: homeUnit.originalStart + homeUnit.duration });
      }
      if (!assignment) continue; // identity for this duration class

      for (const [u, s] of assignment) {
        if (s.start === u.originalStart) continue;
        for (const m of u.members) {
          m.start_time = `${String(Math.floor(s.start / 60)).padStart(2, "0")}:${String(s.start % 60).padStart(2, "0")}`;
          m.end_time = `${String(Math.floor(s.end / 60)).padStart(2, "0")}:${String(s.end % 60).padStart(2, "0")}`;
          stats.movedBlocks++;
        }
        dayChanged = true;
      }
    }

    const runsAfterDay = countGradeRuns(idxs.map((i) => out[i]));
    const runsBeforeDay = countGradeRuns(dayBlocksBefore);
    // Paranoia: a reorder must never fragment a day further. Revert if it did.
    if (runsAfterDay > runsBeforeDay) {
      idxs.forEach((i, j) => {
        out[i].start_time = dayBlocksBefore[j].start_time;
        out[i].end_time = dayBlocksBefore[j].end_time;
      });
      stats.runsAfter += runsBeforeDay;
      continue;
    }
    stats.runsAfter += runsAfterDay;
    if (dayChanged) stats.changedDays++;
  }

  return { blocks: out, stats };
}
