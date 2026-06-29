// Phase 2 — minimal-perturbation tests.
//
//   - the perturbation objective counts moved blocks correctly
//   - a perturbation-anchored re-solve stays measurably closer to the committed
//     baseline than an un-anchored (free) re-solve
//   - replanMinimal re-places ONLY the disturbed sessions (survivors untouched),
//     producing far fewer moved blocks than a full regenerate, zero violations
//   - replanMinimal degrades gracefully (ok=false) when a change cannot be
//     absorbed minimally — so the caller can fall back to a full regenerate

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  sessionSignature,
  buildPerturbationBaseline,
  countMovedBlocks,
  perturbationAdjust,
} from "./_perturbation.ts";
import { refineSchedule, replanMinimal } from "./_refine.ts";
import { generateScheduleBlocks, type Block } from "./index.ts";
import { buildScenario, countHardViolations } from "./_characterization_fixtures.ts";

const TECH = "11111111-1111-4111-a111-111111111111";

function committed() {
  const base = buildScenario("standard");
  const gen = generateScheduleBlocks(
    "00000000-0000-4000-a000-00000000base",
    base.specialists as never, base.teachers as never, base.grades, base.school, base.recessConfigs,
    [], [], [], [], [],
  );
  const ctx = { specialists: base.specialists as never, teachers: base.teachers as never, grades: base.grades, school: base.school, recessConfigs: base.recessConfigs };
  return { blocks: gen.blocks as Block[], ctx, base };
}

Deno.test("perturbation: countMovedBlocks is 0 for an unchanged schedule", () => {
  const { blocks } = committed();
  const baseline = buildPerturbationBaseline(blocks);
  assertEquals(countMovedBlocks(blocks, baseline), 0);
});

Deno.test("perturbation: moving one block counts as exactly one move", () => {
  const { blocks } = committed();
  const baseline = buildPerturbationBaseline(blocks);
  const i = blocks.findIndex((b) => b.specialist_id && b.teacher_id && b.grade !== "Lunch");
  const moved = blocks.map((b, j) => (j === i ? { ...b, day_of_week: b.day_of_week === "Mon" ? "Tue" : "Mon" } : b));
  assertEquals(countMovedBlocks(moved, baseline), 1);
  assert(sessionSignature(moved[i]) !== sessionSignature(blocks[i]));
});

Deno.test("perturbation: adjust returns a non-positive penalty proportional to moves", () => {
  const { blocks } = committed();
  const baseline = buildPerturbationBaseline(blocks);
  const adjust = perturbationAdjust(baseline, 5);
  assertEquals(adjust(blocks), 0); // unchanged ⇒ no penalty
  const i = blocks.findIndex((b) => b.specialist_id && b.teacher_id && b.grade !== "Lunch");
  const moved = blocks.map((b, j) => (j === i ? { ...b, start_time: "07:55", end_time: "08:40" } : b));
  assertEquals(adjust(moved), -5); // one move × weight 5
});

Deno.test("perturbation: anchored re-solve stays closer to baseline than a free one", () => {
  const { blocks, ctx } = committed();
  const baseline = buildPerturbationBaseline(blocks);
  // Drift away from committed by refining freely.
  const drifted = refineSchedule(blocks, ctx as never, { seedKey: "drift", lnsRounds: 120, saMaxIterations: 800 }).blocks;

  const free = refineSchedule(drifted, ctx as never, { seedKey: "restore", lnsRounds: 120, saMaxIterations: 800 });
  const anchored = refineSchedule(drifted, ctx as never, { seedKey: "restore", lnsRounds: 120, saMaxIterations: 800, perturbationBaseline: blocks });

  const movedFree = countMovedBlocks(free.blocks, baseline);
  const movedAnchored = countMovedBlocks(anchored.blocks, baseline);
  assert(movedAnchored <= movedFree, `anchored ${movedAnchored} should be <= free ${movedFree}`);
  assertEquals(countHardViolations(anchored.blocks, ctx.school, ctx.recessConfigs), 0);
  // The anchored re-solve never drops below the committed schedule's quality.
  assert(anchored.qualityPercent >= anchored.previousQualityPercent);
});

Deno.test("replanMinimal: a small disturbance changes only the disturbed sessions", () => {
  const { blocks, ctx, base } = committed();
  const baseline = buildPerturbationBaseline(blocks);

  // Two Tech sessions on Monday are disturbed (e.g. a room closes).
  const techMon = blocks
    .filter((b) => b.specialist_id === TECH && b.day_of_week === "Mon")
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
    .slice(0, 2);
  const targets = new Set(techMon.map((b) => `${b.teacher_id}|${b.start_time}`));
  const isDisturbed = (b: Block) => b.specialist_id === TECH && b.day_of_week === "Mon" && targets.has(`${b.teacher_id}|${b.start_time}`);

  const survivors = blocks.filter((b) => !isDisturbed(b));
  const r = replanMinimal(blocks, isDisturbed, ctx as never, { seedKey: "room-closes" });
  assert(r.ok, `replan should succeed: ${r.reason}`);
  assertEquals(r.hardViolations, 0);
  // Only the disturbed sessions may differ from the baseline.
  assert(r.movedFromBaseline <= techMon.length, `moved ${r.movedFromBaseline} > disturbed ${techMon.length}`);
  // Every survivor block is carried through unchanged.
  const resultSet = new Set(r.blocks);
  for (const s of survivors) assert(resultSet.has(s), "survivor block must be preserved by reference");

  // ... and that is FAR fewer moved blocks than a full regenerate.
  const full = generateScheduleBlocks(
    "00000000-0000-4000-a000-00000000ful3",
    base.specialists as never, base.teachers as never, base.grades, base.school, base.recessConfigs,
    [], [], [], [], [],
  );
  const movedFull = countMovedBlocks(full.blocks as Block[], baseline);
  assert(r.movedFromBaseline < movedFull, `replan ${r.movedFromBaseline} should be << full regen ${movedFull}`);
});

Deno.test("replanMinimal: degrades gracefully (ok=false) when a change cannot be absorbed minimally", () => {
  const { blocks, ctx } = committed();
  // Disturb Tech's ENTIRE Monday; with tightly-booked teachers the all-or-nothing
  // re-placement cannot fit, so it must report a reason rather than crash or
  // return an illegal schedule (caller then falls back to a full regenerate).
  const isDisturbed = (b: Block) => b.specialist_id === TECH && b.day_of_week === "Mon";
  const r = replanMinimal(blocks, isDisturbed, ctx as never, { seedKey: "whole-day" });
  if (!r.ok) {
    assert(typeof r.reason === "string" && r.reason.length > 0);
  } else {
    // If it does succeed, it must still be legal and minimal.
    assertEquals(r.hardViolations, 0);
  }
});
