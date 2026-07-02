// Unit tests for buildCpsatSpec — asserts the exact spec JSON per conflict strategy
// (per-duration slot grids, week labels, Big-Group group_ids, extra-rotation budget,
// learned-weight merge/clamp) plus a scoring-parity test that runs a solved fixture
// through computeWarnings → scoreSchedule → qualityPercent.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCpsatSpec, buildPostPassBlocks, mergeWeights, resolveStrategies } from "./_spec_builder.ts";
import { DEFAULT_WEIGHTS, scoreSchedule, type ScoreableInput } from "./_engine/_scoring.ts";
import { computeWarnings, type Block, type Club, type Specialist, type Teacher } from "./_engine/index.ts";
import { qualityPercent } from "../_shared/scoring-rubric.ts";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function mkSpecialist(id: string, subject: string, over: Partial<Specialist> = {}): Specialist {
  return {
    id, name: id, subject, working_days: DAYS, planning_minutes: 30, lunch_minutes: 30,
    uses_cart: false, two_schools: false, is_part_time: false,
    part_time_planning_minutes: null, part_time_lunch_minutes: null, grade_rotation: null,
    location: `${id}-room`, second_location: null, weekly_planning_minutes: 150, class_duration: null, plus_rotation: null, ...over,
  };
}
function mkTeacher(id: string, grade: string, over: Partial<Teacher> = {}): Teacher {
  return { id, name: id, grade, room: `${id}-room`, am_pm_preference: null, day_preference: null, planning_minutes: null, weekly_planning_minutes: 90, lunch_minutes: 30, ...over };
}
// A recess config with a real lunch window so specialist lunch is reserved.
const recessConfigs = [{ grade_band: "all", am_recess_start: "10:00", am_recess_end: "10:15", lunch_start: "12:00", lunch_end: "12:40", pm_recess_start: null, pm_recess_end: null }];

function mkSchool(over: Record<string, unknown> = {}) {
  return {
    start_time: "08:00", end_time: "15:00", passing_time: 5, setup_time: 15, class_duration: 45,
    grades_served: ["1", "2"], keep_grades_together: true, conflict_strategies: [], conflict_strategy: "standard",
    conflict_grades: [], big_group_config: [], admin_rotation: [], plus_rotation: null, grade_time_config: {},
    contractual_minutes_extracted: null, recess_grade_bands: [], planning_minutes: 40, ...over,
  };
}

function baseArgs(schoolOver: Record<string, unknown> = {}, over: Partial<Parameters<typeof buildCpsatSpec>[0]> = {}) {
  return {
    school: mkSchool(schoolOver),
    specialists: [mkSpecialist("pe", "PE"), mkSpecialist("art", "Art")],
    teachers: [mkTeacher("t1", "1"), mkTeacher("t2", "2")],
    recessConfigs, grades: ["1", "2"], learnedWeights: null, ...over,
  };
}

// ─── week labels per strategy ──────────────────────────────────────────
Deno.test("standard → single week [null], sessions_per_pair 1, floor 1", () => {
  const { spec } = buildCpsatSpec(baseArgs());
  assertEquals(spec.week_labels, [null]);
  assertEquals(spec.sessions_per_pair, 1);
  assertEquals(spec.min_sessions_per_pair, 1);
});

Deno.test("ab_week → labels [A,B]", () => {
  const { spec } = buildCpsatSpec(baseArgs({ conflict_strategies: ["ab_week"] }));
  assertEquals(spec.week_labels, ["A", "B"]);
});

Deno.test("aa_bb_week → opaque labels [AA,BB] (NOT [A,B])", () => {
  const { spec } = buildCpsatSpec(baseArgs({ conflict_strategies: ["aa_bb_week"] }));
  assertEquals(spec.week_labels, ["AA", "BB"]);
});

Deno.test("extra_rotation → sessions_per_pair 2", () => {
  const { spec } = buildCpsatSpec(baseArgs({ conflict_strategies: ["extra_rotation"] }));
  assertEquals(spec.sessions_per_pair, 2);
});

