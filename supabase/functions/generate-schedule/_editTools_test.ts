// Tests for the edit-with-ai v2 engine tool cores (_editTools.ts). Pure fixtures,
// no I/O: free-slot enumeration correctness, preview_ops delta math, scoped
// improve_quality (never regresses + perturbation anchor), conflict fix preview.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  enumerateFreeSlots, previewOps, applyOpsToBlocks, improveQualityScoped,
  conflictFixOptions, qualityReport, scoreBlocks, diffToOps,
  type EditBlock, type EditOp, type EditToolContext,
} from "./_editTools.ts";

// ─── Fixture: a tiny school ──────────────────────────────────────────────────
const school = {
  start_time: "08:00", end_time: "15:00", class_duration: 45, passing_time: 5, setup_time: 15,
  grade_time_config: {}, keep_grades_together: true, recess_grade_bands: [],
};
const recessConfigs = [{ grade_band: "all", lunch_start: "12:00", lunch_end: "12:40" }];
const specialists = [
  { id: "pe", name: "Coach P", subject: "PE", working_days: ["Mon", "Tue", "Wed", "Thu", "Fri"], planning_minutes: 30, lunch_minutes: 30, uses_cart: false, two_schools: false, is_part_time: false, part_time_planning_minutes: null, part_time_lunch_minutes: null, grade_rotation: null, location: "gym", second_location: null, weekly_planning_minutes: 0, class_duration: null, plus_rotation: null },
  { id: "art", name: "Ms A", subject: "Art", working_days: ["Mon", "Tue", "Wed", "Thu", "Fri"], planning_minutes: 30, lunch_minutes: 30, uses_cart: false, two_schools: false, is_part_time: false, part_time_planning_minutes: null, part_time_lunch_minutes: null, grade_rotation: null, location: "artroom", second_location: null, weekly_planning_minutes: 0, class_duration: null, plus_rotation: null },
] as any[];
const teachers = [
  { id: "t1", name: "Smith", grade: "1", room: "101", weekly_planning_minutes: 0 },
  { id: "t2", name: "Jones", grade: "2", room: "102", weekly_planning_minutes: 0 },
];
const ctx: EditToolContext = { school, recessConfigs, specialists, teachers: teachers as any, grades: ["1", "2"] };

let seq = 0;
function blk(over: Partial<EditBlock>): EditBlock {
  return {
    id: `blk_${seq++}`, generation_id: "g", day_of_week: "Mon", start_time: "09:00:00", end_time: "09:45:00",
    subject: "PE", specialist_id: "pe", teacher_id: "t1", grade: "1", room: "gym", week_label: null, ...over,
  };
}

/** A clean 4-block schedule: each class sees each specialist once, no clashes. */
function cleanBlocks(): EditBlock[] {
  seq = 0;
  return [
    blk({ day_of_week: "Mon", start_time: "09:00:00", end_time: "09:45:00", subject: "PE", specialist_id: "pe", teacher_id: "t1", grade: "1" }),
    blk({ day_of_week: "Mon", start_time: "10:00:00", end_time: "10:45:00", subject: "Art", specialist_id: "art", teacher_id: "t1", grade: "1" }),
    blk({ day_of_week: "Tue", start_time: "09:00:00", end_time: "09:45:00", subject: "PE", specialist_id: "pe", teacher_id: "t2", grade: "2" }),
    blk({ day_of_week: "Tue", start_time: "10:00:00", end_time: "10:45:00", subject: "Art", specialist_id: "art", teacher_id: "t2", grade: "2" }),
  ];
}

// ─── enumerateFreeSlots ──────────────────────────────────────────────────────
Deno.test("free slots: legal, capped, never on lunch or an occupied specialist slot", () => {
  const blocks = cleanBlocks();
  const slots = enumerateFreeSlots({ specialist_id: "pe", grade: "1" }, blocks, ctx);
  assert(slots.length > 0, "expected open slots");
  assert(slots.length <= 30, "cap 30");
  // PE already teaches Mon 09:00 — that exact slot must NOT be offered.
  assert(!slots.some((s) => s.day === "Mon" && s.start_time === "09:00:00"), "occupied slot offered");
  // Nothing during the grade's lunch window (12:00–12:40).
  for (const s of slots) {
    const start = Number(s.start_time.slice(0, 2)) * 60 + Number(s.start_time.slice(3, 5));
    const end = Number(s.end_time.slice(0, 2)) * 60 + Number(s.end_time.slice(3, 5));
    assert(!(start < 760 && end > 720), `slot overlaps lunch: ${JSON.stringify(s)}`);
  }
});

Deno.test("free slots: day filter narrows results; teacher occupancy respected", () => {
  const blocks = cleanBlocks();
  const wed = enumerateFreeSlots({ specialist_id: "art", teacher_id: "t1", day: "Wed" }, blocks, ctx);
  assert(wed.length > 0 && wed.every((s) => s.day === "Wed"));
  // t1 is busy Mon 09:00 (with PE) — Art must not be offered that teacher-slot.
  const mon = enumerateFreeSlots({ specialist_id: "art", teacher_id: "t1", day: "Mon" }, blocks, ctx);
  assert(!mon.some((s) => s.start_time === "09:00:00"), "teacher-occupied slot offered");
});

