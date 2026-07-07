// Phase 0 characterization tests.
//
// These FREEZE the current observable behavior of generateScheduleBlocks on the
// realistic "complaint school" fixtures, so the monolith decomposition (and any
// later refactor that claims to be behavior-preserving) is provably so: every
// value below must stay byte-identical through a pure code move.
//
// When Phase 1 INTENTIONALLY changes the search (deterministic SA budget, LNS),
// the soft-penalty terms and winningScore here will move — those expectations are
// updated deliberately, with the Phase-1 tests asserting "soft quality ≥ snapshot
// and hard violations still 0". The hardViolations === 0 invariant never changes.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CHAR_STRATEGIES, computeSnapshot, type CharSnapshot } from "./_characterization_fixtures.ts";

// DELIBERATE RE-PIN (grade_day_spread): the new objective term penalizes each
// extra distinct grade a specialist teaches per day (−20, objective-only — NOT
// in the quality% rubric). It both adds a breakdown key and steers generation
// toward same-grade days, so every snapshot moved. The large negative
// winningScores are honest: these dense fixtures structurally require some
// spread (5 specialists × 6 grades daily), and the soft term now prices it.
// hardViolations stays 0 — the invariant that never changes.
const EXPECTED: Record<string, CharSnapshot> = {
  standard: {
    strategy: "standard",
    totalBlocks: 126,
    teachingBlocks: 104,
    chosenStrategy: "standard",
    winningScore: -886.908,
    scoreBreakdown: {
      errors: 0, warnings: 0, full_week_coverage: 600, am_pm_satisfied: 0,
      day_pref_satisfied: 0, planning_target_met: 150, cart_back_to_back: 0,
      k_grade_after_780: 0, spec_dayload_stdev: -0.908, class_repeats: -125,
      grade_cohesion: 0, grade_day_spread: -980, contract_min: 0, subject_gap: 0,
      subject_day_clustering: -495, teacher_planning: -36,
    },
    hardViolations: 0,
  },
  ab_week: {
    strategy: "ab_week",
    totalBlocks: 142,
    teachingBlocks: 120,
    chosenStrategy: "ab_week",
    winningScore: -1430.979,
    scoreBreakdown: {
      errors: 0, warnings: 0, full_week_coverage: 600, am_pm_satisfied: 0,
      day_pref_satisfied: 0, planning_target_met: 150, cart_back_to_back: 0,
      k_grade_after_780: -40, spec_dayload_stdev: -0.979, class_repeats: -325,
      grade_cohesion: 0, grade_day_spread: -1380, contract_min: 0, subject_gap: 0,
      subject_day_clustering: -435, teacher_planning: 0,
    },
    hardViolations: 0,
  },
  aa_bb_week: {
    strategy: "aa_bb_week",
    totalBlocks: 142,
    teachingBlocks: 120,
    chosenStrategy: "aa_bb_week",
    winningScore: -1381.27,
    scoreBreakdown: {
      errors: 0, warnings: 0, full_week_coverage: 600, am_pm_satisfied: 0,
      day_pref_satisfied: 0, planning_target_met: 150, cart_back_to_back: 0,
      k_grade_after_780: -40, spec_dayload_stdev: -1.27, class_repeats: -325,
      grade_cohesion: 0, grade_day_spread: -1180, contract_min: 0, subject_gap: 0,
      subject_day_clustering: -585, teacher_planning: 0,
    },
    hardViolations: 0,
  },
  quick_30: {
    strategy: "quick_30",
    totalBlocks: 126,
    teachingBlocks: 104,
    chosenStrategy: "quick_30",
    winningScore: -1039.533,
    scoreBreakdown: {
      errors: 0, warnings: 0, full_week_coverage: 600, am_pm_satisfied: 0,
      day_pref_satisfied: 0, planning_target_met: 150, cart_back_to_back: 0,
      k_grade_after_780: -20, spec_dayload_stdev: -0.783, class_repeats: -225,
      grade_cohesion: 0, grade_day_spread: -1000, contract_min: 0, subject_gap: 0,
      subject_day_clustering: -480, teacher_planning: -63.75,
    },
    hardViolations: 0,
  },
  big_group: {
    strategy: "big_group",
    totalBlocks: 131,
    teachingBlocks: 109,
    chosenStrategy: "big_group",
    winningScore: -966.074,
    scoreBreakdown: {
      errors: 0, warnings: 0, full_week_coverage: 600, am_pm_satisfied: 0,
      day_pref_satisfied: 0, planning_target_met: 150, cart_back_to_back: 0,
      k_grade_after_780: 0, spec_dayload_stdev: -1.324, class_repeats: -150,
      grade_cohesion: 0, grade_day_spread: -940, contract_min: 0, subject_gap: 0,
      subject_day_clustering: -600, teacher_planning: -24.75,
    },
    hardViolations: 0,
  },
};

for (const strategy of CHAR_STRATEGIES) {
  Deno.test(`characterization: ${strategy} snapshot is stable`, () => {
    const snap = computeSnapshot(strategy);
    assertEquals(snap, EXPECTED[strategy]);
  });
}

// Determinism: the same fixture + same generator → identical output, twice.
Deno.test("characterization: generation is deterministic (same seed → identical)", () => {
  for (const strategy of CHAR_STRATEGIES) {
    const a = computeSnapshot(strategy);
    const b = computeSnapshot(strategy);
    assertEquals(a, b);
  }
});

// The zero-hard-violation guarantee, called out as its own assertion so a
// regression here is unmissable.
Deno.test("characterization: every fixture has ZERO hard violations (SSOT)", () => {
  for (const strategy of CHAR_STRATEGIES) {
    assertEquals(computeSnapshot(strategy).hardViolations, 0, `${strategy} must be SSOT-legal`);
  }
});