// ─── per-duration slot grids (quick_30) ────────────────────────────────
Deno.test("quick_30 mixed durations → a grid for EVERY distinct duration, no silent hole", () => {
  const args = baseArgs({ conflict_strategies: ["quick_30"] });
  args.specialists = [mkSpecialist("pe", "PE"), mkSpecialist("mind", "Mindfulness", { class_duration: 30 })];
  const { spec } = buildCpsatSpec(args);
  for (const grade of ["1", "2"]) {
    const byDur = spec.slots_by_grade_duration[grade];
    assert(byDur[45] && byDur[45].length > 0, `grade ${grade} missing 45-min grid`);
    assert(byDur[30] && byDur[30].length > 0, `grade ${grade} missing 30-min grid (silent hole)`);
    assert(byDur[45].every((s) => s.end - s.start === 45), "45-min slots wrong length");
    assert(byDur[30].every((s) => s.end - s.start === 30), "30-min slots wrong length");
  }
});

// ─── Big-Group group_id fixed sessions ─────────────────────────────────
Deno.test("big_group → taught-together fixed sessions share a group_id, differ by teacher", () => {
  const args = baseArgs({
    conflict_strategies: ["big_group"], conflict_grades: ["1"],
    big_group_config: [{ grade: "1", teacherIds: ["t1", "t1b"] }],
  });
  args.teachers = [mkTeacher("t1", "1"), mkTeacher("t1b", "1"), mkTeacher("t2", "2")];
  const { spec } = buildCpsatSpec(args);
  assertEquals(spec.fixed.length, 2, "two members → two fixed sessions");
  const [a, b] = spec.fixed;
  assertEquals(a.group_id, b.group_id, "members share a group_id");
  assertEquals([a.day, a.start, a.specialist_id], [b.day, b.start, b.specialist_id], "same slot + specialist");
  assert(a.teacher_id !== b.teacher_id, "different member teachers");
  assertEquals(new Set([a.grade, b.grade]), new Set(["1"]));
  // the fixed slot must be a real candidate in the duration grid the solver builds
  const grid = spec.slots_by_grade_duration["1"][spec.specialists.find((s) => s.id === a.specialist_id)!.duration];
  assert(grid.some((s) => s.day === a.day && s.start === a.start), "fixed slot must exist in the grade/duration grid");
});

Deno.test("big_group with a single selected teacher → NOT taught-together (no fixed)", () => {
  const args = baseArgs({
    conflict_strategies: ["big_group"], conflict_grades: ["1"],
    big_group_config: [{ grade: "1", teacherIds: ["t1"] }],
  });
  const { spec } = buildCpsatSpec(args);
  assertEquals(spec.fixed.length, 0);
});

// ─── specialist fields: grade_rotation, cart, planning budget ───────────
Deno.test("specialist fields carry grade_rotation, uses_cart, planning budget", () => {
  const args = baseArgs();
  args.specialists = [
    mkSpecialist("pe", "PE", { uses_cart: true, grade_rotation: { Mon: ["1"], Tue: ["2"] } }),
    mkSpecialist("art", "Art"),
  ];
  const { spec } = buildCpsatSpec(args);
  const pe = spec.specialists.find((s) => s.id === "pe")!;
  assertEquals(pe.uses_cart, true);
  assertEquals(pe.grade_rotation, { Mon: ["1"], Tue: ["2"] });
  assert(pe.planning_free_budget > 0, "planning budget should be positive");
  assertEquals(pe.required_planning_minutes, 150); // weekly_planning_minutes
  assertEquals(pe.grades, null);
  const art = spec.specialists.find((s) => s.id === "art")!;
  assertEquals(art.grade_rotation, undefined, "no grade_rotation → omitted");
});

// ─── class preferences normalized ──────────────────────────────────────
Deno.test("class am_pm + day_preference normalized (full day → short)", () => {
  const args = baseArgs();
  args.teachers = [mkTeacher("t1", "1", { am_pm_preference: "AM", day_preference: "Wednesday" }), mkTeacher("t2", "2")];
  const { spec } = buildCpsatSpec(args);
  const c1 = spec.classes.find((c) => c.teacher_id === "t1")!;
  assertEquals(c1.am_pm_preference, "AM");
  assertEquals(c1.day_preference, "Wed");
  const c2 = spec.classes.find((c) => c.teacher_id === "t2")!;
  assertEquals(c2.am_pm_preference, undefined);
  assertEquals(c2.day_preference, undefined);
});

// ─── contract subjects ─────────────────────────────────────────────────
Deno.test("contractual subject minimums flow into contract_subjects", () => {
  const { spec } = buildCpsatSpec(baseArgs({
    contractual_minutes_extracted: { subjects: [{ grade: "1", subject: "PE", weekly_minutes: 90 }, { grade: "2", subject: "Art", weekly_minutes: 0 }] },
  }));
  assertEquals(spec.contract_subjects, [{ grade: "1", subject: "PE", weekly_minutes: 90 }]); // 0-min entry dropped
});

