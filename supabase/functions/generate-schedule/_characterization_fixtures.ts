// Characterization fixtures + snapshot computation (Phase 0).
//
// Shared by _characterization_test.ts (which freezes the snapshot) and the
// one-off capture script that produced those frozen values. Mirrors the
// realistic "complaint school" used by _simulate.ts so the snapshot pins the
// exact behavior of the generator BEFORE the decomposition / Phase-1 changes.
//
// The snapshot deliberately measures observable, behavior-defining outputs:
//   - total block count + teaching block count
//   - the full pre-weighted score_breakdown
//   - chosenStrategy + winningScore
//   - hard-violation count measured by the SSOT validator (must be 0)
//
// If the decomposition is behavior-preserving, every value here is byte-identical
// before and after. If Phase 1 improves quality, soft terms move in the right
// direction and violations stay 0 — asserted by the Phase-1 tests, not these.

import { generateScheduleBlocks, type Block } from "./index.ts";
import {
  buildConstraintContext,
  violations,
  type ConstraintBlock,
} from "../_shared/constraints.ts";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function spec(id: string, name: string, subject: string, opts: Record<string, unknown> = {}) {
  return {
    id, name, subject,
    working_days: DAYS,
    planning_minutes: 45, lunch_minutes: 30,
    uses_cart: false, two_schools: false, is_part_time: false,
    part_time_planning_minutes: 30, part_time_lunch_minutes: 20,
    grade_rotation: null, location: null, second_location: null,
    weekly_planning_minutes: 225,
    ...opts,
  };
}
function teacher(id: string, name: string, grade: string, opts: Record<string, unknown> = {}) {
  return {
    id, name, grade, room: `R${id.slice(-2)}`,
    am_pm_preference: null, day_preference: null,
    planning_minutes: 45, weekly_planning_minutes: 225, lunch_minutes: 30,
    ...opts,
  };
}

export const CHAR_STRATEGIES = ["standard", "ab_week", "aa_bb_week", "quick_30", "big_group"] as const;
export type CharStrategy = (typeof CHAR_STRATEGIES)[number];

/** Deterministic generation id per strategy so snapshots are reproducible. */
function generationIdFor(strategy: string): string {
  // A fixed, valid-looking UUID per strategy; the generator only hashes it.
  const tag = strategy.replace(/[^a-z0-9]/g, "").slice(0, 8).padEnd(8, "0");
  return `00000000-0000-4000-a000-0000${tag.slice(0, 8)}`.slice(0, 36);
}

export function buildScenario(strategy: CharStrategy) {
  const specialists = [
    spec("11111111-1111-4111-a111-111111111111", "Tech Teacher", "Technology"),
    spec("22222222-2222-4222-a222-222222222222", "PE Teacher", "PE"),
    spec("33333333-3333-4333-a333-333333333333", "Art Teacher", "Art"),
    spec("44444444-4444-4444-a444-444444444444", "Garden Teacher", "Garden", { working_days: ["Tue", "Thu"] }),
    spec("55555555-5555-4555-a555-555555555555", "Library Teacher", "Library"),
  ];
  const grades = ["K", "1", "2", "3", "4", "5"];
  const teachers = grades.flatMap((g, gi) =>
    [1, 2, 3, 4].map((n) =>
      teacher(`eeeeeeee-eeee-4eee-eeee-${String(gi * 4 + n).padStart(12, "0")}`, `${g} Teacher ${n}`, g),
    ),
  );

  const school: Record<string, unknown> = {
    start_time: "08:05",
    end_time: "14:00",
    early_release_day: "Wednesday",
    early_release_end_time: "13:15",
    class_duration: 45,
    setup_time: 5,
    passing_time: 5,
    planning_minutes: 0,
    schedule_type: "whole_school",
    grade_time_config: {},
    planning_time_when: "during_rotations",
    conflict_strategy: strategy,
    conflict_strategies: [strategy],
    conflict_grades: strategy === "quick_30" ? ["K", "1"]
      : strategy === "big_group" ? ["4", "5"]
      : strategy === "ab_week" || strategy === "aa_bb_week" ? grades
      : [],
    conflict_timing: "before",
    big_group_config: strategy === "big_group"
      ? [
          { grade: "4", teacherIds: teachers.filter((t) => t.grade === "4").slice(0, 2).map((t) => t.id) },
          { grade: "5", teacherIds: teachers.filter((t) => t.grade === "5").slice(0, 2).map((t) => t.id) },
        ]
      : [],
  };

  const recessConfigs = [
    {
      grade_band: "all",
      am_recess_start: "10:00", am_recess_end: "10:15",
      lunch_start: "11:30", lunch_end: "12:15",
      pm_recess_start: null, pm_recess_end: null,
    },
  ];

  return { specialists, teachers, grades, school, recessConfigs };
}

export interface CharSnapshot {
  strategy: string;
  totalBlocks: number;
  teachingBlocks: number;
  chosenStrategy: string;
  winningScore: number;
  scoreBreakdown: Record<string, number>;
  hardViolations: number;
}

const isTeaching = (b: Block) =>
  !!b.specialist_id &&
  b.grade !== "Lunch" && b.grade !== "Planning" && b.grade !== "Makeup" &&
  b.subject !== "Specialist Lunch";

/** Count hard placement violations using the SSOT validator.
 *
 *  Generated blocks have no `id` yet (they are persisted later). The SSOT's
 *  self-skip is keyed on `id`, so we assign a stable synthetic id per block
 *  first — otherwise every block would "double-book itself". This mirrors how
 *  the SSOT is actually used (on persisted blocks that carry ids). */
export function countHardViolations(blocks: Block[], school: any, recessConfigs: any[]): number {
  const all: ConstraintBlock[] = blocks.map((b, i) => ({ ...(b as unknown as ConstraintBlock), id: String(i) }));
  const ctx = buildConstraintContext(school, recessConfigs, all);
  let count = 0;
  for (const b of all) {
    // Only validate teaching blocks (the SSOT is not meant for lunch/PLC rows).
    if (!isTeaching(b as unknown as Block)) continue;
    count += violations(b, all, ctx).length;
  }
  return count;
}

export function computeSnapshot(strategy: CharStrategy): CharSnapshot {
  const { specialists, teachers, grades, school, recessConfigs } = buildScenario(strategy);
  const result = generateScheduleBlocks(
    generationIdFor(strategy),
    specialists as never, teachers as never, grades, school, recessConfigs,
    [], [], [], [], [],
  );
  const blocks = result.blocks;
  return {
    strategy,
    totalBlocks: blocks.length,
    teachingBlocks: blocks.filter(isTeaching).length,
    chosenStrategy: result.chosenStrategy,
    winningScore: Math.round(result.winningScore * 1000) / 1000,
    scoreBreakdown: Object.fromEntries(
      Object.entries(result.scoreBreakdown ?? {}).map(([k, v]) => [k, Math.round((v as number) * 1000) / 1000]),
    ),
    hardViolations: countHardViolations(blocks, school, recessConfigs),
  };
}
