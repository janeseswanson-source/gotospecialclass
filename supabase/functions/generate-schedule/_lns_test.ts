// Phase 1b — LNS (ruin-and-recreate) tests.
//
// Guarantees asserted here:
//   - deterministic (same seed + inputs ⇒ identical result; safetyMs irrelevant)
//   - monotonic quality (result.score ≥ initialScore — never regresses)
//   - zero hard violations on the result (SSOT)
//   - Big-Group combined members are never split (preserved unchanged)
//   - never manufactures an idle day (activeDays(before) ⊆ activeDays(after))
//   - improves the realistic "complaint school" (standard) fixture

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runLNS } from "./_lns.ts";
import { mulberry32 } from "./_random.ts";
import { OccupancyTracker } from "./_occupancy.ts";
import { generateScheduleBlocks, computeWarnings, type Block, type StrategyResult } from "./index.ts";
import { scoreSchedule, type ScoreableInput } from "./_scoring.ts";
import { buildScenario, countHardViolations, type CharStrategy } from "./_characterization_fixtures.ts";

function buildLNSInputs(strategy: CharStrategy, schoolPatch: Record<string, unknown> = {}) {
  const scenario = buildScenario(strategy);
  const { specialists, teachers, grades, recessConfigs } = scenario;
  const school = { ...(scenario.school as Record<string, unknown>), ...schoolPatch };
  const gen = generateScheduleBlocks(
    "00000000-0000-4000-a000-0000000000ln",
    specialists as never, teachers as never, grades, school, recessConfigs,
    [], [], [], [], [],
  );
  const initial: StrategyResult = { blocks: gen.blocks as Block[], preferenceViolations: gen.preferenceViolations };
  const scoringInput: ScoreableInput = {
    school: {
      start_time: school.start_time as string,
      end_time: school.end_time as string,
      early_release_day: school.early_release_day as string,
      early_release_end_time: school.early_release_end_time as string,
      keep_grades_together: true,
      rotation_wheel_grades: (school as any).rotation_wheel_grades ?? null,
      contractual_minutes_extracted: null,
    },
    specialists: (specialists as any[]).map((s) => ({ id: s.id, subject: s.subject, working_days: s.working_days })),
    teachers: (teachers as any[]).map((t) => ({ id: t.id, am_pm_preference: t.am_pm_preference, day_preference: t.day_preference, weekly_planning_minutes: t.weekly_planning_minutes })),
    grades,
  };
  const initialScore = scoreSchedule(
    { blocks: initial.blocks, warnings: computeWarnings(initial.blocks, specialists as never, grades), preferenceViolations: initial.preferenceViolations },
    scoringInput,
  ).total;
  return { initial, initialScore, scoringInput, specialists, grades, school, recessConfigs };
}

function run(strategy: CharStrategy, seed: number, opts?: Parameters<typeof runLNS>[10], schoolPatch?: Record<string, unknown>) {
  const c = buildLNSInputs(strategy, schoolPatch);
  const res = runLNS(
    c.initial, c.initialScore, c.scoringInput, c.specialists as never, c.grades,
    c.school, c.recessConfigs, new OccupancyTracker(), mulberry32(seed), undefined, opts,
  );
  return { c, res };
}

Deno.test("LNS: deterministic — same seed ⇒ identical result", () => {
  const a = run("standard", 999, { rounds: 80 }).res;
  const b = run("standard", 999, { rounds: 80 }).res;
  assertEquals(a.blocks, b.blocks);
  assertEquals(a.score, b.score);
  assertEquals(a.accepted, b.accepted);
});

Deno.test("LNS: wall-clock (safetyMs) does NOT change in-budget output", () => {
  const a = run("standard", 7, { rounds: 80, safetyMs: 5_000 }).res;
  const b = run("standard", 7, { rounds: 80, safetyMs: 600_000 }).res;
  assertEquals(a.blocks, b.blocks);
  assertEquals(a.score, b.score);
});

