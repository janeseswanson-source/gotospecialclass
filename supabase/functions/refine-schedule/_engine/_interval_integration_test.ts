// Integration tests for the interval-occupancy rework.
//
// These drive generateScheduleBlocks end-to-end and assert that the
// produced schedule contains NO real time-overlap conflicts — even under
// the conditions that defeated the old exact-start-minute occupancy:
//   1. Quick 30 (conflict grades get 30-min slots, others 45 → mixed
//      durations that can overlap at non-aligned start minutes).
//   2. Special events (a time window that must block every specialist).

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateScheduleBlocks, computeWarnings, timeToMinutes } from "./index.ts";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function spec(id: string, name: string, subject: string, opts: Record<string, unknown> = {}) {
  return {
    id, name, subject,
    working_days: DAYS,
    planning_minutes: 30, lunch_minutes: 30,
    uses_cart: false, two_schools: false, is_part_time: false,
    part_time_planning_minutes: 30, part_time_lunch_minutes: 20,
    grade_rotation: null, location: null, second_location: null,
    weekly_planning_minutes: 150,
    ...opts,
  };
}
function teacher(id: string, name: string, grade: string, opts: Record<string, unknown> = {}) {
  return {
    id, name, grade, room: `R-${id}`,
    am_pm_preference: null, day_preference: null,
    planning_minutes: 30, weekly_planning_minutes: 150, lunch_minutes: 30,
    ...opts,
  };
}
const baseSchool = {
  start_time: "08:00", end_time: "15:00",
  early_release_day: null, early_release_end_time: null,
  class_duration: 45, setup_time: 5, passing_time: 5,
  planning_minutes: 0, schedule_type: "whole_school",
  grade_time_config: {}, planning_time_when: "during_rotations",
};

/** Count real overlap conflicts (specialist + teacher) in a block set. */
function conflictCount(blocks: any[], specialists: any[], grades: string[]): number {
  return computeWarnings(blocks, specialists as any, grades).filter(
    (w) => w.type === "double_booked" || w.type === "teacher_double_booked",
  ).length;
}

Deno.test("Quick 30: mixed 30/45-min durations produce NO hidden overlaps", () => {
  const specialists = [
    spec("11111111-1111-4111-a111-111111111111", "Art", "Art"),
    spec("22222222-2222-4222-a222-222222222222", "Music", "Music"),
  ];
  const grades = ["K", "1", "2", "3", "4", "5"];
  const teachers = grades.map((g, i) =>
    teacher(`aaaaaaaa-aaaa-4aaa-aaaa-${(i + 10).toString().padStart(12, "0")}`, `T${g}`, g),
  );
  const school = {
    ...baseSchool,
    conflict_strategy: "quick_30",
    conflict_strategies: ["quick_30"],
    conflict_grades: ["4", "5"], // these get 30-min slots; others 45
    conflict_timing: "before",
  };

  const result = generateScheduleBlocks(
    "00000000-0000-4000-a000-0000000q3000",
    specialists, teachers, grades, school,
    [], [], [], [], [], [],
  );

  // The produced (non-lunch) schedule must be conflict-free.
  const teaching = result.blocks.filter((b) => b.grade !== "Lunch");
  assertEquals(
    conflictCount(teaching, specialists, grades), 0,
    "Quick 30 produced overlapping blocks that interval occupancy should have prevented",
  );
});

Deno.test("Special event blocks every specialist for its full interval", () => {
  const specialists = [
    spec("11111111-1111-4111-a111-111111111111", "Art", "Art"),
    spec("22222222-2222-4222-a222-222222222222", "Music", "Music"),
  ];
  const grades = ["K", "1", "2"];
  const teachers = grades.map((g, i) =>
    teacher(`bbbbbbbb-bbbb-4bbb-bbbb-${(i + 10).toString().padStart(12, "0")}`, `T${g}`, g),
  );
  // 2026-06-01 is a Monday. Event 10:00–11:00 (600–660).
  const specialEvents = [
    { event_date: "2026-06-01", start_time: "10:00", end_time: "11:00", name: "Assembly" },
  ];
  const school = { ...baseSchool, conflict_strategy: "standard", conflict_strategies: ["standard"], conflict_grades: [], conflict_timing: "before" };

  const result = generateScheduleBlocks(
    "00000000-0000-4000-a000-0000000ev000",
    specialists, teachers, grades, school,
    [], [], specialEvents, [], [], [],
  );

  const evStart = 600, evEnd = 660;
  const overlapping = result.blocks.filter(
    (b) =>
      b.day_of_week === "Mon" &&
      b.specialist_id != null &&
      b.grade !== "Lunch" &&
      timeToMinutes(b.start_time) < evEnd &&
      timeToMinutes(b.end_time) > evStart,
  );
  assertEquals(overlapping.length, 0, `${overlapping.length} blocks overlapped the Monday event window`);
});

