// Phase 1C — unit tests for the six correctness fixes in Phase 1B.
// Runs the pure helpers exported from ./index.ts (no network, no DB).

import { assertEquals, assert, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  validateCalendar,
  validatePlanningTime,
  validateExtraRotation,
  computeWarnings,
  strategyFailed,
  OccupancyTracker,
  timeToMinutes,
  getEndMinForDay,
} from "./index.ts";

// ──────────────────────────────────────────────────────────────────────
// timeToMinutes / getEndMinForDay (sanity)
// ──────────────────────────────────────────────────────────────────────
Deno.test("timeToMinutes basic", () => {
  assertEquals(timeToMinutes("08:00"), 480);
  assertEquals(timeToMinutes("14:30"), 870);
});

Deno.test("getEndMinForDay respects early release", () => {
  const school = { end_time: "15:00", early_release_day: "Wednesday", early_release_end_time: "12:30" };
  assertEquals(getEndMinForDay("Mon", school), 900);
  assertEquals(getEndMinForDay("Wed", school), 750);
});

// ──────────────────────────────────────────────────────────────────────
// strategyFailed — severity gating
// ──────────────────────────────────────────────────────────────────────
Deno.test("strategyFailed gates only on error severity", () => {
  assertEquals(strategyFailed([]), false);
  assertEquals(strategyFailed([{ type: "x", message: "", severity: "info" }]), false);
  assertEquals(strategyFailed([{ type: "x", message: "", severity: "warning" }]), false);
  assertEquals(strategyFailed([{ type: "x", message: "", severity: "error" }]), true);
  assertEquals(
    strategyFailed([
      { type: "a", message: "", severity: "warning" },
      { type: "b", message: "", severity: "error" },
    ]),
    true,
  );
});

// ──────────────────────────────────────────────────────────────────────
// FIX-P1-1 — validateCalendar
// ──────────────────────────────────────────────────────────────────────
Deno.test("validateCalendar: single one-off → calendar_one_off info", () => {
  // 2026-05-25 is a Monday
  const w = validateCalendar([
    { event_type: "holiday", event_date: "2026-05-25", title: "Memorial Day", approved: true },
  ]);
  assertEquals(w.length, 1);
  assertEquals(w[0].type, "calendar_one_off");
  assertEquals(w[0].severity, "info");
  assert(w[0].message.includes("Memorial Day"));
});

Deno.test("validateCalendar: ≥2 same weekday → skipped_holiday", () => {
  // Two Mondays
  const w = validateCalendar([
    { event_type: "holiday", event_date: "2026-05-25", title: "Memorial Day" },
    { event_type: "no_school", event_date: "2026-06-01", title: "PD Day" },
  ]);
  assertEquals(w.length, 1);
  assertEquals(w[0].type, "skipped_holiday");
  assertEquals(w[0].severity, "info");
  assert(w[0].message.includes("Mon"));
});

Deno.test("validateCalendar: ignores non-no-school types and weekends", () => {
  const w = validateCalendar([
    { event_type: "event", event_date: "2026-05-25", title: "Field Day" },
    { event_type: "first_day", event_date: "2026-05-25", title: "First Day" },
    { event_type: "holiday", event_date: "2026-05-23", title: "Saturday" },
  ]);
  assertEquals(w.length, 0);
});

Deno.test("validateCalendar: multi-day range expands", () => {
  // 2026-05-25 (Mon) through 2026-05-27 (Wed) — 3 distinct weekdays, all one-offs
  const w = validateCalendar([
    { event_type: "closure", event_date: "2026-05-25", end_date: "2026-05-27", title: "Snow" },
  ]);
  assertEquals(w.length, 3);
  assertEquals(w.filter((x) => x.type === "calendar_one_off").length, 3);
});

// ──────────────────────────────────────────────────────────────────────
// FIX-P1-2 — validateExtraRotation
// ──────────────────────────────────────────────────────────────────────
Deno.test("validateExtraRotation: no warnings when conflict grades are at different slots", () => {
  const blocks = [
    { generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "09:30", subject: "Art", specialist_id: "s1", teacher_id: null, grade: "5", room: null, week_label: null },
    { generation_id: "g", day_of_week: "Mon", start_time: "09:30", end_time: "10:00", subject: "Art", specialist_id: "s1", teacher_id: null, grade: "6", room: null, week_label: null },
  ];
  assertEquals(validateExtraRotation(blocks, ["5", "6"]).length, 0);
});