// ─── previewOps ──────────────────────────────────────────────────────────────
Deno.test("preview: legal move reports all_legal + exact delta math", () => {
  const blocks = cleanBlocks();
  const before = scoreBlocks(blocks, ctx).percent;
  const op: EditOp = { kind: "move", label: "Move PE", block_id: blocks[0].id, day_of_week: "Wed", start_time: "09:00:00", end_time: "09:45:00" };
  const r = previewOps([op], blocks, ctx);
  assertEquals(r.all_legal, true);
  assertEquals(r.quality_before, before);
  assertEquals(r.quality_delta, r.quality_after - r.quality_before);
  assertEquals(r.new_errors, 0);
});

Deno.test("preview: illegal move (onto lunch) is flagged with violation text and skipped", () => {
  const blocks = cleanBlocks();
  const op: EditOp = { kind: "move", label: "Bad move", block_id: blocks[0].id, day_of_week: "Mon", start_time: "12:00:00", end_time: "12:45:00" };
  const r = previewOps([op], blocks, ctx);
  assertEquals(r.all_legal, false);
  assert(r.ops[0].violations.length > 0, "expected a violation description");
  // Skipped op ⇒ candidate unchanged ⇒ zero delta.
  assertEquals(r.quality_delta, 0);
  const cand = r.candidateBlocks.find((b) => b.id === blocks[0].id)!;
  assertEquals(cand.start_time, "09:00:00");
});

Deno.test("preview: de-clustering move yields a positive quality delta", () => {
  // Grade 1 sees Art twice on Mon (clustering penalty); moving one to Thu fixes it.
  const blocks = cleanBlocks();
  blocks.push(blk({ day_of_week: "Mon", start_time: "11:00:00", end_time: "11:45:00", subject: "Art", specialist_id: "art", teacher_id: "t1", grade: "1" }));
  const dup = blocks[blocks.length - 1];
  const op: EditOp = { kind: "move", label: "De-cluster Art", block_id: dup.id, day_of_week: "Thu", start_time: "11:00:00", end_time: "11:45:00" };
  const r = previewOps([op], blocks, ctx);
  assertEquals(r.all_legal, true);
  assert(r.quality_delta > 0, `expected positive delta, got ${r.quality_delta}`);
});

Deno.test("preview: double-booking swap is rejected by the SSOT", () => {
  const blocks = cleanBlocks();
  // Try to move Art (t1) onto PE (t1)'s Mon 09:00 slot → teacher double-book.
  const op: EditOp = { kind: "move", label: "Clash", block_id: blocks[1].id, day_of_week: "Mon", start_time: "09:00:00", end_time: "09:45:00" };
  const r = previewOps([op], blocks, ctx);
  assertEquals(r.all_legal, false);
  assert(r.ops[0].violations.some((v) => /double-book/i.test(v)));
});

// ─── improveQualityScoped ────────────────────────────────────────────────────
Deno.test("improve_quality: never regresses and is deterministic per seed", () => {
  const blocks = cleanBlocks();
  // Make it improvable: cluster Art twice on Mon for grade 1.
  blocks.push(blk({ day_of_week: "Mon", start_time: "11:00:00", end_time: "11:45:00", subject: "Art", specialist_id: "art", teacher_id: "t1", grade: "1" }));
  const r1 = improveQualityScoped({ focus: "subject_day_clustering", seedKey: "s1" }, blocks, ctx);
  const r2 = improveQualityScoped({ focus: "subject_day_clustering", seedKey: "s1" }, blocks, ctx);
  assert(r1.quality_after >= r1.quality_before, "must never regress");
  assertEquals(JSON.stringify(r1.ops), JSON.stringify(r2.ops), "same seed ⇒ same ops");
  assert(r1.quality_delta > 0, `expected the clustering fix to improve quality, got ${r1.quality_delta}`);
});

Deno.test("improve_quality: respects the perturbation anchor (moves little; no-ops at the ceiling)", () => {
  const clean = cleanBlocks();
  const atCeiling = improveQualityScoped({ seedKey: "s2" }, clean, ctx);
  assertEquals(atCeiling.ops.length, 0, "an already-clean schedule needs no moves");
  assert(atCeiling.note !== null, "should say it is at the ceiling");
  assertEquals(atCeiling.moved_blocks, 0);

  // Scoped to clustering only: fixing a same-day duplicate is a single relocate,
  // so the anchored pass must move at most the duplicate (+1 ripple at most).
  const blocks = cleanBlocks();
  blocks.push(blk({ day_of_week: "Mon", start_time: "11:00:00", end_time: "11:45:00", subject: "Art", specialist_id: "art", teacher_id: "t1", grade: "1" }));
  const scoped = improveQualityScoped({ focus: "subject_day_clustering", seedKey: "s3" }, blocks, ctx);
  assert(scoped.moved_blocks <= 2, `perturbation anchor violated (scoped): moved ${scoped.moved_blocks}`);

  // Auto focus may also repair class_repeats, which re-places one class's
  // sessions — the anchor still bounds movement to that one class (3 sessions),
  // never a broad rewrite of other classes.
  const auto = improveQualityScoped({ seedKey: "s3" }, blocks, ctx);
  const t1Sessions = blocks.filter((b) => b.teacher_id === "t1").length;
  assert(auto.moved_blocks <= t1Sessions, `anchor violated (auto): moved ${auto.moved_blocks} > ${t1Sessions}`);
  // And it never touches the OTHER class's placements.
  const { candidate } = applyOpsToBlocks(blocks, auto.ops, ctx);
  for (const b of blocks.filter((x) => x.teacher_id === "t2")) {
    const after = candidate.find((c) => c.id === b.id);
    assert(after && after.day_of_week === b.day_of_week && after.start_time === b.start_time, "t2's blocks must not move");
  }
});

