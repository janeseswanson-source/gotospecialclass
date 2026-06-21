import { describe, it, expect } from "vitest";
import { PENALTY_KEYS, penaltyMagnitude, qualityPercent } from "./scoringConstants";
import { breakdownToPercent } from "./optimizerScore";

// Fixtures MUST match supabase/functions/_shared/scoring-rubric_test.ts so the
// frontend and edge rubrics provably agree (no "AI Quality 89%" vs "Optimizer
// 75%" mismatches).
describe("scoringConstants.qualityPercent (parity with edge rubric)", () => {
  it("perfect schedule (no penalties) = 100", () => {
    expect(qualityPercent({ full_week_coverage: 600, am_pm_satisfied: 30 })).toBe(100);
  });
  it("empty = 100, missing = 0", () => {
    expect(qualityPercent({})).toBe(100);
    expect(qualityPercent(null)).toBe(0);
    expect(qualityPercent(undefined)).toBe(0);
  });
  it("sums absolute penalties / 4", () => {
    expect(qualityPercent({ subject_gap: -40, subject_day_clustering: -60 })).toBe(75);
  });
  it("includes spec_dayload_stdev (the term that drifted)", () => {
    expect(penaltyMagnitude({ spec_dayload_stdev: -8 })).toBe(8);
    expect(qualityPercent({ spec_dayload_stdev: -8 })).toBe(98);
  });
  it("clamps to [0,100]", () => {
    expect(qualityPercent({ errors: -1000 })).toBe(0);
  });
  it("canonical 10-term key set", () => {
    expect([...PENALTY_KEYS].sort()).toEqual([
      "cart_back_to_back", "class_repeats", "contract_min", "errors", "grade_cohesion",
      "k_grade_after_780", "spec_dayload_stdev", "subject_day_clustering", "subject_gap", "warnings",
    ]);
  });
});

describe("optimizerScore.breakdownToPercent", () => {
  it("returns null for missing breakdown (UI shows —)", () => {
    expect(breakdownToPercent(null)).toBeNull();
    expect(breakdownToPercent(undefined)).toBeNull();
  });
  it("defers to the shared rubric when present", () => {
    expect(breakdownToPercent({ subject_gap: -40, subject_day_clustering: -60 })).toBe(75);
    expect(breakdownToPercent({ spec_dayload_stdev: -8 })).toBe(98);
  });
});
