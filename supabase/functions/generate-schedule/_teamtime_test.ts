import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeGradeOutWindows, bestPdWindowPerGrade } from "./_teamtime.ts";

const blk = (over: Record<string, unknown>) => ({
  generation_id: "g", day_of_week: "Mon", start_time: "09:00", end_time: "09:45",
  subject: "Art", specialist_id: "art", teacher_id: "t1", grade: "3",
  room: null, week_label: null, ...over,
}) as never;

// Three 3rd-grade classes; three specialists so the whole grade can go at once.
const T3 = [
  { id: "t1", grade: "3" },
  { id: "t2", grade: "3" },
  { id: "t3", grade: "3" },
];
const SPECS = [{ id: "art" }, { id: "pe" }, { id: "tech" }, { id: "lib", teacher_accompanies: true }];

Deno.test("a pure wheel gives the whole grade one simultaneous window", () => {
  // All three classes out 09:00-09:45 with different specialists.
  const blocks = [
    blk({ teacher_id: "t1", specialist_id: "art" }),
    blk({ teacher_id: "t2", specialist_id: "pe" }),
    blk({ teacher_id: "t3", specialist_id: "tech" }),
  ];
  const [w] = computeGradeOutWindows(blocks, T3, SPECS);
  assertEquals(w.allOutMin, 45);
  assertEquals(w.outCount, 3);
  assertEquals(w.quorumMin, 3);
  assertEquals(w.startMin, 9 * 60);
  assertEquals(w.endMin, 9 * 60 + 45);
  assertEquals(w.maxTeacherRunMin, 45);
});

Deno.test("back-to-back waves extend the window; the cap sees the same stretch", () => {
  // Two consecutive 45-min waves with a 5-min gap = 95 minutes together.
  const wave = (start: string, end: string) => [
    blk({ teacher_id: "t1", specialist_id: "art", start_time: start, end_time: end }),
    blk({ teacher_id: "t2", specialist_id: "pe", start_time: start, end_time: end }),
    blk({ teacher_id: "t3", specialist_id: "tech", start_time: start, end_time: end }),
  ];
  const blocks = [...wave("09:00", "09:45"), ...wave("09:50", "10:35")];
  const [w] = computeGradeOutWindows(blocks, T3, SPECS);
  assertEquals(w.allOutMin, 95);
  // The same 95 minutes is what the out-of-class cap measures.
  assertEquals(w.maxTeacherRunMin, 95);
});

Deno.test("a staggered wheel gives only the overlap", () => {
  const blocks = [
    blk({ teacher_id: "t1", specialist_id: "art", start_time: "09:00", end_time: "09:45" }),
    blk({ teacher_id: "t2", specialist_id: "pe", start_time: "09:15", end_time: "10:00" }),
    blk({ teacher_id: "t3", specialist_id: "tech", start_time: "09:30", end_time: "10:15" }),
  ];
  const [w] = computeGradeOutWindows(blocks, T3, SPECS);
  assertEquals(w.allOutMin, 15); // 09:30-09:45 is the only all-three overlap
  assertEquals(w.startMin, 9 * 60 + 30);
});

Deno.test("an accompanied specialist does not free the teacher", () => {
  const blocks = [
    blk({ teacher_id: "t1", specialist_id: "art" }),
    blk({ teacher_id: "t2", specialist_id: "pe" }),
    // t3 is at Library WITH their class — the grade is not free.
    blk({ teacher_id: "t3", specialist_id: "lib" }),
  ];
  const [w] = computeGradeOutWindows(blocks, T3, SPECS);
  assertEquals(w.allOutMin, 0);
  assertEquals(w.outCount, 2);
});

Deno.test("quorum lets an over-rotated grade still find a window", () => {
  // Five classes, only four specialists: one class can never join.
  const t5 = ["t1", "t2", "t3", "t4", "t5"].map((id) => ({ id, grade: "5" }));
  const specs = [{ id: "art" }, { id: "pe" }, { id: "tech" }, { id: "mus" }];
  const blocks = [
    blk({ grade: "5", teacher_id: "t1", specialist_id: "art" }),
    blk({ grade: "5", teacher_id: "t2", specialist_id: "pe" }),
    blk({ grade: "5", teacher_id: "t3", specialist_id: "tech" }),
    blk({ grade: "5", teacher_id: "t4", specialist_id: "mus" }),
  ];
  const strict = computeGradeOutWindows(blocks, t5, specs)[0];
  assertEquals(strict.quorumMin, 5);
  assertEquals(strict.allOutMin, 0, "100% quorum is structurally impossible here");

  const relaxed = computeGradeOutWindows(blocks, t5, specs, { quorumPct: 80 })[0];
  assertEquals(relaxed.quorumMin, 4);
  assertEquals(relaxed.allOutMin, 45, "4-of-5 counts at an 80% quorum");
  assertEquals(relaxed.outCount, 4);
});

Deno.test("touching blocks do not count as overlapping coverage", () => {
  const blocks = [
    blk({ teacher_id: "t1", start_time: "09:00", end_time: "09:45", specialist_id: "art" }),
    blk({ teacher_id: "t2", start_time: "09:45", end_time: "10:30", specialist_id: "pe" }),
    blk({ teacher_id: "t3", start_time: "09:45", end_time: "10:30", specialist_id: "tech" }),
  ];
  const [w] = computeGradeOutWindows(blocks, T3, SPECS);
  assertEquals(w.allOutMin, 0, "t1 leaves exactly as the others arrive");
});

Deno.test("bestPdWindowPerGrade takes the weakest label, then the best day", () => {
  const wave = (day: string, label: string | null, end: string) => [
    blk({ day_of_week: day, week_label: label, teacher_id: "t1", specialist_id: "art", end_time: end }),
    blk({ day_of_week: day, week_label: label, teacher_id: "t2", specialist_id: "pe", end_time: end }),
    blk({ day_of_week: day, week_label: label, teacher_id: "t3", specialist_id: "tech", end_time: end }),
  ];
  const blocks = [
    // Monday: 45 min in week A but only 20 in week B -> the grade can rely on 20.
    ...wave("Mon", "A", "09:45"),
    ...wave("Mon", "B", "09:20"),
    // Tuesday: 30 min in both weeks -> reliably 30, which beats Monday's 20.
    ...wave("Tue", "A", "09:30"),
    ...wave("Tue", "B", "09:30"),
  ];
  const best = bestPdWindowPerGrade(computeGradeOutWindows(blocks, T3, SPECS));
  const g3 = best.get("3")!;
  assertEquals(g3.day, "Tue");
  assertEquals(g3.allOutMin, 30);
});

Deno.test("grades with no blocks produce no rows", () => {
  assertEquals(computeGradeOutWindows([], T3, SPECS).length, 0);
  assertEquals(computeGradeOutWindows([blk({})], [], SPECS).length, 0);
});

Deno.test("reserved pseudo-grades never count as a class being out", () => {
  const blocks = [
    blk({ teacher_id: "t1", grade: "Lunch", subject: "Specialist Lunch" }),
    blk({ teacher_id: "t2", grade: "Planning" }),
    blk({ teacher_id: "t3", specialist_id: "tech" }),
  ];
  const [w] = computeGradeOutWindows(blocks, T3, SPECS);
  assertEquals(w.outCount, 1);
  assertEquals(w.allOutMin, 0);
});
