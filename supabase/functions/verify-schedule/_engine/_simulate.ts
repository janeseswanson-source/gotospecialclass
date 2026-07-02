// Diagnostic simulation harness: runs the real generator against a realistic
// school and prints coverage / balance / conflict statistics so schedule
// quality can be inspected without deploying.
//
//   deno run --allow-hrtime supabase/functions/generate-schedule/_simulate.ts [strategy]
//
// strategy: standard | ab_week | aa_bb_week | quick_30 | big_group (default standard)

import { generateScheduleBlocks, computeWarnings, timeToMinutes } from "./index.ts";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function spec(id: string, name: string, subject: string, opts: Record<string, unknown> = {}) {
  return {
    id, name, subject,
    working_days: DAYS,
    planning_minutes: 45, lunch_minutes: 30,
    uses_cart: false, two_schools: false, is_part_time: false,
    part_time_planning_minutes: 30, part_time_lunch_minutes: 20,
    grade_rotation: null, location: null, second_location: null,
    weekly_planning_minutes: 225,
    ...opts,
  };
}
function teacher(id: string, name: string, grade: string, opts: Record<string, unknown> = {}) {
  return {
    id, name, grade, room: `R${id.slice(-2)}`,
    am_pm_preference: null, day_preference: null,
    planning_minutes: 45, weekly_planning_minutes: 225, lunch_minutes: 30,
    ...opts,
  };
}

const strategy = Deno.args[0] ?? "standard";

// Mirror of the real-world complaint school: K-5, 4 classes per grade,
// 5 specialists (one works Tue/Thu only), 45-min classes, early-release Wed.
const specialists = [
  spec("11111111-1111-4111-a111-111111111111", "Tech Teacher", "Technology"),
  spec("22222222-2222-4222-a222-222222222222", "PE Teacher", "PE"),
  spec("33333333-3333-4333-a333-333333333333", "Art Teacher", "Art"),
  spec("44444444-4444-4444-a444-444444444444", "Garden Teacher", "Garden", { working_days: ["Tue", "Thu"] }),
  spec("55555555-5555-4555-a555-555555555555", "Library Teacher", "Library"),
];
const grades = ["K", "1", "2", "3", "4", "5"];
const teachers = grades.flatMap((g, gi) =>
  [1, 2, 3, 4].map((n) =>
    teacher(`eeeeeeee-eeee-4eee-eeee-${String(gi * 4 + n).padStart(12, "0")}`, `${g} Teacher ${n}`, g),
  ),
);

const school: Record<string, unknown> = {
  start_time: "08:05",
  end_time: "14:00",
  early_release_day: "Wednesday",
  early_release_end_time: "13:15",
  class_duration: 45,
  setup_time: 5,
  passing_time: 5,
  planning_minutes: 0,
  schedule_type: "whole_school",
  grade_time_config: {},
  planning_time_when: "during_rotations",
  conflict_strategy: strategy,
  conflict_strategies: [strategy],
  conflict_grades: strategy === "quick_30" ? ["K", "1"] : strategy === "big_group" ? ["4", "5"] : strategy === "ab_week" || strategy === "aa_bb_week" ? grades : [],
  conflict_timing: "before",
  big_group_config: strategy === "big_group"
    ? [
        { grade: "4", teacherIds: teachers.filter((t) => t.grade === "4").slice(0, 2).map((t) => t.id) },
        { grade: "5", teacherIds: teachers.filter((t) => t.grade === "5").slice(0, 2).map((t) => t.id) },
      ]
    : [],
};

const recessConfigs = [
  {
    grade_band: "all",
    am_recess_start: "10:00", am_recess_end: "10:15",
    lunch_start: "11:30", lunch_end: "12:15",
    pm_recess_start: null, pm_recess_end: null,
  },
];

const result = generateScheduleBlocks(
  "00000000-0000-4000-a000-00000000s1m0",
  specialists as never, teachers as never, grades, school, recessConfigs,
  [], [], [], [], [],
);

const blocks = result.blocks;
const teaching = blocks.filter((b: any) => b.specialist_id && b.grade !== "Lunch" && b.subject !== "Specialist Lunch");
const lunchBlocks = blocks.filter((b: any) => b.subject === "Specialist Lunch");

console.log(`\n══════════ SIMULATION: strategy=${strategy} ══════════`);
console.log(`chosen_strategy: ${result.chosenStrategy ?? (result as any).chosen_strategy ?? "?"}`);
console.log(`total blocks: ${blocks.length}  (teaching: ${teaching.length}, lunch: ${lunchBlocks.length})`);