Deno.test("staggered recess: each grade avoids ITS OWN band's lunch window", () => {
  // Wizard default bands: K alone, 1-3 primary, 4-6 intermediate — each with
  // a DIFFERENT lunch window. Pre-fix the scheduler guessed K→primary and
  // 3→intermediate, scheduling them over their real lunch. Post-fix it uses
  // the school's grade→band map.
  const specialists = [
    spec("11111111-1111-4111-a111-111111111111", "Art", "Art"),
    spec("22222222-2222-4222-a222-222222222222", "Music", "Music"),
    spec("33333333-3333-4333-a333-333333333333", "PE", "PE"),
  ];
  const grades = ["K", "1", "2", "3", "4", "5"];
  const teachers = grades.map((g, i) =>
    teacher(`dddddddd-dddd-4ddd-dddd-${(i + 10).toString().padStart(12, "0")}`, `T${g}`, g),
  );
  const recess = [
    { grade_band: "kindergarten", lunch_start: "11:15", lunch_end: "11:45" },
    { grade_band: "primary", lunch_start: "11:45", lunch_end: "12:15" },
    { grade_band: "intermediate", lunch_start: "12:15", lunch_end: "12:45" },
  ];
  const school = {
    ...baseSchool,
    schedule_type: "staggered",
    recess_grade_bands: [
      { key: "kindergarten", grades: ["K"] },
      { key: "primary", grades: ["1", "2", "3"] },
      { key: "intermediate", grades: ["4", "5", "6"] },
    ],
    conflict_strategy: "standard", conflict_strategies: ["standard"], conflict_grades: [], conflict_timing: "before",
  };

  const result = generateScheduleBlocks(
    "00000000-0000-4000-a000-0000000stg00",
    specialists, teachers, grades, school, recess, [], [], [], [],
  );

  const lunchByGrade: Record<string, [number, number]> = {
    K: [timeToMinutes("11:15"), timeToMinutes("11:45")],
    "1": [timeToMinutes("11:45"), timeToMinutes("12:15")],
    "2": [timeToMinutes("11:45"), timeToMinutes("12:15")],
    "3": [timeToMinutes("11:45"), timeToMinutes("12:15")],
    "4": [timeToMinutes("12:15"), timeToMinutes("12:45")],
    "5": [timeToMinutes("12:15"), timeToMinutes("12:45")],
  };
  const teaching = result.blocks.filter((b) => b.specialist_id && b.grade !== "Lunch");
  for (const b of teaching) {
    const win = lunchByGrade[b.grade];
    if (!win) continue;
    const s = timeToMinutes(b.start_time), e = timeToMinutes(b.end_time);
    assertEquals(s < win[1] && win[0] < e, false, `grade ${b.grade} block ${b.start_time}-${b.end_time} overlaps its lunch ${win[0]}-${win[1]}`);
  }
});