// ─── learned weights merge + ±50% clamp ────────────────────────────────
Deno.test("no learned weights → defaults + k_late_threshold", () => {
  const w = mergeWeights(null);
  for (const k of Object.keys(DEFAULT_WEIGHTS)) assertEquals(w[k], (DEFAULT_WEIGHTS as Record<string, number>)[k]);
  assertEquals(w.k_late_threshold, 780);
});

Deno.test("learned weights merge and clamp to ±50% of default", () => {
  // default subject_gap = -40 → clamp range [-60, -20]. -80 clamps to -60; -30 passes.
  const w = mergeWeights({ subject_gap: -80, class_repeats: -30 });
  assertEquals(w.subject_gap, -60);
  assertEquals(w.class_repeats, -30);
  // unrelated key stays default
  assertEquals(w.full_week_coverage, DEFAULT_WEIGHTS.full_week_coverage);
});

Deno.test("resolveStrategies: multi list wins, else single, else standard", () => {
  assertEquals(resolveStrategies({ conflict_strategies: ["ab_week", "makeup"] }), ["ab_week", "makeup"]);
  assertEquals(resolveStrategies({ conflict_strategies: [], conflict_strategy: "big_group" }), ["big_group"]);
  assertEquals(resolveStrategies({}), ["standard"]);
});

// ─── PLUS/lunch reservations become busy ───────────────────────────────
Deno.test("specialist lunch is reserved into busy", () => {
  const { spec, lunchBlocks } = buildCpsatSpec(baseArgs());
  assert(lunchBlocks.length > 0, "expected specialist lunch reservations");
  assert(spec.busy.length > 0, "lunch should appear as busy");
  assert(spec.busy.every((b) => b.end > b.start && DAYS.includes(b.day)));
});

// ─── SCORING PARITY: a solved fixture through the public pipeline ───────
Deno.test("parity: a clean fully-covered fixture scores 100 via computeWarnings+scoreSchedule+qualityPercent", () => {
  const specialists = [mkSpecialist("pe", "PE"), mkSpecialist("art", "Art")];
  const teachers = [mkTeacher("t1", "1", { weekly_planning_minutes: 0 }), mkTeacher("t2", "2", { weekly_planning_minutes: 0 })];
  const grades = ["1", "2"];
  // Every class sees every specialist once. Both of a grade's (distinct-subject)
  // sessions sit on ONE day so grade_cohesion is 0; distinct times avoid a teacher
  // double-book; distinct subjects avoid clustering; every pair is covered.
  const blocks: Block[] = [
    { generation_id: "", day_of_week: "Mon", start_time: "09:00", end_time: "09:45", subject: "PE", specialist_id: "pe", teacher_id: "t1", grade: "1", room: "g", week_label: null },
    { generation_id: "", day_of_week: "Mon", start_time: "10:00", end_time: "10:45", subject: "Art", specialist_id: "art", teacher_id: "t1", grade: "1", room: "g", week_label: null },
    { generation_id: "", day_of_week: "Tue", start_time: "09:00", end_time: "09:45", subject: "PE", specialist_id: "pe", teacher_id: "t2", grade: "2", room: "g", week_label: null },
    { generation_id: "", day_of_week: "Tue", start_time: "10:00", end_time: "10:45", subject: "Art", specialist_id: "art", teacher_id: "t2", grade: "2", room: "g", week_label: null },
  ];
  const warnings = computeWarnings(blocks, specialists, grades, teachers);
  assertEquals(warnings.filter((w) => w.severity === "error").length, 0);
  const scoringInput: ScoreableInput = {
    school: { start_time: "08:00", end_time: "15:00", keep_grades_together: true, contractual_minutes_extracted: null },
    specialists: specialists.map((s) => ({ id: s.id, subject: s.subject, working_days: s.working_days })),
    teachers: teachers.map((t) => ({ id: t.id, am_pm_preference: t.am_pm_preference, day_preference: t.day_preference, weekly_planning_minutes: t.weekly_planning_minutes })),
    grades,
  };
  const breakdown = scoreSchedule({ blocks, warnings, preferenceViolations: [] }, scoringInput).breakdown as unknown as Record<string, number>;
  const q = qualityPercent(breakdown);
  assertEquals(q, 100, `expected a clean covered fixture to score 100, got ${q} (${JSON.stringify(breakdown)})`);
});

