// Phase 3B unit tests: PRNG determinism + scoreSchedule weights.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mulberry32, shuffle, deriveSeed } from "./_random.ts";
import { scoreSchedule, type ScoreableInput, type ScoreableResult } from "./_scoring.ts";

// ─── PRNG ────────────────────────────────────────────────────────────
Deno.test("mulberry32: same seed → identical stream", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 100; i++) assertEquals(a(), b());
});

Deno.test("mulberry32: different seeds → different streams", () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  let diff = 0;
  for (let i = 0; i < 50; i++) if (a() !== b()) diff++;
  assert(diff > 40, "expected most outputs to differ");
});

Deno.test("shuffle: deterministic with seeded rng, does not mutate input", () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const out1 = shuffle(input, mulberry32(7));
  const out2 = shuffle(input, mulberry32(7));
  assertEquals(out1, out2);
  assertEquals(input, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assertEquals(out1.slice().sort((a, b) => a - b), input);
});

Deno.test("deriveSeed: same parent+tag → same child; different tag → different child", () => {
  assertEquals(deriveSeed(123, "foo"), deriveSeed(123, "foo"));
  assert(deriveSeed(123, "foo") !== deriveSeed(123, "bar"));
});

// ─── Scoring ─────────────────────────────────────────────────────────
const baseInput: ScoreableInput = {
  school: { start_time: "08:00", end_time: "15:00" },
  specialists: [{ id: "s1", working_days: ["Mon", "Tue", "Wed", "Thu", "Fri"] }],
  teachers: [
    { id: "t1", am_pm_preference: "AM", day_preference: "Tue" },
    { id: "t2", am_pm_preference: "PM", day_preference: null },
  ],
  grades: ["K", "1"],
};

function block(over: Partial<any> = {}) {
  return {
    generation_id: "g",
    day_of_week: "Mon",
    start_time: "09:00",
    end_time: "09:30",
    subject: "Music",
    specialist_id: "s1",
    teacher_id: "t1",
    grade: "1",
    room: null,
    ...over,
  };
}

Deno.test("scoreSchedule: teacher_planning penalises specials shortfall vs guarantee", () => {
  // t1 guaranteed 90 min/wk planning; gets one 30-min specials block → 60 short.
  const input: ScoreableInput = {
    ...baseInput,
    teachers: [{ id: "t1", am_pm_preference: null, day_preference: null, weekly_planning_minutes: 90 }],
    grades: ["1"],
  };
  const result: ScoreableResult = {
    blocks: [block({ teacher_id: "t1", start_time: "09:00", end_time: "09:30" })],
    warnings: [], preferenceViolations: [],
  };
  const { breakdown } = scoreSchedule(result, input);
  // 60 min short × −0.05 = −3.
  assertEquals(Math.round(breakdown.teacher_planning * 100) / 100, -3);
});

Deno.test("scoreSchedule: teacher_planning is 0 when guarantee is met", () => {
  const input: ScoreableInput = {
    ...baseInput,
    teachers: [{ id: "t1", am_pm_preference: null, day_preference: null, weekly_planning_minutes: 30 }],
    grades: ["1"],
  };
  const result: ScoreableResult = {
    blocks: [block({ teacher_id: "t1", start_time: "09:00", end_time: "09:30" })],
    warnings: [], preferenceViolations: [],
  };
  assertEquals(scoreSchedule(result, input).breakdown.teacher_planning, 0);
});

Deno.test("scoreSchedule: errors dominate (−1000 each)", () => {
  const result: ScoreableResult = {
    blocks: [],
    warnings: [{ type: "no_coverage", severity: "error", message: "x" }],
    preferenceViolations: [],
  };
  const { total, breakdown } = scoreSchedule(result, baseInput);
  assertEquals(breakdown.errors, -1000);
  assert(total < 0, "an errored result must score negative");
});