Deno.test("rebalance: uneven specialist day-load is evened out via legal moves", () => {
  // PE teaches 3 on Mon, 0 elsewhere → rebalance should spread across days.
  seq = 0;
  const blocks: EditBlock[] = [
    blk({ day_of_week: "Mon", start_time: "09:00:00", end_time: "09:45:00", teacher_id: "t1", grade: "1" }),
    blk({ day_of_week: "Mon", start_time: "10:00:00", end_time: "10:45:00", teacher_id: "t2", grade: "2" }),
    blk({ day_of_week: "Mon", start_time: "11:00:00", end_time: "11:45:00", teacher_id: "t1", grade: "1", subject: "PE" }),
  ];
  const r = improveQualityScoped({ specialist_id: "pe", seedKey: "s4" }, blocks, ctx);
  assert(r.ops.length > 0, "expected rebalancing moves");
  assert(r.ops.every((o) => o.kind === "move"), "rebalance uses move ops only");
  assert(r.quality_after >= r.quality_before, "must never regress");
  // Verify the ops actually reduce Mon's load when applied.
  const { candidate } = applyOpsToBlocks(blocks, r.ops, ctx);
  const monLoad = candidate.filter((b) => b.specialist_id === "pe" && b.day_of_week === "Mon").length;
  assert(monLoad < 3, `Mon load should drop below 3, got ${monLoad}`);
});

// ─── conflictFixOptions ──────────────────────────────────────────────────────
Deno.test("fix_conflicts preview: ranked legal move options that clear the conflict; never applies", () => {
  seq = 0;
  const blocks: EditBlock[] = [
    blk({ day_of_week: "Mon", start_time: "09:00:00", end_time: "09:45:00", teacher_id: "t1", grade: "1" }),
    // Same specialist, same time, different grade/teacher → genuine double-book.
    blk({ day_of_week: "Mon", start_time: "09:00:00", end_time: "09:45:00", teacher_id: "t2", grade: "2" }),
  ];
  const r = conflictFixOptions(undefined, blocks, ctx);
  assert(r.conflicts_found > 0, "expected a detected conflict");
  assert(r.options.length > 0, "expected legal fix options");
  assert(r.options.every((o) => o.blast_radius >= 1), "measured blast radius present");
  // Applying the top option's ops clears the double-book (0 new errors, delta ≥ 0).
  const p = previewOps(r.options[0].ops, blocks, ctx);
  assertEquals(p.all_legal, true);
  const after = conflictFixOptions(undefined, p.candidateBlocks, ctx);
  assertEquals(after.conflicts_found, 0, "top option must clear the conflict");
});

// ─── qualityReport + diffToOps ───────────────────────────────────────────────
Deno.test("quality report: plain-language issues match the breakdown", () => {
  const blocks = cleanBlocks();
  blocks.push(blk({ day_of_week: "Mon", start_time: "11:00:00", end_time: "11:45:00", subject: "Art", specialist_id: "art", teacher_id: "t1", grade: "1" }));
  const r = qualityReport(blocks, ctx);
  assert(r.percent >= 0 && r.percent <= 100);
  assert(r.issues.some((i) => i.key === "subject_day_clustering"), "clustering issue expected");
  assert(r.issues.some((i) => i.key === "class_repeats"), "repeat issue expected (t1 sees Art twice)");
  assert(r.issues.every((i) => i.label.length > 0));
});

Deno.test("diffToOps: time change → move; specialist change → delete+insert", () => {
  const before = cleanBlocks();
  const after = before.map((b) => ({ ...b }));
  after[0] = { ...after[0], day_of_week: "Fri", start_time: "10:00:00", end_time: "10:45:00" };
  after[1] = { ...after[1], specialist_id: "pe", subject: "PE" };
  const ops = diffToOps(before, after, ctx);
  assertEquals(ops.filter((o) => o.kind === "move").length, 1);
  assertEquals(ops.filter((o) => o.kind === "delete").length, 1);
  assertEquals(ops.filter((o) => o.kind === "insert").length, 1);
  const mv = ops.find((o) => o.kind === "move") as any;
  assert(mv.label.includes("Mon 09:00") && mv.label.includes("Fri 10:00"), mv.label);
});