Deno.test("rotation quality: each class sees distinct specialists; specialists are balanced", () => {
  // Well-resourced canonical case: 5 specialists, 5 days, 12 classes, no
  // preferences. A proper specials rotation gives each class all 5
  // specialists exactly once and keeps every specialist working all week.
  // (Pre-rework this produced classes repeating a subject while missing
  // another, and specialists idle 1-2 days.)
  const specialists = [
    spec("11111111-1111-4111-a111-111111111111", "Art", "Art"),
    spec("22222222-2222-4222-a222-222222222222", "Music", "Music"),
    spec("33333333-3333-4333-a333-333333333333", "PE", "PE"),
    spec("44444444-4444-4444-a444-444444444444", "Library", "Library"),
    spec("55555555-5555-4555-a555-555555555555", "Technology", "Tech"),
  ];
  const grades = ["K", "1", "2", "3", "4", "5"];
  const teachers = grades.flatMap((g, i) => [
    teacher(`eeeeeeee-eeee-4eee-eeee-${(i * 2 + 10).toString().padStart(12, "0")}`, `${g}A`, g),
    teacher(`eeeeeeee-eeee-4eee-eeee-${(i * 2 + 11).toString().padStart(12, "0")}`, `${g}B`, g),
  ]);
  const school = { ...baseSchool, conflict_strategy: "standard", conflict_strategies: ["standard"], conflict_grades: [], conflict_timing: "before" };

  const result = generateScheduleBlocks(
    "00000000-0000-4000-a000-0000000rot00",
    specialists, teachers, grades, school, [], [], [], [], [],
  );
  const teaching = result.blocks.filter((b) => b.specialist_id && b.grade !== "Lunch");

  // No class repeats a specialist (→ every class gets 5 distinct).
  let classesWithRepeat = 0;
  for (const t of teachers) {
    const seen: Record<string, number> = {};
    for (const b of teaching.filter((x) => x.teacher_id === t.id)) seen[b.specialist_id!] = (seen[b.specialist_id!] ?? 0) + 1;
    if (Object.values(seen).some((n) => n > 1)) classesWithRepeat++;
  }
  assertEquals(classesWithRepeat, 0, "some class repeats a specialist within the week");

  // No specialist sits idle a full working day.
  for (const s of specialists) {
    const daysWorked = new Set(teaching.filter((b) => b.specialist_id === s.id).map((b) => b.day_of_week));
    assertEquals(daysWorked.size, 5, `${s.name} is idle on ${5 - daysWorked.size} day(s)`);
  }
});

Deno.test("scale fairness: under capacity pressure no class is starved of all specials", () => {
  // 42 classes (7 grades × 6), 8 specialists. Specialist slot capacity is
  // below daily-special demand, so some classes must get fewer specials.
  // The shortage must be SHARED (every class within 1 of the others), not
  // dumped on a fixed tail that gets zero all week.
  const specialists = Array.from({ length: 8 }, (_, i) =>
    spec(
      `${(i + 1).toString().repeat(8).slice(0, 8)}-1111-4111-a111-111111111111`.slice(0, 36),
      `Sp${i + 1}`,
      ["Art", "Music", "PE", "Library", "Tech", "Spanish", "STEM", "Drama"][i],
    ),
  );
  const grades = ["K", "1", "2", "3", "4", "5", "6"];
  const teachers: any[] = [];
  let k = 0;
  for (const g of grades) {
    for (let c = 0; c < 6; c++) {
      teachers.push(teacher(`fffffff${(k).toString(16).padStart(1, "0")}-ffff-4fff-ffff-${k.toString().padStart(12, "0")}`, `${g}-${c + 1}`, g));
      k++;
    }
  }
  const school = { ...baseSchool, conflict_strategy: "standard", conflict_strategies: ["standard"], conflict_grades: [], conflict_timing: "before" };

  const result = generateScheduleBlocks(
    "00000000-0000-4000-a000-0000000fair0",
    specialists, teachers, grades, school, [], [], [], [], [],
  );
  const teaching = result.blocks.filter((b) => b.specialist_id && b.grade !== "Lunch");

  const sessions = teachers.map((t) => teaching.filter((b) => b.teacher_id === t.id).length);
  const min = Math.min(...sessions), max = Math.max(...sessions);
  const zero = sessions.filter((s) => s === 0).length;
  assertEquals(zero, 0, "some class received zero specials all week (unfair starvation)");
  assertEquals(max - min <= 1, true, `unfair spread: classes range ${min}..${max} sessions/week`);
});

Deno.test("standard generation is internally conflict-free", () => {
  const specialists = [
    spec("11111111-1111-4111-a111-111111111111", "Art", "Art"),
    spec("22222222-2222-4222-a222-222222222222", "Music", "Music"),
    spec("33333333-3333-4333-a333-333333333333", "PE", "PE"),
  ];
  const grades = ["K", "1", "2", "3", "4", "5"];
  const teachers = grades.flatMap((g, i) => [
    teacher(`cccccccc-cccc-4ccc-cccc-${(i * 2 + 10).toString().padStart(12, "0")}`, `${g}A`, g),
    teacher(`cccccccc-cccc-4ccc-cccc-${(i * 2 + 11).toString().padStart(12, "0")}`, `${g}B`, g),
  ]);
  const school = { ...baseSchool, conflict_strategy: "standard", conflict_strategies: ["standard"], conflict_grades: [], conflict_timing: "before" };

  const result = generateScheduleBlocks(
    "00000000-0000-4000-a000-0000000std00",
    specialists, teachers, grades, school,
    [], [], [], [], [], [],
  );
  const teaching = result.blocks.filter((b) => b.grade !== "Lunch");
  assertEquals(conflictCount(teaching, specialists, grades), 0);
});