Deno.test("validateExtraRotation: collision → extra_rotation_failed warning", () => {
  const blocks = [
    { generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "09:30", subject: "Art", specialist_id: "s1", teacher_id: null, grade: "5", room: null, week_label: null },
    { generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "09:30", subject: "Art", specialist_id: "s1", teacher_id: null, grade: "6", room: null, week_label: null },
  ];
  const w = validateExtraRotation(blocks, ["5", "6"]);
  assertEquals(w.length, 1);
  assertEquals(w[0].type, "extra_rotation_failed");
  assertEquals(w[0].severity, "warning");
  assert(w[0].message.includes("Mon"));
  assert(w[0].message.includes("09:00"));
});

Deno.test("validateExtraRotation: ignores non-conflict grades", () => {
  const blocks = [
    { generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "09:30", subject: "Art", specialist_id: "s1", teacher_id: null, grade: "K", room: null, week_label: null },
    { generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "09:30", subject: "Art", specialist_id: "s1", teacher_id: null, grade: "1", room: null, week_label: null },
  ];
  assertEquals(validateExtraRotation(blocks, ["5", "6"]).length, 0);
});

// ──────────────────────────────────────────────────────────────────────
// FIX-P1-3 — OccupancyTracker.clone() deep-copy
// ──────────────────────────────────────────────────────────────────────
Deno.test("OccupancyTracker.clone deep-copies specialist + teacher + gradeRanges", () => {
  const a = new OccupancyTracker();
  a.book("Mon", 480, 525, "s1", "t1");
  a.bookGradeRange("Mon", "5", 540, 600);
  const b = a.clone();
  // Mutating b must not affect a.
  b.book("Mon", 540, 585, "s2", "t2");
  b.bookGradeRange("Mon", "5", 700, 730);
  assert(a.isSpecialistFree("Mon", 540, 585, "s2"));
  assert(a.isTeacherFree("Mon", 540, 585, "t2"));
  assert(a.isGradeRangeFree("Mon", "5", 700, 730));
  // And b retains a's bookings.
  assertEquals(b.isSpecialistFree("Mon", 480, 525, "s1"), false);
});

// ──────────────────────────────────────────────────────────────────────
// FIX-P1-6 — gradeRange overlap detection
// ──────────────────────────────────────────────────────────────────────
Deno.test("OccupancyTracker.isGradeRangeFree detects overlap", () => {
  const t = new OccupancyTracker();
  t.bookGradeRange("Mon", "5", 600, 660); // 10:00-11:00
  assertEquals(t.isGradeRangeFree("Mon", "5", 540, 600), true);  // ends right at start
  assertEquals(t.isGradeRangeFree("Mon", "5", 660, 720), true);  // starts right at end
  assertEquals(t.isGradeRangeFree("Mon", "5", 590, 620), false); // overlap left
  assertEquals(t.isGradeRangeFree("Mon", "5", 650, 680), false); // overlap right
  assertEquals(t.isGradeRangeFree("Mon", "5", 610, 650), false); // fully inside
  assertEquals(t.isGradeRangeFree("Mon", "5", 500, 800), false); // straddles
  assertEquals(t.isGradeRangeFree("Mon", "6", 610, 650), true);  // different grade
  assertEquals(t.isGradeRangeFree("Tue", "5", 610, 650), true);  // different day
});

// ──────────────────────────────────────────────────────────────────────
// FIX-P1-5 — validatePlanningTime
// ──────────────────────────────────────────────────────────────────────
const baseSchool = {
  start_time: "08:00",
  end_time: "15:00", // 7h = 420 min/day × 5 days = 2100 min/wk
  planning_minutes: 0,
};

const baseSpec = {
  id: "s1",
  name: "Sarah",
  subject: "Art",
  working_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  planning_minutes: 45,            // 45 × 5 = 225 required/week (default)
  lunch_minutes: 30,
  uses_cart: false,
  two_schools: false,
  is_part_time: false,
  part_time_planning_minutes: null,
  part_time_lunch_minutes: null,
  grade_rotation: null,
  location: null,
  second_location: null,
  weekly_planning_minutes: null,
};

Deno.test("validatePlanningTime: no warning when free time ≥ required", () => {
  const blocks: any[] = []; // no teaching → 2100 min/wk free
  const w = validatePlanningTime(blocks, [baseSpec as any], baseSchool);
  assertEquals(w.length, 0);
});

