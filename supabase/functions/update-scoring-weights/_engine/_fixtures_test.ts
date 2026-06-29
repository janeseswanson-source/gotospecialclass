// Phase 3D: end-to-end Monte Carlo fixture tests.
//
// Drives `generateScheduleBlocks` through three fixtures and asserts:
//   1. Determinism — same fixture run twice produces identical block payloads
//      (the per-generation MC seed is derived from generationId).
//   2. Preference regression guard — MC violation count ≤ Phase 3A baseline.
//   3. Health — winningScore is finite and monteCarloAttempts ≥ 1.
//   4. Wall-clock — largest fixture completes under 10 seconds.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateScheduleBlocks } from "./index.ts";
import { allFixtures, largeFixture, type FixtureInput } from "./_fixtures.ts";

function run(f: FixtureInput) {
  return generateScheduleBlocks(
    f.generationId,
    f.specialists,
    f.teachers,
    f.grades,
    f.school,
    f.recessConfigs,
    f.clubs,
    f.specialEvents,
    f.calendarEvents,
    f.adminBlocks,
  );
}

/** Block payload minus volatile per-row fields (none today, but future-proof). */
function blockSig(b: any) {
  return {
    day: b.day_of_week,
    s: b.start_time,
    e: b.end_time,
    subj: b.subject,
    spec: b.specialist_id,
    teach: b.teacher_id,
    grade: b.grade,
    room: b.room,
    week: b.week_label ?? null,
  };
}

for (const f of allFixtures) {
  Deno.test(`fixture ${f.name}: deterministic across runs`, () => {
    const a = run(f);
    const b = run(f);
    assertEquals(
      a.blocks.map(blockSig),
      b.blocks.map(blockSig),
      `${f.name}: block payload drifted between runs — MC seed is not deterministic`,
    );
    assertEquals(a.winningScore, b.winningScore, `${f.name}: winningScore drifted`);
  });

  Deno.test(`fixture ${f.name}: preference violations ≤ phase 3A baseline`, () => {
    const r = run(f);
    assert(
      r.preferenceViolations.length <= f.phase3aBaselineViolations,
      `${f.name}: MC regressed prefs — got ${r.preferenceViolations.length}, baseline ${f.phase3aBaselineViolations}`,
    );
  });

  Deno.test(`fixture ${f.name}: MC metadata present`, () => {
    const r = run(f);
    assert(Number.isFinite(r.winningScore), `${f.name}: winningScore is not finite (${r.winningScore})`);
    assert(r.monteCarloAttempts >= 1, `${f.name}: monteCarloAttempts must be ≥ 1`);
    assert(r.scoreBreakdown && typeof r.scoreBreakdown === "object", `${f.name}: scoreBreakdown missing`);
  });
}

Deno.test("large fixture: wall-clock under 10s", () => {
  const t0 = performance.now();
  const r = run(largeFixture);
  const ms = performance.now() - t0;
  console.log(`[fixture large] wall-clock ${ms.toFixed(0)}ms, attempts=${r.monteCarloAttempts}, score=${r.winningScore.toFixed(1)}`);
  assert(ms < 10_000, `large fixture took ${ms.toFixed(0)}ms (>10s budget)`);
});
