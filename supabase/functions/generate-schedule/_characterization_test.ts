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

// DELIBERATE RE-PIN (grade_pd_window, shape only): the breakdown gained a
// grade_pd_window key for the grade-level PD target. Every OTHER value below
// is byte-identical to the previous pins because these fixtures set no PD
// target, so the term measures zero — the safest kind of re-pin. The gate test
// below asserts the invariants that must hold through any future re-pin.
//
// DELIBERATE RE-PIN (wheel_alignment, default-ON wheel mode): the PM's grade
// "wheel" — every specialist services the SAME grade's classrooms in a time
// slot so that grade's teachers can meet. The wheel_alignment term (−20 per
// extra distinct grade per wave, objective-only — NOT in the quality% rubric)
// REPLACES grade_day_spread whenever wheel mode is on (they are mutually
// exclusive: a wheel forces each specialist through one grade per wave, which
// spread penalized at the same magnitude). Construction went grade-major
// (shuffleGradeBlocked + whole-grade A/B splits), so every snapshot moved —
// mostly dramatically for the better (standard −886.9 → +28.2).
//
// Re-pin gates that must NEVER regress across re-pins:
//   - hardViolations stays 0 (the invariant that never changes)
//   - full_week_coverage stays 600
//   - class_repeats not worse for the wheel-aware constructions (standard
//     −125→−100 BETTER, ab/aa_bb −325 SAME, quick_30 −225 SAME). big_group
//     −150→−225 is a known objective trade on an untouched construction (MC
//     now also prices wave purity); its rubric quality% still IMPROVES
//     (penalty magnitude 776→553) and the refine loop's reassignClassDistinct
//     targets repeats post-construction.
const EXPECTED: Record<string, CharSnapshot> = {
  standard: {
    strategy: "standard",
    totalBlocks: 126,
    teachingBlocks: 104,
    chosenStrategy: "standard",
    winningScore: 28.172,
    scoreBreakdown: {
      errors: 0, warnings: 0, full_week_coverage: 600, am_pm_satisfied: 0,
      day_pref_satisfied: 0, planning_target_met: 150, cart_back_to_back: 0,
      k_grade_after_780: 0, spec_dayload_stdev: -0.828, class_repeats: -100,
      grade_cohesion: 0, grade_day_spread: -0, wheel_alignment: -480,
      contract_min: 0, subject_gap: 0,
      subject_day_clustering: -105, teacher_planning: -36, grade_pd_window: 0,
    },
    hardViolations: 0,
  },
  ab_week: {
    strategy: "ab_week",
    totalBlocks: 142,
    teachingBlocks: 120,
    chosenStrategy: "ab_week",
    winningScore: 83.915,
    scoreBreakdown: {
      errors: 0, warnings: 0, full_week_coverage: 600, am_pm_satisfied: 0,
      day_pref_satisfied: 0, planning_target_met: 150, cart_back_to_back: 0,
      k_grade_after_780: -0, spec_dayload_stdev: -1.085, class_repeats: -325,
      grade_cohesion: 0, grade_day_spread: -0, wheel_alignment: -240,
      contract_min: 0, subject_gap: -40,
      subject_day_clustering: -60, teacher_planning: 0, grade_pd_window: 0,
    },
    hardViolations: 0,
  },
  aa_bb_week: {
    strategy: "aa_bb_week",
    totalBlocks: 142,
    teachingBlocks: 120,
    chosenStrategy: "aa_bb_week",
    winningScore: 79.014,
    scoreBreakdown: {
      errors: 0, warnings: 0, full_week_coverage: 600, am_pm_satisfied: 0,
      day_pref_satisfied: 0, planning_target_met: 150, cart_back_to_back: 0,
      k_grade_after_780: -0, spec_dayload_stdev: -0.986, class_repeats: -325,
      grade_cohesion: 0, grade_day_spread: -0, wheel_alignment: -200,
      contract_min: 0, subject_gap: -40,
      subject_day_clustering: -105, teacher_planning: 0, grade_pd_window: 0,
    },
    hardViolations: 0,
  },
  quick_30: {
    strategy: "quick_30",
    totalBlocks: 126,
    teachingBlocks: 104,
    chosenStrategy: "quick_30",
    winningScore: -516.033,
    scoreBreakdown: {
      errors: 0, warnings: 0, full_week_coverage: 600, am_pm_satisfied: 0,
      day_pref_satisfied: 0, planning_target_met: 150, cart_back_to_back: 0,
      // The MC winner changed under the wheel objective; this candidate keeps
      // one late K session (the adjacency pass can't move it early without
      // worsening wave purity — its wheel guard reverts such days wholesale).
      k_grade_after_780: -20, spec_dayload_stdev: -0.783, class_repeats: -225,
      grade_cohesion: 0, grade_day_spread: -0, wheel_alignment: -740,
      contract_min: 0, subject_gap: 0,
      subject_day_clustering: -195, teacher_planning: -65.25, grade_pd_window: 0,
    },
    hardViolations: 0,
  },
  big_group: {
    strategy: "big_group",
    totalBlocks: 130,
    teachingBlocks: 108,
    chosenStrategy: "big_group",
    winningScore: -383.095,
    scoreBreakdown: {
      errors: 0, warnings: 0, full_week_coverage: 600, am_pm_satisfied: 0,
      day_pref_satisfied: 0, planning_target_met: 150, cart_back_to_back: 0,
      k_grade_after_780: -80, spec_dayload_stdev: -1.095, class_repeats: -225,
      grade_cohesion: 0, grade_day_spread: -0, wheel_alignment: -580,
      contract_min: 0, subject_gap: -40,
      subject_day_clustering: -180, teacher_planning: -27, grade_pd_window: 0,
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

// Re-pin gates. A snapshot may be updated deliberately, but these properties
// must survive every re-pin — if one of them moves, the change is a REGRESSION
// and the pin is not the thing to edit.
Deno.test("characterization: re-pin invariants hold for every strategy", () => {
  for (const strategy of CHAR_STRATEGIES) {
    const snap = computeSnapshot(strategy);
    const b = snap.scoreBreakdown as Record<string, number>;
    assertEquals(snap.hardViolations, 0, `${strategy}: must stay SSOT-legal`);
    assertEquals(b.full_week_coverage, 600, `${strategy}: coverage must not drop`);
    assertEquals(b.errors, 0, `${strategy}: no error-severity warnings`);
    // A PD/wheel term must never be paid for by manufacturing repeat visits.
    const pinned = EXPECTED[strategy].scoreBreakdown as Record<string, number>;
    assertEquals(
      b.class_repeats,
      pinned.class_repeats,
      `${strategy}: class_repeats moved — check the change, don't re-pin it`,
    );
  }
});

// The zero-hard-violation guarantee, called out as its own assertion so a
// regression here is unmissable.
Deno.test("characterization: every fixture has ZERO hard violations (SSOT)", () => {
  for (const strategy of CHAR_STRATEGIES) {
    assertEquals(computeSnapshot(strategy).hardViolations, 0, `${strategy} must be SSOT-legal`);
  }
});
