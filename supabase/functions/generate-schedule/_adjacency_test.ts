// Unit tests for the grade-adjacency post-pass (pure, no I/O).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { reorderGradeRuns, countGradeRuns, type AdjBlock } from "./_adjacency.ts";

const school = { start_time: "08:00", end_time: "15:00" };
const recessConfigs: any[] = [];

let idc = 0;
function blk(over: Partial<AdjBlock>): AdjBlock {
  return {
    id: `b${idc++}`,
    day_of_week: "Mon",
    start_time: "08:00",
    end_time: "08:45",
    specialist_id: "art",
    teacher_id: "t1",
    grade: "5",
    subject: "Art",
    week_label: null,
    ...over,
  };
}

/** 4 interleaved 45-min slots for one specialist: 5,3,5,3. */
function interleavedDay(): AdjBlock[] {
  return [
    blk({ grade: "5", teacher_id: "t5a", start_time: "08:00", end_time: "08:45" }),
    blk({ grade: "3", teacher_id: "t3a", start_time: "08:50", end_time: "09:35" }),
    blk({ grade: "5", teacher_id: "t5b", start_time: "09:40", end_time: "10:25" }),
    blk({ grade: "3", teacher_id: "t3b", start_time: "10:30", end_time: "11:15" }),
  ];
}

Deno.test("scrambled 5,3,5,3 → contiguous 5,5,3,3 (and deterministic)", () => {
  const a = reorderGradeRuns(interleavedDay(), { school, recessConfigs });
  const sorted = [...a.blocks].sort((x, y) => x.start_time.localeCompare(y.start_time));
  assertEquals(sorted.map((b) => b.grade), ["5", "5", "3", "3"]);
  assertEquals(a.stats.runsBefore, 4);
  assertEquals(a.stats.runsAfter, 2);
  // Deterministic: same input twice → same placements (ids differ per fixture call).
  const b = reorderGradeRuns(interleavedDay(), { school, recessConfigs });
  const placements = (r: typeof a) => r.blocks.map((x) => `${x.teacher_id}@${x.start_time}`).sort();
  assertEquals(placements(a), placements(b));
});

Deno.test("idempotent: reorder(reorder(x)) === reorder(x)", () => {
  const once = reorderGradeRuns(interleavedDay(), { school, recessConfigs }).blocks;
  const twice = reorderGradeRuns(once, { school, recessConfigs }).blocks;
  assertEquals(twice, once);
});

Deno.test("teacher-conflict pins a unit (no teacher double-book created)", () => {
  const day = interleavedDay();
  // t5b is busy 08:00-08:45 with ANOTHER specialist — its class can't take slot 1.
  const conflict = blk({ specialist_id: "music", teacher_id: "t5b", grade: "5", start_time: "08:00", end_time: "08:45" });
  const { blocks } = reorderGradeRuns([...day, conflict], { school, recessConfigs });
  const t5b = blocks.find((b) => b.teacher_id === "t5b" && b.specialist_id === "art")!;
  assert(t5b.start_time !== "08:00", "t5b must not land on its own conflicting slot");
  // And nothing double-books: t5b's art block must not overlap the music block.
  const music = blocks.find((b) => b.specialist_id === "music")!;
  const overlap = t5b.day_of_week === music.day_of_week &&
    t5b.start_time < music.end_time && music.start_time < t5b.end_time;
  assert(!overlap, "no teacher double-book");
});

Deno.test("mixed durations never swap slots", () => {
  const day = [
    blk({ grade: "5", teacher_id: "a", start_time: "08:00", end_time: "08:30" }), // 30 min
    blk({ grade: "3", teacher_id: "b", start_time: "08:35", end_time: "09:20" }), // 45 min
    blk({ grade: "5", teacher_id: "c", start_time: "09:25", end_time: "10:10" }), // 45 min
  ];
  const { blocks } = reorderGradeRuns(day, { school, recessConfigs });
  const thirty = blocks.find((b) => b.teacher_id === "a")!;
  assertEquals(thirty.start_time, "08:00");
  assertEquals(thirty.end_time, "08:30"); // the lone 30-min block cannot move
});

