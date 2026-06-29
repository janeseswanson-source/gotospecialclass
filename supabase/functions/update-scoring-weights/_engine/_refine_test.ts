// Phase 1 — background refinement orchestrator tests.
//
// refineSchedule is the heavy out-of-request-path pass. The contract:
//   - never returns a worse schedule (quality % monotonic; accept gate)
//   - the returned schedule is always SSOT-legal (zero hard violations)
//   - deterministic (same blocks + seed ⇒ identical result)
//   - reports a confidence signal

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { refineSchedule } from "./_refine.ts";
import { generateScheduleBlocks, type Block } from "./index.ts";
import { buildScenario, countHardViolations, CHAR_STRATEGIES, type CharStrategy } from "./_characterization_fixtures.ts";

function genFixture(strategy: CharStrategy) {
  const { specialists, teachers, grades, school, recessConfigs } = buildScenario(strategy);
  const gen = generateScheduleBlocks(
    "00000000-0000-4000-a000-0000000000rf",
    specialists as never, teachers as never, grades, school, recessConfigs,
    [], [], [], [], [],
  );
  return { blocks: gen.blocks as Block[], ctx: { specialists: specialists as never, teachers: teachers as never, grades, school, recessConfigs } };
}

Deno.test("refine: never regresses and stays SSOT-legal across all fixtures", () => {
  for (const strat of CHAR_STRATEGIES) {
    const { blocks, ctx } = genFixture(strat);
    const r = refineSchedule(blocks, ctx as never, { seedKey: strat, lnsRounds: 120, saMaxIterations: 800 });
    assert(r.qualityPercent >= r.previousQualityPercent, `${strat}: quality ${r.qualityPercent} < prev ${r.previousQualityPercent}`);
    assertEquals(r.hardViolations, 0, `${strat}: returned schedule must be SSOT-legal`);
    assertEquals(countHardViolations(r.blocks, ctx.school, ctx.recessConfigs), 0);
    if (!r.improved) assertEquals(r.blocks, blocks, `${strat}: unimproved ⇒ original returned unchanged`);
  }
});

Deno.test("refine: deterministic — same blocks + seed ⇒ identical result", () => {
  const { blocks, ctx } = genFixture("standard");
  const a = refineSchedule(blocks, ctx as never, { seedKey: "x", lnsRounds: 100, saMaxIterations: 600 });
  const b = refineSchedule(blocks, ctx as never, { seedKey: "x", lnsRounds: 100, saMaxIterations: 600 });
  assertEquals(a.blocks, b.blocks);
  assertEquals(a.qualityPercent, b.qualityPercent);
  assertEquals(a.improved, b.improved);
  assertEquals(a.confidence.assessment, b.confidence.assessment);
});

Deno.test("refine: improves the complaint-school (standard) fixture", () => {
  const { blocks, ctx } = genFixture("standard");
  const r = refineSchedule(blocks, ctx as never, { seedKey: "standard", lnsRounds: 150, saMaxIterations: 1500 });
  assert(r.improved, "expected refinement to improve the standard fixture");
  assert(r.qualityPercent > r.previousQualityPercent);
});

Deno.test("refine: reports a confidence assessment", () => {
  const { blocks, ctx } = genFixture("standard");
  const r = refineSchedule(blocks, ctx as never, { seedKey: "standard", lnsRounds: 80 });
  assert(["near_optimal", "more_headroom", "structurally_limited"].includes(r.confidence.assessment));
  assert(typeof r.confidence.recommendation === "string" && r.confidence.recommendation.length > 0);
});