Deno.test("validatePlanningTime: shortfall emits planning_shortfall warning", () => {
  // 40 × 45-min blocks/wk = 1800 min teaching; free = 2100 − 1800 = 300; required 225 → no warning.
  // Push it: 42 × 45 = 1890 teaching, free = 210, required 225 → shortfall of 15.
  const blocks: any[] = [];
  for (let i = 0; i < 42; i++) {
    blocks.push({
      generation_id: "g",
      day_of_week: "Mon",
      start_time: "08:00",
      end_time: "08:45",
      subject: "Art",
      specialist_id: "s1",
      teacher_id: null,
      grade: "K",
      room: null,
      week_label: null,
    });
  }
  const w = validatePlanningTime(blocks, [baseSpec as any], baseSchool);
  assertEquals(w.length, 1);
  assertEquals(w[0].type, "planning_shortfall");
  assertEquals(w[0].severity, "warning");
  assert(w[0].message.includes("Sarah"));
});

Deno.test("validatePlanningTime: Lunch + Planning grades excluded from teaching load", () => {
  const blocks = [
    { generation_id: "g", day_of_week: "Mon", start_time: "08:00", end_time: "08:45", subject: "Lunch", specialist_id: "s1", teacher_id: null, grade: "Lunch", room: null, week_label: null },
    { generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "09:45", subject: "Planning", specialist_id: "s1", teacher_id: null, grade: "Planning", room: null, week_label: null },
  ];
  const w = validatePlanningTime(blocks, [baseSpec as any], baseSchool);
  assertEquals(w.length, 0);
});

// ──────────────────────────────────────────────────────────────────────
// computeWarnings — no_coverage + double_booked (regression)
// ──────────────────────────────────────────────────────────────────────
Deno.test("computeWarnings: emits no_coverage error per uncovered grade", () => {
  const w = computeWarnings([], [], ["K", "1"]);
  assertEquals(w.length, 2);
  assert(w.every((x) => x.type === "no_coverage" && x.severity === "error"));
});

Deno.test("computeWarnings: double_booked on same (spec, day, slot, week)", () => {
  const blocks = [
    { generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "09:30", subject: "Art", specialist_id: "s1", teacher_id: null, grade: "K", room: null, week_label: null },
    { generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "09:30", subject: "Art", specialist_id: "s1", teacher_id: null, grade: "1", room: null, week_label: null },
  ];
  const w = computeWarnings(blocks, [{ id: "s1", name: "Sarah" } as any], ["K", "1"]);
  const db = w.filter((x) => x.type === "double_booked");
  assertEquals(db.length, 1);
  assertEquals(db[0].severity, "error");
});

Deno.test("computeWarnings: A vs B week labels are not double-booked", () => {
  const blocks = [
    { generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "09:30", subject: "Art", specialist_id: "s1", teacher_id: null, grade: "5", room: null, week_label: "A" },
    { generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "09:30", subject: "Art", specialist_id: "s1", teacher_id: null, grade: "6", room: null, week_label: "B" },
  ];
  const w = computeWarnings(blocks, [{ id: "s1", name: "Sarah" } as any], ["5", "6"]);
  assertEquals(w.filter((x) => x.type === "double_booked").length, 0);
});

// ──────────────────────────────────────────────────────────────────────
// Interval-overlap detection (the core fix): conflicts no longer require
// an exact start-minute match — any real time overlap is caught.
// ──────────────────────────────────────────────────────────────────────
Deno.test("computeWarnings: specialist overlap with DIFFERENT start times is double_booked", () => {
  // 09:00–09:45 and 09:30–10:00 overlap 09:30–09:45 — different starts.
  const blocks = [
    { generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "09:45", subject: "Art", specialist_id: "s1", teacher_id: "t1", grade: "K", room: null, week_label: null },
    { generation_id: "g", day_of_week: "Mon", start_time: "09:30", end_time: "10:00", subject: "Art", specialist_id: "s1", teacher_id: "t2", grade: "1", room: null, week_label: null },
  ];
  const w = computeWarnings(blocks, [{ id: "s1", name: "Sarah" } as any], ["K", "1"]);
  assertEquals(w.filter((x) => x.type === "double_booked").length, 1);
});

