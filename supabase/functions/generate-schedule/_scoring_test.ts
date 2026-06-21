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