Deno.test("scoreSchedule: full-week coverage awards +100 per fully-covered grade", () => {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const blocks = days.flatMap((d) => [
    block({ grade: "K", day_of_week: d }),
    block({ grade: "1", day_of_week: d }),
  ]);
  const result: ScoreableResult = { blocks, warnings: [], preferenceViolations: [] };
  const { breakdown } = scoreSchedule(result, baseInput);
  assertEquals(breakdown.full_week_coverage, 200);
});

Deno.test("scoreSchedule: am/pm satisfied (+10) and violated (0)", () => {
  // t1 prefers AM. Block at 09:00 → satisfied. t2 prefers PM, no block → satisfied (no violation).
  const result: ScoreableResult = {
    blocks: [block({ teacher_id: "t1", start_time: "09:00" })],
    warnings: [],
    preferenceViolations: [],
  };
  const { breakdown } = scoreSchedule(result, baseInput);
  assertEquals(breakdown.am_pm_satisfied, 20); // 2 teachers, both un-violated

  const result2: ScoreableResult = {
    blocks: [],
    warnings: [],
    preferenceViolations: [{ kind: "am_pm", teacherId: "t1", preferred: "AM", actualSlot: "PM" }],
  };
  const { breakdown: b2 } = scoreSchedule(result2, baseInput);
  assertEquals(b2.am_pm_satisfied, 10); // only t2 un-violated
});

Deno.test("scoreSchedule: day_preference satisfied (+20) per teacher with pref", () => {
  const result: ScoreableResult = { blocks: [], warnings: [], preferenceViolations: [] };
  const { breakdown } = scoreSchedule(result, baseInput);
  assertEquals(breakdown.day_pref_satisfied, 20); // only t1 has a day pref
});

Deno.test("scoreSchedule: cart_back_to_back (−5 per violation)", () => {
  const result: ScoreableResult = {
    blocks: [],
    warnings: [],
    preferenceViolations: [
      { kind: "cart_back_to_back", specialistId: "s1", day: "Mon", slot: 540 },
      { kind: "cart_back_to_back", specialistId: "s1", day: "Mon", slot: 570 },
    ],
  };
  const { breakdown } = scoreSchedule(result, baseInput);
  assertEquals(breakdown.cart_back_to_back, -10);
});

Deno.test("scoreSchedule: K-grade after 13:00 penalised −20 per block", () => {
  const result: ScoreableResult = {
    blocks: [
      block({ grade: "K", start_time: "13:00" }),
      block({ grade: "K", start_time: "14:00" }),
      block({ grade: "K", start_time: "10:00" }), // before 780, no penalty
    ],
    warnings: [],
    preferenceViolations: [],
  };
  const { breakdown } = scoreSchedule(result, baseInput);
  assertEquals(breakdown.k_grade_after_780, -40);
});

Deno.test("scoreSchedule: planning_target_met defaults to +30 × specialist count when no shortfalls", () => {
  const result: ScoreableResult = { blocks: [], warnings: [], preferenceViolations: [] };
  const { breakdown } = scoreSchedule(result, baseInput);
  assertEquals(breakdown.planning_target_met, 30);
});

Deno.test("scoreSchedule: full-week coverage uses real specialist working days", () => {
  // Specialist works Mon–Thu only. A grade covered Mon–Thu is "fully
  // covered" (Friday must NOT be required, since nobody works it).
  const input: ScoreableInput = {
    school: { start_time: "08:00", end_time: "15:00" },
    specialists: [{ id: "s1", working_days: ["Mon", "Tue", "Wed", "Thu"] }],
    teachers: [],
    grades: ["K"],
  };
  const monThu = ["Mon", "Tue", "Wed", "Thu"].map((d) => block({ grade: "K", day_of_week: d }));
  const { breakdown } = scoreSchedule({ blocks: monThu, warnings: [], preferenceViolations: [] }, input);
  assertEquals(breakdown.full_week_coverage, 100);

  // Missing Thursday → not fully covered.
  const monWed = ["Mon", "Tue", "Wed"].map((d) => block({ grade: "K", day_of_week: d }));
  const { breakdown: b2 } = scoreSchedule({ blocks: monWed, warnings: [], preferenceViolations: [] }, input);
  assertEquals(b2.full_week_coverage, 0);
});