Deno.test("computeWarnings: touching blocks (09:00–09:45 then 09:45–10:30) do NOT conflict", () => {
  const blocks = [
    { generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "09:45", subject: "Art", specialist_id: "s1", teacher_id: "t1", grade: "K", room: null, week_label: null },
    { generation_id: "g", day_of_week: "Mon", start_time: "09:45", end_time: "10:30", subject: "Art", specialist_id: "s1", teacher_id: "t2", grade: "1", room: null, week_label: null },
  ];
  const w = computeWarnings(blocks, [{ id: "s1", name: "Sarah" } as any], ["K", "1"]);
  assertEquals(w.filter((x) => x.type === "double_booked").length, 0);
});

Deno.test("computeWarnings: same class (teacher) in two overlapping specials is teacher_double_booked", () => {
  const blocks = [
    { generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "09:45", subject: "Art", specialist_id: "s1", teacher_id: "t1", grade: "K", room: null, week_label: null },
    { generation_id: "g", day_of_week: "Mon", start_time: "09:15", end_time: "10:00", subject: "Music", specialist_id: "s2", teacher_id: "t1", grade: "K", room: null, week_label: null },
  ];
  const w = computeWarnings(blocks, [{ id: "s1", name: "Art" }, { id: "s2", name: "Music" }] as any, ["K"]);
  assertEquals(w.filter((x) => x.type === "teacher_double_booked" && x.severity === "error").length, 1);
});

Deno.test("computeWarnings: different days never conflict", () => {
  const blocks = [
    { generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "09:45", subject: "Art", specialist_id: "s1", teacher_id: "t1", grade: "K", room: null, week_label: null },
    { generation_id: "g", day_of_week: "Tue", start_time: "09:00", end_time: "09:45", subject: "Art", specialist_id: "s1", teacher_id: "t1", grade: "K", room: null, week_label: null },
  ];
  const w = computeWarnings(blocks, [{ id: "s1", name: "Sarah" } as any], ["K"]);
  assertEquals(w.filter((x) => x.type.includes("double_booked")).length, 0);
});

// ──────────────────────────────────────────────────────────────────────
// OccupancyTracker interval semantics
// ──────────────────────────────────────────────────────────────────────
Deno.test("OccupancyTracker: overlapping interval (diff start) is not free", () => {
  const t = new OccupancyTracker();
  t.book("Mon", 540, 585, "s1", "t1"); // 09:00–09:45
  assertEquals(t.isSpecialistFree("Mon", 570, 615, "s1"), false); // 09:30–10:15 overlaps
  assertEquals(t.isTeacherFree("Mon", 570, 615, "t1"), false);
  assertEquals(t.isSpecialistFree("Mon", 585, 630, "s1"), true);  // 09:45–10:30 touches, free
  assertEquals(t.isSpecialistFree("Mon", 480, 525, "s1"), true);  // earlier slot free
  assertEquals(t.getSpecialistDayCount("Mon", "s1"), 1);
});

// ──────────────────────────────────────────────────────────────────────
// Per-grade transitions + specialist weekly meeting (Jane's KK3 feedback)
// ──────────────────────────────────────────────────────────────────────
import { scoreSchedule } from "./_scoring.ts";
import { buildTimeSlotsForGrade, reserveSpecialistMeetingBlocks, schoolRotationsStartMin, teacherDayStartMin, teacherDayEndMin, validateTeacherDay, validateAccompaniedSpecialists } from "./index.ts";

Deno.test("buildTimeSlotsForGrade: grade_time_config passingTime overrides the canonical step", () => {
  // 30-min K classes with 5-min switches → slots every 35 min; grade 1 (no
  // override) keeps the canonical 50-min step.
  const gtc = { K: { passingTime: 5 } };
  const k = buildTimeSlotsForGrade("K", 30, 480, 660, 5, 15, gtc, [], 50);
  assertEquals(k.map((s) => s.start), [480, 515, 550, 585, 620]);
  const g1 = buildTimeSlotsForGrade("1", 45, 480, 660, 5, 15, gtc, [], 50);
  assertEquals(g1.map((s) => s.start), [480, 530, 580]);
});

Deno.test("buildTimeSlotsForGrade: no gtc entry → behavior unchanged (canonical step)", () => {
  const withEmpty = buildTimeSlotsForGrade("2", 45, 480, 700, 5, 15, {}, [], 50);
  const withOtherGrade = buildTimeSlotsForGrade("2", 45, 480, 700, 5, 15, { K: { passingTime: 5 } }, [], 50);
  assertEquals(withEmpty, withOtherGrade);
});