// Per-day distribution
console.log(`\n— blocks per day —`);
for (const d of DAYS) {
  const n = teaching.filter((b: any) => b.day_of_week === d).length;
  console.log(`  ${d}: ${"█".repeat(n)} ${n}`);
}

// Week label distribution
const labels = new Map<string, number>();
for (const b of teaching) labels.set(b.week_label ?? "(none)", (labels.get(b.week_label ?? "(none)") ?? 0) + 1);
console.log(`\n— week labels — ${[...labels.entries()].map(([k, v]) => `${k}:${v}`).join("  ")}`);

// Duration histogram
const durs = new Map<number, number>();
for (const b of teaching) {
  const d = timeToMinutes(b.end_time) - timeToMinutes(b.start_time);
  durs.set(d, (durs.get(d) ?? 0) + 1);
}
console.log(`— durations — ${[...durs.entries()].map(([k, v]) => `${k}min:${v}`).join("  ")}`);

// Start-time grid alignment
const starts = new Set(teaching.map((b: any) => b.start_time));
console.log(`— distinct start times (${starts.size}) — ${[...starts].sort().join(", ")}`);

// Per-teacher coverage (the starvation metric)
console.log(`\n— per-teacher weekly sessions —`);
let zero = 0;
const histo = new Map<number, number>();
for (const t of teachers) {
  const n = teaching.filter((b: any) => b.teacher_id === t.id).length;
  histo.set(n, (histo.get(n) ?? 0) + 1);
  if (n === 0) zero++;
}
console.log(`  distribution: ${[...histo.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k} sessions × ${v} teachers`).join(",  ")}`);
console.log(`  teachers with ZERO sessions: ${zero} of ${teachers.length}`);

// Per-teacher distinct subjects
const distinctSubj = new Map<number, number>();
for (const t of teachers) {
  const subj = new Set(teaching.filter((b: any) => b.teacher_id === t.id).map((b: any) => b.specialist_id));
  distinctSubj.set(subj.size, (distinctSubj.get(subj.size) ?? 0) + 1);
}
console.log(`  distinct specialists seen: ${[...distinctSubj.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k} × ${v} teachers`).join(",  ")}`);

// Per-specialist load + idle days
console.log(`\n— per-specialist load —`);
for (const s of specialists) {
  const mine = teaching.filter((b: any) => b.specialist_id === s.id);
  const byDay = DAYS.map((d) => mine.filter((b: any) => b.day_of_week === d).length);
  const workDays = (s.working_days as string[]);
  const idle = workDays.filter((d) => mine.filter((b: any) => b.day_of_week === d).length === 0);
  console.log(`  ${s.name.padEnd(16)} total ${String(mine.length).padStart(3)}  [${byDay.join(" ")}]  ${idle.length ? `IDLE on ${idle.join(",")}` : ""}`);
}

// Conflicts
const warnings = computeWarnings(blocks, specialists as never, grades);
const errors = warnings.filter((w: any) => w.severity === "error");
console.log(`\n— warnings — total ${warnings.length}, errors ${errors.length}`);
for (const w of errors.slice(0, 10)) console.log(`  [ERROR] ${w.message}`);
for (const w of warnings.filter((x: any) => x.severity === "warning").slice(0, 8)) console.log(`  [warn] ${w.message}`);

// Recess violations (manual check): teaching block overlapping the all-band lunch/recess
const lunchStart = timeToMinutes("11:30"), lunchEnd = timeToMinutes("12:15");
const amStart = timeToMinutes("10:00"), amEnd = timeToMinutes("10:15");
const recessViolations = teaching.filter((b: any) => {
  const s = timeToMinutes(b.start_time), e = timeToMinutes(b.end_time);
  return (s < lunchEnd && e > lunchStart) || (s < amEnd && e > amStart);
});
console.log(`— teaching blocks overlapping recess/lunch: ${recessViolations.length}`);
for (const b of recessViolations.slice(0, 5)) console.log(`   ${b.day_of_week} ${b.start_time}-${b.end_time} ${b.subject} Gr${b.grade}`);

// Early release violations
const wedLate = teaching.filter((b: any) => b.day_of_week === "Wed" && timeToMinutes(b.end_time) > timeToMinutes("13:15"));
console.log(`— Wed blocks ending after early release (13:15): ${wedLate.length}`);