Deno.test("parity: a schedule missing coverage scores below 100 with a subject_gap penalty", () => {
  const specialists = [mkSpecialist("pe", "PE"), mkSpecialist("art", "Art")];
  const teachers = [mkTeacher("t1", "1", { weekly_planning_minutes: 0 })];
  const grades = ["1"];
  // t1 sees PE only → Art is a subject gap for grade 1.
  const blocks: Block[] = [
    { generation_id: "", day_of_week: "Mon", start_time: "09:00", end_time: "09:45", subject: "PE", specialist_id: "pe", teacher_id: "t1", grade: "1", room: "g", week_label: null },
  ];
  const warnings = computeWarnings(blocks, specialists, grades, teachers);
  const scoringInput: ScoreableInput = {
    school: { start_time: "08:00", end_time: "15:00", keep_grades_together: true, contractual_minutes_extracted: null },
    specialists: specialists.map((s) => ({ id: s.id, subject: s.subject, working_days: s.working_days })),
    teachers: teachers.map((t) => ({ id: t.id, weekly_planning_minutes: t.weekly_planning_minutes })),
    grades,
  };
  const breakdown = scoreSchedule({ blocks, warnings, preferenceViolations: [] }, scoringInput).breakdown as unknown as Record<string, number>;
  assert(breakdown.subject_gap < 0, "expected a subject_gap penalty");
  assert(qualityPercent(breakdown) < 100, "expected quality below 100");
});

// ─── Part B #5: makeup / lunch_clubs / event_planning blocks persist (edge) ──
// OLD BUG: generate-cpsat dropped these post-pass blocks entirely, so schools using
// those strategies lost them (generate-schedule kept them). NEW: buildPostPassBlocks
// — the SAME pure function the serve handler calls before SSOT re-validation, using
// the SAME engine generators generate-schedule uses — emits them when the strategy is
// on. This asserts each block TYPE shows up in what gets persisted.
Deno.test("post-passes: makeup + lunch_clubs + event_planning block types are produced when enabled", () => {
  const strategies = ["standard", "makeup", "lunch_clubs", "event_planning"];
  const { spec, plusBlocks, lunchBlocks, strategies: builtStrategies } = buildCpsatSpec(baseArgs({
    conflict_strategies: strategies,
  }));
  assertEquals(builtStrategies, strategies); // buildCpsatSpec surfaces the strategy flags
  const specialists = [mkSpecialist("pe", "PE"), mkSpecialist("art", "Art")];
  const teachingBlocks: Block[] = [
    { generation_id: "", day_of_week: "Mon", start_time: "09:00", end_time: "09:45", subject: "PE", specialist_id: "pe", teacher_id: "t1", grade: "1", room: "g", week_label: null },
  ];
  const clubs: Club[] = [{ id: "c1", name: "Chess Club", day_of_week: "Mon", grades: "All", start_time: "12:00", end_time: "12:30" }];

  const post = buildPostPassBlocks({
    teachingBlocks, strategies: builtStrategies, specialists, school: mkSchool({ conflict_strategies: strategies }),
    recessConfigs, clubs, grades: ["1", "2"], defaultDur: 45, plusBlocks, lunchBlocks,
  });

  const makeup = post.filter((b) => b.grade === "Makeup");
  const planning = post.filter((b) => b.grade === "Planning");
  const club = post.filter((b) => b.subject === "Chess Club");
  assert(makeup.length > 0, "makeup blocks (grade 'Makeup') must be persisted");
  assert(makeup.every((b) => (b.subject ?? "").includes("(Makeup)")), "makeup subject label");
  assert(planning.length > 0, "event-planning blocks (grade 'Planning') must be persisted");
  assert(planning.every((b) => (b.subject ?? "").includes("Event Planning")), "event-planning subject label");
  assert(club.length > 0, "lunch-club block (from clubs) must be persisted");
});

Deno.test("post-passes: none produced when the strategies are off", () => {
  const { plusBlocks, lunchBlocks } = buildCpsatSpec(baseArgs());
  const post = buildPostPassBlocks({
    teachingBlocks: [], strategies: ["standard"], specialists: [mkSpecialist("pe", "PE")],
    school: mkSchool(), recessConfigs, clubs: [], grades: ["1", "2"], defaultDur: 45, plusBlocks, lunchBlocks,
  });
  assertEquals(post.length, 0);
});