Deno.test("reserveSpecialistMeetingBlocks: one block per specialist working that day", () => {
  const school = { specialist_meeting: { day: "Tuesday", start_time: "13:15", end_time: "14:00" } };
  const specialists = [
    { id: "a", name: "A", subject: "Art", working_days: ["Mon", "Tue", "Wed", "Thu", "Fri"] },
    { id: "b", name: "B", subject: "PE", working_days: ["Mon", "Wed"] }, // not in Tue
  ] as any[];
  const blocks = reserveSpecialistMeetingBlocks("g1", specialists, school);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].specialist_id, "a");
  assertEquals(blocks[0].day_of_week, "Tue");
  assertEquals(blocks[0].subject, "Specialist Meeting");
  assertEquals(blocks[0].grade, "Planning");
  assertEquals(blocks[0].start_time, "13:15");
  assertEquals(blocks[0].end_time, "14:00");
});

Deno.test("reserveSpecialistMeetingBlocks: malformed / missing config is a no-op", () => {
  const specialists = [{ id: "a", name: "A", subject: "Art", working_days: ["Tue"] }] as any[];
  assertEquals(reserveSpecialistMeetingBlocks("g", specialists, {}).length, 0);
  assertEquals(reserveSpecialistMeetingBlocks("g", specialists, { specialist_meeting: null }).length, 0);
  assertEquals(reserveSpecialistMeetingBlocks("g", specialists, { specialist_meeting: { day: "Tuesday", start_time: "14:00", end_time: "13:00" } }).length, 0);
  assertEquals(reserveSpecialistMeetingBlocks("g", specialists, { specialist_meeting: { day: "Funday", start_time: "13:00", end_time: "14:00" } }).length, 0);
});

// ──────────────────────────────────────────────────────────────────────
// team_out_stretch — cap on a grade team's back-to-back out-of-class time
// (advisory only; planning happens before/after school at these schools).
// ──────────────────────────────────────────────────────────────────────
const stretchBlock = (start: string, end: string, over: Record<string, unknown> = {}) => ({
  generation_id: "g", day_of_week: "Thu", start_time: start, end_time: end,
  subject: "Art", specialist_id: "s1", teacher_id: "t5a", grade: "5", room: null, week_label: null,
  ...over,
});

Deno.test("computeWarnings: team_out_stretch fires once per grade-day when back-to-back run exceeds the cap", () => {
  // t5a's class: 08:05-08:45, 08:50-09:30, 09:35-10:15 back-to-back (5-min
  // gaps) = 130 min wall-clock > 120 cap. A second 5th-grade teacher with the
  // same shape must NOT duplicate the warning (one per grade-day).
  const blocks = [
    stretchBlock("08:05", "08:45", { specialist_id: "s1" }),
    stretchBlock("08:50", "09:30", { specialist_id: "s2" }),
    stretchBlock("09:35", "10:15", { specialist_id: "s3" }),
    stretchBlock("08:05", "08:45", { teacher_id: "t5b", specialist_id: "s2" }),
    stretchBlock("08:50", "09:30", { teacher_id: "t5b", specialist_id: "s3" }),
    stretchBlock("09:35", "10:15", { teacher_id: "t5b", specialist_id: "s1" }),
  ];
  const w = computeWarnings(blocks, [{ id: "s1", name: "Art" }] as never, ["5"], undefined, { maxTeamOutMinutes: 120 });
  const hits = w.filter((x) => x.type === "team_out_stretch");
  assertEquals(hits.length, 1);
  assertEquals(hits[0].severity, "warning");
  assert(hits[0].message.includes("130 min"));
  assert(!strategyFailed(hits), "advisory — must never gate strategy fallback");
});

Deno.test("computeWarnings: a real gap (>15 min) splits the run — no warning", () => {
  // 40 + 40 min blocks separated by a 30-min gap: each run is under the cap.
  const blocks = [
    stretchBlock("08:05", "08:45"),
    stretchBlock("08:50", "09:30"),
    stretchBlock("10:00", "10:40"),
  ];
  const w = computeWarnings(blocks, [] as never, ["5"], undefined, { maxTeamOutMinutes: 120 });
  assertEquals(w.filter((x) => x.type === "team_out_stretch").length, 0);
});