Deno.test("big group: every member class keeps attribution and protection", () => {
  // Two grade-4 classes are combined. Each member must still receive blocks
  // (teacher_id attribution), the combined sessions must share the exact slot,
  // and the group must NOT be flagged as a specialist double-book.
  const specialists = [
    spec("11111111-1111-4111-a111-111111111111", "Art", "Art"),
    spec("22222222-2222-4222-a222-222222222222", "Music", "Music"),
    spec("33333333-3333-4333-a333-333333333333", "PE", "PE"),
  ];
  const grades = ["3", "4", "5"];
  const teachers = grades.flatMap((g, i) => [
    teacher(`bbbbbbbb-bbbb-4bbb-bbbb-${(i * 2 + 10).toString().padStart(12, "0")}`, `${g}A`, g),
    teacher(`bbbbbbbb-bbbb-4bbb-bbbb-${(i * 2 + 11).toString().padStart(12, "0")}`, `${g}B`, g),
  ]);
  const grade4 = teachers.filter((t) => t.grade === "4");
  const school = {
    ...baseSchool,
    conflict_strategy: "big_group", conflict_strategies: ["big_group"],
    conflict_grades: ["4"], conflict_timing: "before",
    big_group_config: [{ grade: "4", teacherIds: grade4.map((t) => t.id) }],
  };

  const result = generateScheduleBlocks(
    "00000000-0000-4000-a000-0000000big00",
    specialists, teachers, grades, school, [], [], [], [], [],
  );
  const teaching = result.blocks.filter((b) => b.specialist_id && b.grade !== "Lunch");

  // Every member of the combined group has attributed sessions.
  for (const t of grade4) {
    const n = teaching.filter((b) => b.teacher_id === t.id).length;
    assert(n > 0, `${t.name} (big-group member) has no attributed sessions`);
  }

  // Combined sessions exist: same spec, same exact slot, different teachers.
  const combined = teaching.filter((a) =>
    a.grade === "4" &&
    teaching.some((b) =>
      b !== a && b.grade === "4" && b.specialist_id === a.specialist_id &&
      b.day_of_week === a.day_of_week && b.start_time === a.start_time &&
      b.end_time === a.end_time && b.teacher_id !== a.teacher_id,
    ),
  );
  assert(combined.length > 0, "no combined (shared-slot) sessions found");

  // The combined group is NOT a conflict.
  assertEquals(conflictCount(teaching, specialists, grades), 0);
});

Deno.test("per-specialist class_duration: a 30-min specialist gets 30-min blocks", () => {
  // School default is 45 (baseSchool). Music has its own 30-min class length;
  // Art uses the default. Each specialist's blocks must match THEIR duration.
  const specialists = [
    spec("11111111-1111-4111-a111-111111111111", "Art", "Art"),
    spec("22222222-2222-4222-a222-222222222222", "Music", "Music", { class_duration: 30 }),
  ];
  const grades = ["K", "1", "2", "3"];
  const teachers = grades.map((g, i) =>
    teacher(`dddddddd-dddd-4ddd-dddd-${(i + 10).toString().padStart(12, "0")}`, `T${g}`, g),
  );
  const school = { ...baseSchool, conflict_strategy: "standard", conflict_strategies: ["standard"], conflict_grades: [], conflict_timing: "before" };

  const result = generateScheduleBlocks(
    "00000000-0000-4000-a000-00000perspc",
    specialists, teachers, grades, school, [], [], [], [], [],
  );
  const teaching = result.blocks.filter((b) => b.specialist_id && b.grade !== "Lunch");
  const dur = (b: any) => timeToMinutes(b.end_time) - timeToMinutes(b.start_time);

  const artBlocks = teaching.filter((b) => b.specialist_id === specialists[0].id);
  const musicBlocks = teaching.filter((b) => b.specialist_id === specialists[1].id);

  assert(artBlocks.length > 0, "Art should have blocks");
  assert(musicBlocks.length > 0, "Music should have blocks");
  for (const b of artBlocks) assertEquals(dur(b), 45, `Art block ${b.start_time}-${b.end_time} should be 45 min`);
  for (const b of musicBlocks) assertEquals(dur(b), 30, `Music block ${b.start_time}-${b.end_time} should be 30 min`);

  // And no overlaps from the mixed durations.
  assertEquals(conflictCount(teaching, specialists, grades), 0);
});