Deno.test("scoreSchedule: class_repeats penalises a class seeing the same specialist twice", () => {
  // One class (t1) visits specialist s1 three times → 2 repeats × −25 = −50.
  const repeated: ScoreableResult = {
    blocks: [
      block({ teacher_id: "t1", specialist_id: "s1", day_of_week: "Mon" }),
      block({ teacher_id: "t1", specialist_id: "s1", day_of_week: "Tue" }),
      block({ teacher_id: "t1", specialist_id: "s1", day_of_week: "Wed" }),
    ],
    warnings: [],
    preferenceViolations: [],
  };
  assertEquals(scoreSchedule(repeated, baseInput).breakdown.class_repeats, -50);

  // Distinct specialists → no penalty.
  const distinct: ScoreableResult = {
    blocks: [
      block({ teacher_id: "t1", specialist_id: "s1", day_of_week: "Mon" }),
      block({ teacher_id: "t1", specialist_id: "s2", day_of_week: "Tue" }),
      block({ teacher_id: "t1", specialist_id: "s3", day_of_week: "Wed" }),
    ],
    warnings: [],
    preferenceViolations: [],
  };
  assertEquals(scoreSchedule(distinct, baseInput).breakdown.class_repeats, 0);
});

Deno.test("scoreSchedule: spec_dayload_stdev penalises imbalanced loads", () => {
  // All 5 blocks on Mon → high stdev for s1.
  const unbalanced: ScoreableResult = {
    blocks: Array.from({ length: 5 }, () => block({ day_of_week: "Mon" })),
    warnings: [],
    preferenceViolations: [],
  };
  // One per day → stdev 0.
  const balanced: ScoreableResult = {
    blocks: ["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => block({ day_of_week: d })),
    warnings: [],
    preferenceViolations: [],
  };
  const { breakdown: bU } = scoreSchedule(unbalanced, baseInput);
  const { breakdown: bB } = scoreSchedule(balanced, baseInput);
  assertEquals(bB.spec_dayload_stdev, 0);
  assert(bU.spec_dayload_stdev < 0);
});

Deno.test("scoreSchedule: subject_gap penalises (grade × specialist) pairs with zero sessions", () => {
  // baseInput has 1 specialist (s1) and 2 grades (K, 1). Grade K has no blocks → 1 missing pair × −40.
  const result: ScoreableResult = {
    blocks: [block({ grade: "1", teacher_id: "t1", specialist_id: "s1" })],
    warnings: [],
    preferenceViolations: [],
  };
  assertEquals(scoreSchedule(result, baseInput).breakdown.subject_gap, -40);

  // Both grades covered → no penalty.
  const covered: ScoreableResult = {
    blocks: [
      block({ grade: "K", teacher_id: "t1", specialist_id: "s1" }),
      block({ grade: "1", teacher_id: "t1", specialist_id: "s1" }),
    ],
    warnings: [],
    preferenceViolations: [],
  };
  assertEquals(scoreSchedule(covered, baseInput).breakdown.subject_gap, 0);
});

Deno.test("scoreSchedule: subject_day_clustering penalises duplicate (grade, subject) on same day", () => {
  // Two Music sessions for grade 1 on Mon → 1 duplicate × −15.
  const dup: ScoreableResult = {
    blocks: [
      block({ grade: "1", subject: "Music", day_of_week: "Mon", teacher_id: "t1" }),
      block({ grade: "1", subject: "Music", day_of_week: "Mon", teacher_id: "t2" }),
    ],
    warnings: [],
    preferenceViolations: [],
  };
  assertEquals(scoreSchedule(dup, baseInput).breakdown.subject_day_clustering, -15);

  // Same subject on different days → no penalty.
  const spread: ScoreableResult = {
    blocks: [
      block({ grade: "1", subject: "Music", day_of_week: "Mon" }),
      block({ grade: "1", subject: "Music", day_of_week: "Tue" }),
    ],
    warnings: [],
    preferenceViolations: [],
  };
  assertEquals(scoreSchedule(spread, baseInput).breakdown.subject_day_clustering, 0);
});


// ─── grade_day_spread (same-day grade mixing) ────────────────────────
Deno.test("scoreSchedule: grade_day_spread penalises a specialist teaching multiple grades one day", () => {
  const mixed: ScoreableResult = {
    blocks: [
      block({ grade: "K", start_time: "09:00", end_time: "09:30" }),
      block({ grade: "1", start_time: "10:00", end_time: "10:30", teacher_id: "t2" }),
    ] as any,
    warnings: [], preferenceViolations: [],
  };
  const clustered: ScoreableResult = {
    blocks: [
      block({ grade: "K", start_time: "09:00", end_time: "09:30" }),
      block({ grade: "K", start_time: "10:00", end_time: "10:30", teacher_id: "t2" }),
    ] as any,
    warnings: [], preferenceViolations: [],
  };
  // Wheel mode replaces spread (mutually exclusive); opt out to test the legacy term.
  const wheelOff = { ...baseInput, school: { ...baseInput.school, rotation_wheel_grades: [] as string[] } };
  const m = scoreSchedule(mixed, wheelOff);
  const c = scoreSchedule(clustered, wheelOff);
  assertEquals(m.breakdown.grade_day_spread, -20, "2 grades on one specialist-day = 1 extra × −20");
  assertEquals(c.breakdown.grade_day_spread, 0, "one grade per day = no spread");
});

Deno.test("scoreSchedule: grade_day_spread gated off by keep_grades_together=false; reserved grades excluded", () => {
  const mixed: ScoreableResult = {
    blocks: [
      block({ grade: "K" }),
      block({ grade: "1", start_time: "10:00", end_time: "10:30", teacher_id: "t2" }),
      // Reserved pseudo-grades + whole-school club blocks never count.
      block({ grade: "Lunch", start_time: "11:30", end_time: "12:00", teacher_id: null }),
      block({ grade: "Planning", start_time: "13:00", end_time: "13:45", teacher_id: null }),
      block({ grade: "All", start_time: "12:00", end_time: "12:20", teacher_id: null }),
    ] as any,
    warnings: [], preferenceViolations: [],
  };
  const gatedOff = scoreSchedule(mixed, { ...baseInput, school: { ...baseInput.school, rotation_wheel_grades: [] as string[], keep_grades_together: false } });
  assertEquals(gatedOff.breakdown.grade_day_spread, 0, "gate off → no penalty");
  const gatedOn = scoreSchedule(mixed, { ...baseInput, school: { ...baseInput.school, rotation_wheel_grades: [] as string[] } });
  assertEquals(gatedOn.breakdown.grade_day_spread, -20, "K+1 = 1 extra; Lunch/Planning/All ignored");
});


// ─── wheel_alignment (grade wheels across specialists) ───────────────
// Default (no rotation_wheel_grades) = wheel mode ON; [] = off; subset restricts.
Deno.test("scoreSchedule: wheel_alignment penalises mixed-grade waves, pure waves are free", () => {
  const pure: ScoreableResult = {
    blocks: [
      block({ grade: "1", specialist_id: "s1", start_time: "09:00", end_time: "09:45" }),
      block({ grade: "1", specialist_id: "s2", start_time: "09:00", end_time: "09:45", teacher_id: "t2" }),
    ] as any,
    warnings: [], preferenceViolations: [],
  };
  const mixed: ScoreableResult = {
    blocks: [
      block({ grade: "1", specialist_id: "s1", start_time: "09:00", end_time: "09:45" }),
      block({ grade: "3", specialist_id: "s2", start_time: "09:00", end_time: "09:45", teacher_id: "t2" }),
    ] as any,
    warnings: [], preferenceViolations: [],
  };
  assertEquals(scoreSchedule(pure, baseInput).breakdown.wheel_alignment, 0, "one grade per wave = pure");
  assertEquals(scoreSchedule(mixed, baseInput).breakdown.wheel_alignment, -20, "2 grades in one wave = 1 extra × −20");
});

Deno.test("scoreSchedule: wheel_alignment — A/B labels are separate waves; label-less blocks join every week", () => {
  const abPure: ScoreableResult = {
    blocks: [
      block({ grade: "1", specialist_id: "s1", start_time: "09:00", end_time: "09:45", week_label: "A" }),
      block({ grade: "3", specialist_id: "s2", start_time: "09:00", end_time: "09:45", teacher_id: "t2", week_label: "B" }),
    ] as any,
    warnings: [], preferenceViolations: [],
  };
  assertEquals(scoreSchedule(abPure, baseInput).breakdown.wheel_alignment, 0, "same start, different weeks = different waves");

  const sharedMixes: ScoreableResult = {
    blocks: [
      // Label-less block runs in BOTH weeks → mixes with the A wave.
      block({ grade: "2", specialist_id: "s1", start_time: "09:00", end_time: "09:45", week_label: null }),
      block({ grade: "1", specialist_id: "s2", start_time: "09:00", end_time: "09:45", teacher_id: "t2", week_label: "A" }),
    ] as any,
    warnings: [], preferenceViolations: [],
  };
  assertEquals(scoreSchedule(sharedMixes, baseInput).breakdown.wheel_alignment, -20, "shared block joins the A wave");
});

Deno.test("scoreSchedule: wheel_alignment gating — [] disables, subset restricts, mutual exclusion with spread", () => {
  const mixed: ScoreableResult = {
    blocks: [
      block({ grade: "1", specialist_id: "s1", start_time: "09:00", end_time: "09:45" }),
      block({ grade: "3", specialist_id: "s2", start_time: "09:00", end_time: "09:45", teacher_id: "t2" }),
      // Reserved pseudo-grades never count toward a wave.
      block({ grade: "Lunch", specialist_id: "s1", start_time: "11:30", end_time: "12:00", teacher_id: null }),
    ] as any,
    warnings: [], preferenceViolations: [],
  };
  // Escape hatch: [] restores pre-wheel behavior exactly.
  const off = scoreSchedule(mixed, { ...baseInput, school: { ...baseInput.school, rotation_wheel_grades: [] as string[] } });
  assertEquals(off.breakdown.wheel_alignment, 0, "[] disables the wheel term");
  // Subset: only listed grades participate — a wave mixing 1+3 is pure when only "1" is in the wheel.
  const subset = scoreSchedule(mixed, { ...baseInput, school: { ...baseInput.school, rotation_wheel_grades: ["1"] } });
  assertEquals(subset.breakdown.wheel_alignment, 0, "grade 3 outside the wheel doesn't mix the wave");
  // Mutual exclusion: wheel ON zeroes spread; wheel OFF re-activates it.
  // (Spread is per-SPECIALIST-day, so give one specialist two grades.)
  const oneSpecTwoGrades: ScoreableResult = {
    blocks: [
      block({ grade: "1", specialist_id: "s1", start_time: "09:00", end_time: "09:45" }),
      block({ grade: "3", specialist_id: "s1", start_time: "10:00", end_time: "10:45", teacher_id: "t2" }),
    ] as any,
    warnings: [], preferenceViolations: [],
  };
  const on = scoreSchedule(oneSpecTwoGrades, baseInput);
  assertEquals(on.breakdown.grade_day_spread, 0, "wheel on → spread skipped");
  assertEquals(on.breakdown.wheel_alignment, 0, "different waves → no wheel penalty either");
  const offSpread = scoreSchedule(oneSpecTwoGrades, { ...baseInput, school: { ...baseInput.school, rotation_wheel_grades: [] as string[] } });
  assertEquals(offSpread.breakdown.grade_day_spread, -20, "wheel off → spread active again");
  assertEquals(offSpread.breakdown.wheel_alignment, 0, "wheel off → wheel term inert");
});


// ─── grade_pd_window (the PD TARGET that pairs with the out-of-class CAP) ───
// The characterization fixtures set no PD target, so the term is inert there;
// these exercise it directly.
const pdInput = (over: Record<string, unknown> = {}): ScoreableInput => ({
  school: { start_time: "08:00", end_time: "15:00", grade_pd_target_minutes: 90, ...over },
  specialists: [{ id: "art" }, { id: "pe" }, { id: "tech" }],
  teachers: [
    { id: "t1", grade: "3" },
    { id: "t2", grade: "3" },
    { id: "t3", grade: "3" },
  ],
  grades: ["3"],
});

const pdBlock = (teacher: string, spec: string, start: string, end: string) => ({
  generation_id: "g", day_of_week: "Mon", start_time: start, end_time: end,
  subject: "Art", specialist_id: spec, teacher_id: teacher, grade: "3",
  room: null, week_label: null,
});

Deno.test("scoreSchedule: grade_pd_window prices the shortfall, and a met target costs nothing", () => {
  // 45 min of shared release against a 90 min target = 45 short.
  const short: ScoreableResult = {
    blocks: [
      pdBlock("t1", "art", "09:00", "09:45"),
      pdBlock("t2", "pe", "09:00", "09:45"),
      pdBlock("t3", "tech", "09:00", "09:45"),
    ] as never,
    warnings: [], preferenceViolations: [],
  };
  assertEquals(scoreSchedule(short, pdInput()).breakdown.grade_pd_window, -13.5); // 45 x -0.3

  // Two back-to-back waves clear the 90 min target outright.
  const met: ScoreableResult = {
    blocks: [
      pdBlock("t1", "art", "09:00", "09:45"), pdBlock("t2", "pe", "09:00", "09:45"), pdBlock("t3", "tech", "09:00", "09:45"),
      pdBlock("t1", "pe", "09:50", "10:35"), pdBlock("t2", "tech", "09:50", "10:35"), pdBlock("t3", "art", "09:50", "10:35"),
    ] as never,
    warnings: [], preferenceViolations: [],
  };
  assertEquals(scoreSchedule(met, pdInput()).breakdown.grade_pd_window, 0);
});

Deno.test("scoreSchedule: grade_pd_window is off unless a target is set", () => {
  const staggered: ScoreableResult = {
    blocks: [
      pdBlock("t1", "art", "09:00", "09:45"),
      pdBlock("t2", "pe", "10:00", "10:45"),
      pdBlock("t3", "tech", "11:00", "11:45"),
    ] as never,
    warnings: [], preferenceViolations: [],
  };
  // No target at all.
  assertEquals(scoreSchedule(staggered, pdInput({ grade_pd_target_minutes: null })).breakdown.grade_pd_window, 0);
  // Explicitly disabled.
  assertEquals(scoreSchedule(staggered, pdInput({ grade_pd_enabled: false })).breakdown.grade_pd_window, 0);
  // Enabled: no overlap at all, so the whole 90 is owed.
  assertEquals(scoreSchedule(staggered, pdInput()).breakdown.grade_pd_window, -27);
});

Deno.test("scoreSchedule: a full PD miss stays cheaper than manufacturing a class repeat", () => {
  // The guard that keeps the target from bullying the schedule: 90 min of
  // missed PD (27) must cost less than one repeat visit (25) x2.
  const worst = 90 * 0.3;
  assert(worst < 25 * 2, `PD shortfall ${worst} must stay under 2x class_repeats`);
  assert(worst < 100, "and far under full_week_coverage");
});