Deno.test("computeWarnings: cap off (null/omitted) or reserved grades → no team_out_stretch", () => {
  const blocks = [
    stretchBlock("08:05", "08:45"),
    stretchBlock("08:50", "09:30"),
    stretchBlock("09:35", "10:15"),
    stretchBlock("10:20", "11:00"),
  ];
  assertEquals(computeWarnings(blocks, [] as never, ["5"]).filter((x) => x.type === "team_out_stretch").length, 0);
  assertEquals(
    computeWarnings(blocks, [] as never, ["5"], undefined, { maxTeamOutMinutes: null })
      .filter((x) => x.type === "team_out_stretch").length,
    0,
  );
  const lunchOnly = blocks.map((b) => ({ ...b, grade: "Lunch", subject: "Specialist Lunch" }));
  assertEquals(
    computeWarnings(lunchOnly, [] as never, ["5"], undefined, { maxTeamOutMinutes: 120 })
      .filter((x) => x.type === "team_out_stretch").length,
    0,
  );
});

Deno.test("computeWarnings: A and B week runs are tracked separately", () => {
  // Same wall-clock shape but split across week labels — neither week's run
  // exceeds the cap on its own.
  const blocks = [
    stretchBlock("08:05", "08:45", { week_label: "A" }),
    stretchBlock("08:50", "09:30", { week_label: "B" }),
    stretchBlock("09:35", "10:15", { week_label: "A" }),
  ];
  const w = computeWarnings(blocks, [] as never, ["5"], undefined, { maxTeamOutMinutes: 120 });
  assertEquals(w.filter((x) => x.type === "team_out_stretch").length, 0);
});

// ──────────────────────────────────────────────────────────────────────
// rotations_start_time — the Grade Set-up window ("Specials rotations
// begin at"). Previously collected by the wizard but DEAD in the engine.
// ──────────────────────────────────────────────────────────────────────
Deno.test("schoolRotationsStartMin: clamps to school start; unset means school start", () => {
  assertEquals(schoolRotationsStartMin({ start_time: "07:45", rotations_start_time: "08:05" }), 8 * 60 + 5);
  assertEquals(schoolRotationsStartMin({ start_time: "07:45", rotations_start_time: null }), 7 * 60 + 45);
  assertEquals(schoolRotationsStartMin({ start_time: "07:45" }), 7 * 60 + 45);
  // Never earlier than the bell.
  assertEquals(schoolRotationsStartMin({ start_time: "08:00", rotations_start_time: "07:30" }), 8 * 60);
});

Deno.test("reserveSpecialistMeetingBlocks: array shape with PD kind emits Specialist PD", () => {
  const school = {
    specialist_meeting: [
      { day: "Tuesday", start_time: "13:15", end_time: "14:00" },
      { day: "Friday", start_time: "12:25", end_time: "14:00", kind: "pd" },
    ],
  };
  const specs = [{ id: "s1", name: "Art" }, { id: "s2", name: "PE", working_days: ["Mon", "Tue"] }] as never[];
  const blocks = reserveSpecialistMeetingBlocks("g", specs, school);
  const meet = blocks.filter((b) => b.subject === "Specialist Meeting");
  const pd = blocks.filter((b) => b.subject === "Specialist PD");
  assertEquals(meet.length, 2);         // both work Tuesday
  assertEquals(pd.length, 1);           // only s1 works Friday
  assertEquals(pd[0].day_of_week, "Fri");
  assertEquals(pd[0].grade, "Planning");
});

Deno.test("reserveSpecialistMeetingBlocks: legacy single-object shape still works", () => {
  const school = { specialist_meeting: { day: "Tuesday", start_time: "13:15", end_time: "14:00" } };
  const blocks = reserveSpecialistMeetingBlocks("g", [{ id: "s1", name: "Art" }] as never[], school);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].subject, "Specialist Meeting");
});

// ──────────────────────────────────────────────────────────────────────
// Teacher duty day (HSTA: 7:45-2:45 while students leave at 2:00)
// ──────────────────────────────────────────────────────────────────────
Deno.test("teacherDayStartMin/EndMin: unset means the student day", () => {
  const school = { start_time: "07:45", end_time: "14:00" };
  assertEquals(teacherDayStartMin(school), 7 * 60 + 45);
  assertEquals(teacherDayEndMin("Mon", school), 14 * 60);
});

