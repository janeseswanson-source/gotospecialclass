// Phase 3 — deterministic conflict-cascade tests.
//
//   - a forced double-booking yields ranked, legal options ordered by real blast
//     radius (relocate before swap); every option is SSOT-legal and resolves it
//   - the engine is deterministic (pure; same input ⇒ same options)
//   - no_coverage yields legal add_session options
//   - an unresolvable conflict returns a structured escalation (reason +
//     least-bad options), never a crash and never an illegal "fix"

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveConflict, detectConflicts, resolveConflictsDeterministic, type Conflict, type ConflictContext } from "./_conflict.ts";
import { generateScheduleBlocks, type Block } from "./index.ts";
import { buildScenario, countHardViolations } from "./_characterization_fixtures.ts";

const PE = "22222222-2222-4222-a222-222222222222";

function committed() {
  const base = buildScenario("standard");
  const gen = generateScheduleBlocks(
    "00000000-0000-4000-a000-00000000conf",
    base.specialists as never, base.teachers as never, base.grades, base.school, base.recessConfigs,
    [], [], [], [], [],
  );
  // Assign stable ids so a conflict can reference a specific block.
  const blocks: Block[] = (gen.blocks as Block[]).map((b, i) => ({ ...b, id: `b${i}` } as Block));
  const ctx: ConflictContext = {
    specialists: base.specialists as never,
    teachers: (base.teachers as any[]).map((t) => ({ id: t.id, grade: t.grade })),
    grades: base.grades, school: base.school, recessConfigs: base.recessConfigs,
  };
  return { blocks, ctx, base };
}

/** Force a REAL double-booking: move PE block C (a DIFFERENT grade than A, so it
 *  is not a Big-Group combined class) onto PE block A's exact slot. */
function forceDoubleBook(blocks: Block[]) {
  const peBlocks = blocks.filter((b) => b.specialist_id === PE && b.grade !== "Lunch" && b.teacher_id);
  const a = peBlocks[0];
  const c = peBlocks.find((b) => b.grade !== a.grade && (b.day_of_week !== a.day_of_week || b.start_time !== a.start_time))!;
  const conflicted = blocks.map((b) =>
    (b as any).id === (c as any).id
      ? { ...b, day_of_week: a.day_of_week, start_time: a.start_time, end_time: a.end_time }
      : b,
  );
  return { conflicted, offendingId: (c as any).id as string };
}

Deno.test("conflict: forced double-book yields ranked, SSOT-legal relocate options", () => {
  const { blocks, ctx } = committed();
  const { conflicted, offendingId } = forceDoubleBook(blocks);
  const conflict: Conflict = { kind: "double_book", blockId: offendingId };
  const outcome = resolveConflict(conflict, conflicted, ctx);

  assert(outcome.resolved, "should resolve a double-book by relocation");
  assert(outcome.options.length > 0);
  // Ranked by blast radius ascending.
  for (let i = 1; i < outcome.options.length; i++) {
    assert(outcome.options[i].blastRadius >= outcome.options[i - 1].blastRadius, "options must be sorted by blast radius");
  }
  // The smallest-radius option is a relocate with a small, measured radius.
  assertEquals(outcome.options[0].tactic, "relocate");
  assert(outcome.options[0].blastRadius >= 1 && outcome.options[0].blastRadius <= 3);
  // EVERY option is SSOT-legal and actually resolves the conflict.
  for (const opt of outcome.options) {
    assertEquals(countHardViolations(opt.resultBlocks, ctx.school, ctx.recessConfigs), 0, `${opt.tactic} option must be SSOT-legal`);
  }
});

Deno.test("conflict: engine is deterministic (pure)", () => {
  const { blocks, ctx } = committed();
  const { conflicted, offendingId } = forceDoubleBook(blocks);
  const conflict: Conflict = { kind: "double_book", blockId: offendingId };
  const a = resolveConflict(conflict, conflicted, ctx);
  const b = resolveConflict(conflict, conflicted, ctx);
  assertEquals(a.options.map((o) => `${o.tactic}|${o.blastRadius}|${o.description}`), b.options.map((o) => `${o.tactic}|${o.blastRadius}|${o.description}`));
});