Deno.test("recess-window violation prevented (grade-specific band)", () => {
  // Grade 3's band has recess 08:00-08:15 — a grade-3 class must NOT move
  // into the 08:00 slot even though grade 5 sits there comfortably.
  const rc = [{ grade_band: "g3", grades: ["3"], am_recess_start: "08:00", am_recess_end: "08:15" }];
  const school3 = { ...school, recess_grade_bands: [{ key: "g3", label: "3s", grades: ["3"] }] };
  const day = [
    blk({ grade: "3", teacher_id: "x", start_time: "08:50", end_time: "09:35" }),
    blk({ grade: "5", teacher_id: "y", start_time: "08:00", end_time: "08:45" }),
    blk({ grade: "3", teacher_id: "z", start_time: "10:30", end_time: "11:15" }),
    blk({ grade: "5", teacher_id: "w", start_time: "09:40", end_time: "10:25" }),
  ];
  const { blocks } = reorderGradeRuns(day, { school: school3, recessConfigs: rc });
  for (const b of blocks) {
    if (b.grade === "3") assert(b.start_time !== "08:00", "grade 3 must not sit in its own recess");
  }
});

Deno.test("big-group unit moves together", () => {
  // Two grade-4 classes taught TOGETHER (same slot) + interleaved grade 2s.
  const day = [
    blk({ grade: "2", teacher_id: "t2a", start_time: "08:00", end_time: "08:45" }),
    blk({ grade: "4", teacher_id: "t4a", start_time: "08:50", end_time: "09:35" }),
    blk({ grade: "4", teacher_id: "t4b", start_time: "08:50", end_time: "09:35" }), // same slot = unit
    blk({ grade: "2", teacher_id: "t2b", start_time: "09:40", end_time: "10:25" }),
  ];
  const { blocks } = reorderGradeRuns(day, { school, recessConfigs });
  const g4 = blocks.filter((b) => b.grade === "4");
  assertEquals(g4.length, 2);
  assertEquals(g4[0].start_time, g4[1].start_time, "taught-together members share a slot after reorder");
  assertEquals(g4[0].end_time, g4[1].end_time);
});

Deno.test("fixed blocks never move; K-guard blocks a past-13:00 move", () => {
  const lunch = blk({ subject: "Specialist Lunch", grade: "Lunch", teacher_id: null, start_time: "11:30", end_time: "12:00" });
  const meeting = blk({ subject: "Specialist Meeting", grade: "Planning", teacher_id: null, start_time: "13:15", end_time: "14:00" });
  // K at 08:00 and grade 1 at 13:00 — grouping K after grade 1 would push K past
  // 13:00; the K-guard must forbid it (identity retained).
  const k = blk({ grade: "K", teacher_id: "tk", start_time: "08:00", end_time: "08:45" });
  const g1a = blk({ grade: "1", teacher_id: "t1a", start_time: "08:50", end_time: "09:35" });
  const g1b = blk({ grade: "1", teacher_id: "t1b", start_time: "13:00", end_time: "13:45" });
  const { blocks } = reorderGradeRuns([lunch, meeting, k, g1a, g1b], { school, recessConfigs });
  const kAfter = blocks.find((b) => b.grade === "K")!;
  assert(kAfter.start_time < "13:00", `K must stay before 13:00, got ${kAfter.start_time}`);
  assertEquals(blocks.find((b) => b.subject === "Specialist Lunch")!.start_time, "11:30");
  assertEquals(blocks.find((b) => b.subject === "Specialist Meeting")!.start_time, "13:15");
});