Deno.test("teacherDayEndMin: an explicit teacher end beats early release", () => {
  const school = {
    start_time: "07:45", end_time: "14:00",
    teacher_day_start_time: "07:45", teacher_day_end_time: "14:45",
    early_release_day: "Wed", early_release_end_time: "13:15",
  };
  // Students go home early on Wednesday; the specialist is still on the clock.
  assertEquals(teacherDayEndMin("Wed", school), 14 * 60 + 45);
  assertEquals(teacherDayEndMin("Mon", school), 14 * 60 + 45);
  // Without teacher hours the student day (and its early release) still rules.
  const noTeacherHours = { start_time: "07:45", end_time: "14:00", early_release_day: "Wed", early_release_end_time: "13:15" };
  assertEquals(teacherDayEndMin("Wed", noTeacherHours), 13 * 60 + 15);
});

Deno.test("validateTeacherDay: silent unless configured, then advisory only", () => {
  assertEquals(validateTeacherDay({ start_time: "07:45", end_time: "14:00" }).length, 0);

  const tooShort = validateTeacherDay({
    start_time: "07:45", end_time: "14:00",
    teacher_day_start_time: "08:00", teacher_day_end_time: "13:30",
  });
  assertEquals(tooShort.length, 1);
  assertEquals(tooShort[0].type, "teacher_day_misconfigured");
  assertEquals(tooShort[0].severity, "info");
  assert(!strategyFailed(tooShort), "advisory — must never gate strategy fallback");
});

Deno.test("validateTeacherDay: flags a planning block that doesn't fit after dismissal", () => {
  const w = validateTeacherDay({
    start_time: "07:45", end_time: "14:00",
    teacher_day_start_time: "07:45", teacher_day_end_time: "14:15",
    teacher_planning_block_minutes: 45, teacher_planning_block_when: "end_of_day",
  });
  assertEquals(w.length, 1);
  assert(w[0].message.includes("45 min"));

  // Jane's real numbers: 7:45-2:45 with a 2:00 dismissal leaves exactly 45.
  const ok = validateTeacherDay({
    start_time: "07:45", end_time: "14:00",
    teacher_day_start_time: "07:45", teacher_day_end_time: "14:45",
    teacher_planning_block_minutes: 45, teacher_planning_block_when: "end_of_day",
  });
  assertEquals(ok.length, 0);
});

// ──────────────────────────────────────────────────────────────────────
// teacher_accompanies — Library/Garden blocks the teacher attends WITH
// their class buy no planning time.
// ──────────────────────────────────────────────────────────────────────
Deno.test("validateAccompaniedSpecialists: advisory note only for accompanied specialists", () => {
  const blocks = [
    { generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "09:45", subject: "Library", specialist_id: "lib", teacher_id: "t1", grade: "3", room: null, week_label: null },
    { generation_id: "g", day_of_week: "Tue", start_time: "09:00", end_time: "09:45", subject: "Art", specialist_id: "art", teacher_id: "t1", grade: "3", room: null, week_label: null },
  ];
  const specs = [
    { id: "lib", name: "Lee", teacher_accompanies: true },
    { id: "art", name: "Swanson", teacher_accompanies: false },
  ] as never;

  const w = validateAccompaniedSpecialists(blocks as never, specs);
  assertEquals(w.length, 1);
  assertEquals(w[0].type, "accompanied_planning_gap");
  assertEquals(w[0].severity, "info");
  assert(w[0].message.includes("Lee"));
  assert(w[0].message.includes("45 min"));
  assert(!strategyFailed(w), "advisory — must never gate strategy fallback");
});

Deno.test("scoreSchedule: an accompanied specialist does not count toward teacher planning", () => {
  const blocks = [
    { generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "10:00", subject: "Library", specialist_id: "lib", teacher_id: "t1", grade: "3", room: null, week_label: null },
  ];
  const base = {
    school: { start_time: "08:00", end_time: "15:00" },
    teachers: [{ id: "t1", weekly_planning_minutes: 60 }],
    grades: ["3"],
  };
  const result = { blocks, warnings: [], preferenceViolations: [] } as never;

  // Teacher released -> requirement met, no shortfall.
  const released = scoreSchedule(result, {
    ...base, specialists: [{ id: "lib", teacher_accompanies: false }],
  } as never);
  assertEquals(released.breakdown.teacher_planning, 0);

  // Teacher stays with the class -> the full 60 min is still owed.
  const accompanied = scoreSchedule(result, {
    ...base, specialists: [{ id: "lib", teacher_accompanies: true }],
  } as never);
  assertEquals(Math.round(accompanied.breakdown.teacher_planning * 100) / 100, -3);
});
