// Phase 1c — quality-confidence tests.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeConvergence,
  estimateHeadroom,
  computeQualityConfidence,
} from "./_confidence.ts";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const school = { start_time: "08:00", end_time: "14:00", class_duration: 45, passing_time: 5 };

Deno.test("convergence: still improving when last improvement is recent", () => {
  const c = computeConvergence({ rounds: 100, lastImprovementRound: 95 });
  assert(c.stillImproving);
  assert(!c.converged);
  assertEquals(c.roundsSinceImprovement, 4);
});

Deno.test("convergence: plateaued when no improvement for a long tail", () => {
  const c = computeConvergence({ rounds: 100, lastImprovementRound: 10 });
  assert(c.converged);
  assert(!c.stillImproving);
  assertEquals(c.roundsSinceImprovement, 89);
});

Deno.test("convergence: never improved ⇒ converged (no momentum)", () => {
  const c = computeConvergence({ rounds: 50, lastImprovementRound: -1 });
  assert(c.converged);
  assertEquals(c.roundsSinceImprovement, 50);
});

Deno.test("convergence: zero rounds ⇒ converged", () => {
  const c = computeConvergence({ rounds: 0, lastImprovementRound: -1 });
  assert(c.converged);
  assertEquals(c.totalRounds, 0);
});

Deno.test("headroom: ample capacity ⇒ no forced gaps, zero unavoidable penalty", () => {
  // 5 specialists, all 5 days, 45+5 min periods, 08:00–14:00 = 360 min/day →
  // 7 sessions/day × 5 days × 5 specs = 175 capacity; 6 grades × 5 specs = 30 pairs.
  const specialists = Array.from({ length: 5 }, () => ({ working_days: DAYS, class_duration: 45 }));
  const h = estimateHeadroom({ specialists, gradeCount: 6, specialistCount: 5, school });
  assertEquals(h.requiredPairs, 30);
  assert(h.sessionCapacity >= 30, `capacity ${h.sessionCapacity} should exceed 30`);
  assertEquals(h.forcedSubjectGaps, 0);
  assertEquals(h.unavoidablePenaltyLB, 0);
  assert(h.capacityRatio > 1);
});

Deno.test("headroom: thin capacity ⇒ forced gaps with a nonzero penalty floor", () => {
  // 1 specialist working a single day can teach ~7 sessions, but 6 grades × 1
  // specialist = 6 pairs — coverable; widen demand by raising specialist count
  // via many grades and one tiny-capacity specialist.
  const specialists = [{ working_days: ["Mon"], class_duration: 45 }];
  const h = estimateHeadroom({ specialists, gradeCount: 40, specialistCount: 1, school });
  assertEquals(h.requiredPairs, 40);
  assert(h.forcedSubjectGaps > 0, "thin capacity should force gaps");
  assert(h.unavoidablePenaltyLB > 0);
  assert(h.capacityRatio < 1);
});

Deno.test("quality confidence: structurally limited dominates", () => {
  const specialists = [{ working_days: ["Mon"], class_duration: 45 }];
  const qc = computeQualityConfidence({
    breakdown: { subject_gap: -1000 },
    specialists, gradeCount: 40, school,
    refinement: { rounds: 100, lastImprovementRound: 10 },
  });
  assertEquals(qc.assessment, "structurally_limited");
  assert(qc.recommendation.includes("Add a specialist") || qc.recommendation.includes("A/B"));
});

Deno.test("quality confidence: near-optimal when converged + tiny gap", () => {
  const specialists = Array.from({ length: 5 }, () => ({ working_days: DAYS, class_duration: 45 }));
  const qc = computeQualityConfidence({
    breakdown: { subject_day_clustering: -4 }, // magnitude 4 → 1 quality point
    specialists, gradeCount: 6, school,
    refinement: { rounds: 100, lastImprovementRound: 20 }, // plateaued
  });
  assertEquals(qc.assessment, "near_optimal");
  assertEquals(qc.gapQualityPoints, 1);
});

Deno.test("quality confidence: more headroom when still improving", () => {
  const specialists = Array.from({ length: 5 }, () => ({ working_days: DAYS, class_duration: 45 }));
  const qc = computeQualityConfidence({
    breakdown: { subject_day_clustering: -4 },
    specialists, gradeCount: 6, school,
    refinement: { rounds: 100, lastImprovementRound: 98 }, // still improving
  });
  assertEquals(qc.assessment, "more_headroom");
});