Deno.test("conflict: no_coverage yields legal add_session options", () => {
  const { blocks, ctx } = committed();
  // Pick a (grade, specialist, teacher) pair that has no session, by removing one.
  const target = blocks.find((b) => b.specialist_id === PE && b.teacher_id && b.grade !== "Lunch")!;
  const without = blocks.filter((b) => b !== target);
  const conflict: Conflict = { kind: "no_coverage", grade: target.grade, specialistId: PE, teacherId: target.teacher_id! };
  const outcome = resolveConflict(conflict, without, ctx);
  assert(outcome.resolved, "should find a legal slot to add the missing session");
  assertEquals(outcome.options[0].tactic, "add_session");
  for (const opt of outcome.options) {
    assertEquals(countHardViolations(opt.resultBlocks, ctx.school, ctx.recessConfigs), 0);
  }
});

Deno.test("conflict: detectConflicts finds a forced double-book and batch resolver clears it", () => {
  const { blocks, ctx } = committed();
  // Clean schedule has no detected conflicts.
  assertEquals(detectConflicts(blocks, ctx).length, 0);

  const { conflicted } = forceDoubleBook(blocks);
  const detected = detectConflicts(conflicted, ctx);
  assert(detected.length >= 1, "should detect the forced double-book");

  const batch = resolveConflictsDeterministic(conflicted, ctx);
  assert(batch.resolvedCount >= 1);
  // The resolved schedule is SSOT-legal and conflict-free.
  assertEquals(countHardViolations(batch.finalBlocks, ctx.school, ctx.recessConfigs), 0);
  assertEquals(detectConflicts(batch.finalBlocks, ctx).length, 0);
  // Determinism.
  const batch2 = resolveConflictsDeterministic(conflicted, ctx);
  assertEquals(batch.finalBlocks.length, batch2.finalBlocks.length);
  assertEquals(batch.resolvedCount, batch2.resolvedCount);
});

Deno.test("conflict: unresolvable conflict returns a structured escalation (no crash, no illegal fix)", () => {
  // A 1-day, 1-slot school: the specialist's only slot is taken by another
  // class, and there is nowhere legal to relocate or swap → escalate.
  const school = { start_time: "09:00", end_time: "09:45", class_duration: 45, setup_time: 0, passing_time: 0, grade_time_config: {} };
  const recessConfigs: any[] = [];
  const specialists = [{ id: PE, name: "PE", subject: "PE", working_days: ["Mon"], class_duration: 45 } as any];
  const teachers = [{ id: "t1", grade: "1" }, { id: "t2", grade: "2" }];
  const ctx: ConflictContext = { specialists, teachers, grades: ["1", "2"], school, recessConfigs };
  // A grade-1 and a grade-2 class both need PE (DIFFERENT grades, so not a
  // Big-Group combined class), but only one 09:00–09:45 Mon slot exists.
  const blocks: Block[] = [
    { generation_id: "g", id: "x1", day_of_week: "Mon", start_time: "09:00", end_time: "09:45", subject: "PE", specialist_id: PE, teacher_id: "t1", grade: "1", room: null, week_label: null } as any,
    { generation_id: "g", id: "x2", day_of_week: "Mon", start_time: "09:00", end_time: "09:45", subject: "PE", specialist_id: PE, teacher_id: "t2", grade: "2", room: null, week_label: null } as any,
  ];
  const outcome = resolveConflict({ kind: "double_book", blockId: "x2" }, blocks, ctx);
  assertEquals(outcome.resolved, false);
  assert(outcome.escalation, "must escalate");
  assert(outcome.escalation!.reason.length > 0);
  assert(outcome.escalation!.conflictingConstraints.length > 0, "must name the conflicting constraint(s)");
  assertEquals(outcome.options.length, 0, "no illegal options are offered");
});
