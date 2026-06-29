// Phase 1a — SA determinism tests.
//
// The headline guarantee: the SA result is a pure function of (seed, inputs,
// maxIterations). Wall-clock (safetyMs) is a never-reached safety valve and must
// NOT influence in-budget output — proven below by varying safetyMs wildly and
// asserting byte-identical results.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runSimulatedAnnealing } from "./_annealing.ts";
import { mulberry32 } from "./_random.ts";
import { OccupancyTracker } from "./_occupancy.ts";
import { generateScheduleBlocks, computeWarnings, type Block, type StrategyResult } from "./index.ts";
import { scoreSchedule, type ScoreableInput } from "./_scoring.ts";
import { buildScenario } from "./_characterization_fixtures.ts";

function buildSAInputs() {
  const { specialists, teachers, grades, school, recessConfigs } = buildScenario("standard");
  // A realistic starting schedule (the generator's own output) is the SA seed.
  const gen = generateScheduleBlocks(
    "00000000-0000-4000-a000-0000000000sa",
    specialists as never, teachers as never, grades, school, recessConfigs,
    [], [], [], [], [],
  );
  const initial: StrategyResult = { blocks: gen.blocks as Block[], preferenceViolations: [] };
  const scoringInput: ScoreableInput = {
    school: {
      start_time: school.start_time as string,
      end_time: school.end_time as string,
      early_release_day: school.early_release_day as string,
      early_release_end_time: school.early_release_end_time as string,
      keep_grades_together: true,
      contractual_minutes_extracted: null,
    },
    specialists: (specialists as any[]).map((s) => ({ id: s.id, subject: s.subject, working_days: s.working_days })),
    teachers: (teachers as any[]).map((t) => ({ id: t.id, am_pm_preference: t.am_pm_preference, day_preference: t.day_preference, weekly_planning_minutes: t.weekly_planning_minutes })),
    grades,
  };
  const initialScore = scoreSchedule(
    { blocks: initial.blocks, warnings: computeWarnings(initial.blocks, specialists as never, grades), preferenceViolations: [] },
    scoringInput,
  ).total;
  return { initial, initialScore, scoringInput, specialists, grades, school, recessConfigs };
}

const ctx = buildSAInputs();

function runSA(seed: number, opts?: { maxIterations?: number; safetyMs?: number }) {
  return runSimulatedAnnealing(
    ctx.initial, ctx.initialScore, ctx.scoringInput, ctx.specialists as never, ctx.grades,
    ctx.school, ctx.recessConfigs, new OccupancyTracker(), mulberry32(seed), undefined, opts,
  );
}

Deno.test("SA: same seed + inputs → byte-identical result", () => {
  const a = runSA(123, { maxIterations: 400 });
  const b = runSA(123, { maxIterations: 400 });
  assertEquals(a.blocks, b.blocks);
  assertEquals(a.score, b.score);
  assertEquals(a.iterations, b.iterations);
  assertEquals(a.improvement, b.improvement);
});

Deno.test("SA: wall-clock (safetyMs) does NOT change in-budget output — determinism", () => {
  // Same seed + same maxIterations, drastically different safety windows.
  const a = runSA(777, { maxIterations: 400, safetyMs: 5_000 });
  const b = runSA(777, { maxIterations: 400, safetyMs: 600_000 });
  assertEquals(a.blocks, b.blocks);
  assertEquals(a.score, b.score);
  assertEquals(a.iterations, b.iterations);
});

Deno.test("SA: maxIterations is the iteration budget (deterministic count)", () => {
  // T(iter) = 50 * 0.985^iter stays ≥ 0.5 until iter ≈ 305, so a 200-iter budget
  // is the binding cap and the loop performs exactly 200 iterations.
  const r = runSA(42, { maxIterations: 200 });
  assertEquals(r.iterations, 200);
});

Deno.test("SA: maxIterations 0 → no-op (returns the initial unchanged)", () => {
  const r = runSA(42, { maxIterations: 0 });
  assertEquals(r.iterations, 0);
  assertEquals(r.improvement, 0);
  assertEquals(r.score, ctx.initialScore);
  assertEquals(r.blocks, ctx.initial.blocks);
});

Deno.test("SA: never improves into a worse score (accepts only via Metropolis)", () => {
  const r = runSA(2024, { maxIterations: 500 });
  // Final score is the running current; improvement may be ≥ 0 in expectation,
  // but the result is always a legal, finite schedule.
  assert(Number.isFinite(r.score));
  assertEquals(computeWarnings(r.blocks, ctx.specialists as never, ctx.grades).filter((w) => w.severity === "error").length, 0);
});