Deno.test("AM/PM guard: a satisfied AM preference is never flipped to PM", () => {
  const teachers = [{ id: "amT", am_pm_preference: "AM" }];
  const day = [
    blk({ grade: "2", teacher_id: "amT", start_time: "09:00", end_time: "09:45" }),  // AM, satisfied
    blk({ grade: "4", teacher_id: "x", start_time: "09:50", end_time: "10:35" }),
    blk({ grade: "2", teacher_id: "y", start_time: "13:00", end_time: "13:45" }),    // PM grade-2
    blk({ grade: "4", teacher_id: "z", start_time: "13:50", end_time: "14:35" }),
  ];
  const { blocks } = reorderGradeRuns(day, { school, recessConfigs, teachers });
  const amBlock = blocks.find((b) => b.teacher_id === "amT")!;
  assert(amBlock.start_time < "12:00", "AM-preferring teacher stays in the morning");
});

Deno.test("countGradeRuns counts maximal same-grade streaks", () => {
  assertEquals(countGradeRuns(interleavedDay()), 4);
  const grouped = [
    blk({ grade: "5", start_time: "08:00", end_time: "08:45" }),
    blk({ grade: "5", start_time: "08:50", end_time: "09:35" }),
    blk({ grade: "3", start_time: "09:40", end_time: "10:25" }),
  ];
  assertEquals(countGradeRuns(grouped), 2);
});

// ─── Wheel guard (wheel_alignment is order-sensitive; pass must revert) ─────
// school has no rotation_wheel_grades → wheel mode ON by default.

/** Another specialist's day, passed as fixedContext so it can't move. */
function musicDay(grades: string[]): AdjBlock[] {
  const starts = [["08:00", "08:45"], ["08:50", "09:35"], ["09:40", "10:25"], ["10:30", "11:15"]];
  return grades.map((g, i) =>
    blk({ specialist_id: "music", subject: "Music", grade: g, teacher_id: `m${i}`, start_time: starts[i][0], end_time: starts[i][1] }));
}

Deno.test("wheel guard: reorder that would break pure waves is reverted", () => {
  // Music (fixed) mirrors art's 5,3,5,3 → every wave is currently PURE.
  // Grouping art into 5,5,3,3 would improve runs but mix waves 2 and 3 —
  // the guard must roll the day back.
  const art = interleavedDay();
  const { blocks, stats } = reorderGradeRuns(art, {
    school, recessConfigs, fixedContext: musicDay(["5", "3", "5", "3"]),
  });
  const sorted = [...blocks].sort((x, y) => x.start_time.localeCompare(y.start_time));
  assertEquals(sorted.map((b) => b.grade), ["5", "3", "5", "3"], "wave purity outranks run grouping");
  assertEquals(stats.runsAfter, stats.runsBefore, "reverted day keeps its original runs");
});

Deno.test("wheel guard: reorder that also improves wave purity is applied", () => {
  // Music (fixed) is already grouped 5,5,3,3 → art's interleave is what mixes
  // the waves; grouping art fixes runs AND purity. Must be applied.
  const art = interleavedDay();
  const { blocks } = reorderGradeRuns(art, {
    school, recessConfigs, fixedContext: musicDay(["5", "5", "3", "3"]),
  });
  const sorted = [...blocks].sort((x, y) => x.start_time.localeCompare(y.start_time));
  assertEquals(sorted.map((b) => b.grade), ["5", "5", "3", "3"]);
});

Deno.test("wheel guard: rotation_wheel_grades [] disables it (pre-wheel behavior)", () => {
  // Identical setup to the revert test, but the school opted out of wheels —
  // the pass groups runs exactly as before the guard existed.
  const art = interleavedDay();
  const { blocks } = reorderGradeRuns(art, {
    school: { ...school, rotation_wheel_grades: [] },
    recessConfigs,
    fixedContext: musicDay(["5", "3", "5", "3"]),
  });
  const sorted = [...blocks].sort((x, y) => x.start_time.localeCompare(y.start_time));
  assertEquals(sorted.map((b) => b.grade), ["5", "5", "3", "3"]);
});
