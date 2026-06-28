import { describe, it, expect } from "vitest";
import { diffSchedules, diffSummary, type DiffBlock } from "./scheduleDiff";

const blk = (over: Partial<DiffBlock>): DiffBlock => ({
  id: Math.random().toString(36).slice(2),
  day_of_week: "Mon", start_time: "09:00", end_time: "09:45",
  subject: "PE", grade: "1", specialist_id: "s1", teacher_id: "t1", week_label: null,
  ...over,
});

describe("diffSchedules", () => {
  it("reports identical schedules as unchanged", () => {
    const a = [blk({ id: "a" }), blk({ id: "b", teacher_id: "t2", start_time: "10:00", end_time: "10:45" })];
    const d = diffSchedules(a, a);
    expect(d.identical).toBe(true);
    expect(d.moved).toBe(0);
    expect(d.unchanged).toBe(2);
  });

  it("counts a single moved session and returns its next id (highlight set)", () => {
    const prev = [blk({ id: "p1" }), blk({ id: "p2", teacher_id: "t2" })];
    // Same sessions, but the first one moved to Wed.
    const next = [blk({ id: "n1", day_of_week: "Wed", start_time: "11:00", end_time: "11:45" }), blk({ id: "n2", teacher_id: "t2" })];
    const d = diffSchedules(prev, next);
    expect(d.moved).toBe(1);
    expect(d.movedIds).toEqual(["n1"]);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.unchanged).toBe(1);
  });

  it("treats a moved session as moved, not removed+added", () => {
    const prev = [blk({ id: "p", day_of_week: "Mon" })];
    const next = [blk({ id: "n", day_of_week: "Fri" })];
    const d = diffSchedules(prev, next);
    expect(d).toMatchObject({ moved: 1, added: 0, removed: 0 });
  });

  it("detects adds and removes by identity", () => {
    const prev = [blk({ id: "p", teacher_id: "t1" })];
    const next = [blk({ id: "n", teacher_id: "t2" })]; // different class → remove t1, add t2
    const d = diffSchedules(prev, next);
    expect(d).toMatchObject({ moved: 0, added: 1, removed: 1 });
  });

  it("matches duplicate identities greedily by slot (unchanged dup not miscounted)", () => {
    // A class sees the same specialist twice; one stays, one moves.
    const prev = [
      blk({ id: "p1", day_of_week: "Mon", start_time: "09:00" }),
      blk({ id: "p2", day_of_week: "Thu", start_time: "13:00", end_time: "13:45" }),
    ];
    const next = [
      blk({ id: "n1", day_of_week: "Mon", start_time: "09:00" }), // unchanged
      blk({ id: "n2", day_of_week: "Fri", start_time: "13:00", end_time: "13:45" }), // moved Thu→Fri
    ];
    const d = diffSchedules(prev, next);
    expect(d.unchanged).toBe(1);
    expect(d.moved).toBe(1);
    expect(d.movedIds).toEqual(["n2"]);
  });

  it("summarizes minimal perturbation in plain language", () => {
    expect(diffSummary({ movedIds: ["x"], moved: 1, added: 0, removed: 0, unchanged: 50, identical: false }))
      .toBe("Only 1 class moved — the rest of your week is unchanged.");
    expect(diffSummary({ movedIds: [], moved: 0, added: 0, removed: 0, unchanged: 5, identical: true }))
      .toBe("Nothing changed.");
    expect(diffSummary({ movedIds: ["x", "y"], moved: 2, added: 1, removed: 0, unchanged: 5, identical: false }))
      .toBe("2 classes moved · 1 added");
  });
});
