import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildConstraintContext,
  violations,
  type ConstraintBlock,
} from "./constraints.ts";

const school = {
  start_time: "08:00",
  end_time: "15:00",
  early_release_day: "Wednesday",
  early_release_end_time: "13:00",
  recess_grade_bands: [
    { key: "primary", grades: ["K", "1", "2"] },
    { key: "intermediate", grades: ["3", "4", "5"] },
  ],
};

const recessConfigs = [
  {
    grade_band: "primary",
    am_recess_start: "10:00",
    am_recess_end: "10:15",
    lunch_start: "11:30",
    lunch_end: "12:00",
  },
  {
    grade_band: "intermediate",
    lunch_start: "12:00",
    lunch_end: "12:30",
  },
];

// A persisted PLC/Admin lock for grade 4 on Monday 09:00–09:45.
const plcBlock: ConstraintBlock = {
  id: "plc-1",
  day_of_week: "Mon",
  start_time: "09:00",
  end_time: "09:45",
  specialist_id: null,
  teacher_id: null,
  grade: "4",
  subject: "PLC/Admin",
};

// An existing Art block: specialist S1 teaches grade 5 / teacher T5, Mon 09:00–09:45.
const artBlock: ConstraintBlock = {
  id: "art-1",
  day_of_week: "Mon",
  start_time: "09:00",
  end_time: "09:45",
  specialist_id: "S1",
  teacher_id: "T5",
  grade: "5",
  subject: "Art",
};

const allBlocks = [plcBlock, artBlock];
const ctx = buildConstraintContext(school, recessConfigs, allBlocks);

Deno.test("legal placement returns no violations", () => {
  const candidate: ConstraintBlock = {
    id: "new",
    day_of_week: "Mon",
    start_time: "13:00",
    end_time: "13:45",
    specialist_id: "S2",
    teacher_id: "T1",
    grade: "1",
  };
  assertEquals(violations(candidate, allBlocks, ctx), []);
});

Deno.test("rejects block during the grade's lunch (recess)", () => {
  const candidate: ConstraintBlock = {
    id: "new",
    day_of_week: "Mon",
    start_time: "11:45", // inside primary lunch 11:30–12:00
    end_time: "12:15",
    specialist_id: "S2",
    teacher_id: "T1",
    grade: "1",
  };
  assertEquals(violations(candidate, allBlocks, ctx).includes("recess"), true);
});

Deno.test("a different band's lunch does not block this grade", () => {
  // Intermediate lunch is 12:00–12:30; a primary (grade 1) class then is fine.
  const candidate: ConstraintBlock = {
    id: "new",
    day_of_week: "Mon",
    start_time: "12:00",
    end_time: "12:30",
    specialist_id: "S2",
    teacher_id: "T1",
    grade: "1",
  };
  assertEquals(violations(candidate, allBlocks, ctx).includes("recess"), false);
});

Deno.test("rejects block before school start (outside hours)", () => {
  const candidate: ConstraintBlock = {
    id: "new",
    day_of_week: "Mon",
    start_time: "07:30",
    end_time: "08:15",
    specialist_id: "S2",
    teacher_id: "T1",
    grade: "1",
  };
  assertEquals(violations(candidate, allBlocks, ctx).includes("outside_hours"), true);
});

Deno.test("respects early-release end time on Wednesday", () => {
  // Wed dismissal is 13:00; a block ending 13:45 is outside hours.
  const candidate: ConstraintBlock = {
    id: "new",
    day_of_week: "Wed",
    start_time: "13:00",
    end_time: "13:45",
    specialist_id: "S2",
    teacher_id: "T1",
    grade: "1",
  };
  assertEquals(violations(candidate, allBlocks, ctx).includes("outside_hours"), true);

  // Same block on Monday (normal dismissal 15:00) is fine.
  const monday = { ...candidate, day_of_week: "Mon" };
  assertEquals(violations(monday, allBlocks, ctx).includes("outside_hours"), false);
});

Deno.test("rejects teaching a grade during its PLC lock", () => {
  // Grade 4 is locked Mon 09:00–09:45; overlapping at 09:30 must be rejected.
  const candidate: ConstraintBlock = {
    id: "new",
    day_of_week: "Mon",
    start_time: "09:30",
    end_time: "10:15",
    specialist_id: "S2",
    teacher_id: "T4",
    grade: "4",
  };
  assertEquals(violations(candidate, allBlocks, ctx).includes("plc"), true);
});

Deno.test("rejects specialist double-book (interval overlap, different start)", () => {
  // S1 already teaches Mon 09:00–09:45; a 30-min block at 09:30 overlaps.
  const candidate: ConstraintBlock = {
    id: "new",
    day_of_week: "Mon",
    start_time: "09:30",
    end_time: "10:00",
    specialist_id: "S1",
    teacher_id: "T9",
    grade: "2",
  };
  assertEquals(violations(candidate, allBlocks, ctx).includes("specialist_double_book"), true);
});

Deno.test("rejects teacher/class double-book", () => {
  // T5 already has Art Mon 09:00–09:45; another specialist for T5 overlapping.
  const candidate: ConstraintBlock = {
    id: "new",
    day_of_week: "Mon",
    start_time: "09:15",
    end_time: "10:00",
    specialist_id: "S3",
    teacher_id: "T5",
    grade: "5",
  };
  assertEquals(violations(candidate, allBlocks, ctx).includes("teacher_double_book"), true);
});

Deno.test("A/B week blocks may share a specialist slot", () => {
  const weekA: ConstraintBlock = {
    id: "a", day_of_week: "Mon", start_time: "13:00", end_time: "13:45",
    specialist_id: "S1", teacher_id: "T1", grade: "1", week_label: "A",
  };
  const weekB: ConstraintBlock = {
    id: "b", day_of_week: "Mon", start_time: "13:00", end_time: "13:45",
    specialist_id: "S1", teacher_id: "T2", grade: "2", week_label: "B",
  };
  const ctx2 = buildConstraintContext(school, recessConfigs, [weekA, weekB]);
  // weekB does not double-book S1 because it's a different week.
  assertEquals(violations(weekB, [weekA, weekB], ctx2).includes("specialist_double_book"), false);
});

Deno.test("moving a block does not conflict with itself", () => {
  // Re-validating artBlock in place against the full set excludes its own id.
  assertEquals(violations(artBlock, allBlocks, ctx), []);
});

Deno.test("end before start is rejected", () => {
  const candidate: ConstraintBlock = {
    id: "new", day_of_week: "Mon", start_time: "10:00", end_time: "09:00",
    specialist_id: "S2", teacher_id: "T1", grade: "1",
  };
  assertEquals(violations(candidate, allBlocks, ctx), ["end_before_start"]);
});
