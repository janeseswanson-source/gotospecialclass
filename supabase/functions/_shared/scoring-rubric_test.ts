import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PENALTY_KEYS, penaltyMagnitude, qualityPercent } from "./scoring-rubric.ts";

// These fixtures MUST stay identical to src/lib/scoringConstants.test.ts so the
// edge and frontend rubrics provably agree.
Deno.test("qualityPercent: perfect schedule (no penalties) = 100", () => {
  assertEquals(qualityPercent({ full_week_coverage: 600, am_pm_satisfied: 30 }), 100);
});

Deno.test("qualityPercent: empty/missing breakdown = 0", () => {
  assertEquals(qualityPercent(null), 0);
  assertEquals(qualityPercent(undefined), 0);
  assertEquals(qualityPercent({}), 100); // no penalties present → perfect
});

Deno.test("qualityPercent: sums absolute penalties / 4", () => {
  // |−40| + |−60| = 100 → 100 − 100/4 = 75
  assertEquals(qualityPercent({ subject_gap: -40, subject_day_clustering: -60 }), 75);
});

Deno.test("qualityPercent: includes spec_dayload_stdev (the term that drifted)", () => {
  assertEquals(penaltyMagnitude({ spec_dayload_stdev: -8 }), 8);
  assertEquals(qualityPercent({ spec_dayload_stdev: -8 }), 98);
});

Deno.test("qualityPercent: clamps to [0,100]", () => {
  assertEquals(qualityPercent({ errors: -1000 }), 0);
});

Deno.test("PENALTY_KEYS: the canonical term set", () => {
  assertEquals([...PENALTY_KEYS].sort(), [
    "cart_back_to_back", "class_repeats", "contract_min", "errors", "grade_cohesion",
    "k_grade_after_780", "spec_dayload_stdev", "subject_day_clustering", "subject_gap",
    "teacher_planning", "warnings",
  ]);
});