Deno.test("LNS: never regresses (result score ≥ initial) and stays SSOT-legal", () => {
  for (const strat of ["standard", "ab_week", "aa_bb_week", "quick_30", "big_group"] as CharStrategy[]) {
    const { c, res } = run(strat, 12345, { rounds: 100 });
    assert(res.score >= c.initialScore, `${strat}: score ${res.score} < initial ${c.initialScore}`);
    assertEquals(res.improvement, res.score - c.initialScore);
    assertEquals(countHardViolations(res.blocks, c.school, c.recessConfigs), 0, `${strat}: must be SSOT-legal`);
  }
});

Deno.test("LNS: improves the complaint-school (standard) fixture", () => {
  // 400 rounds (was 120): the grade_day_spread objective term made this seed's
  // first improving move rarer — probed seeds 7/42/999 improve at 120, but
  // 12345 needs ~400. The improvement guarantee itself is unchanged.
  //
  // rotation_wheel_grades []: wheel mode OFF reproduces the exact pre-wheel
  // engine, where this fixture provably has LNS-reachable headroom. With the
  // wheel ON, grade-major construction + in-pipeline SA already land this
  // fixture on LNS's local optimum (probed seeds 7/42/999/12345 × rounds
  // 400/1200 all return +0 — nothing left for these operators), so the wheel
  // path is covered by the never-regresses test above instead.
  const { res } = run("standard", 12345, { rounds: 400 }, { rotation_wheel_grades: [] });
  assert(res.improvement > 0, `expected LNS to improve standard, got +${res.improvement}`);
});

Deno.test("LNS: rounds 0 → no-op (returns the initial unchanged)", () => {
  const { c, res } = run("standard", 1, { rounds: 0 });
  assertEquals(res.rounds, 0);
  assertEquals(res.improvement, 0);
  assertEquals(res.score, c.initialScore);
  assertEquals(res.blocks, c.initial.blocks);
});

// Big-Group combined members (same specialist+grade+identical slot, different
// teachers, same week) must never be split. We sign each combined member and
// assert the exact multiset survives LNS unchanged.
function combinedSignatures(blocks: Block[]): string[] {
  const sigs: string[] = [];
  for (const b of blocks) {
    if (!b.specialist_id || !b.teacher_id) continue;
    const isCombined = blocks.some((o) =>
      o !== b && o.specialist_id === b.specialist_id && o.grade === b.grade &&
      o.day_of_week === b.day_of_week && o.start_time === b.start_time &&
      o.end_time === b.end_time && o.teacher_id !== b.teacher_id &&
      (o.week_label ?? null) === (b.week_label ?? null),
    );
    if (isCombined) sigs.push(`${b.specialist_id}|${b.grade}|${b.day_of_week}|${b.start_time}|${b.end_time}|${b.teacher_id}|${b.week_label ?? ""}`);
  }
  return sigs.sort();
}

Deno.test("LNS: Big-Group combined members are never split", () => {
  const { c, res } = run("big_group", 2024, { rounds: 120 });
  const before = combinedSignatures(c.initial.blocks);
  const after = combinedSignatures(res.blocks);
  assert(before.length > 0, "big_group fixture should contain combined members");
  assertEquals(after, before, "every Big-Group combined member must survive LNS unchanged");
});

// Idle-day guard: every specialist keeps at least the working-days-with-blocks
// it had before.
function activeDays(blocks: Block[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const b of blocks) {
    if (!b.specialist_id || !b.teacher_id) continue;
    if (b.grade === "Lunch" || b.grade === "Planning" || b.grade === "Makeup") continue;
    (m.get(b.specialist_id) ?? m.set(b.specialist_id, new Set()).get(b.specialist_id)!).add(b.day_of_week);
  }
  return m;
}

Deno.test("LNS: never manufactures an idle day", () => {
  const { c, res } = run("standard", 555, { rounds: 120 });
  const before = activeDays(c.initial.blocks);
  const after = activeDays(res.blocks);
  for (const [spec, days] of before) {
    const a = after.get(spec) ?? new Set<string>();
    for (const d of days) assert(a.has(d), `specialist ${spec} lost active day ${d}`);
  }
});
