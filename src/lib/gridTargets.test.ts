import { describe, it, expect } from "vitest";
import { evaluateDrop, legalTargets, occupantAt, placementProblem } from "./gridTargets";
import type { BlockData, RecessBand } from "@/components/schedule/ScheduleGrid";

// Minimal block factory.
const blk = (o: Partial<BlockData> & { id: string }): BlockData => ({
  day_of_week: "Mon",
  start_time: "09:00:00",
  end_time: "09:45:00",
  ...o,
});

const RECESS: RecessBand[] = [{ id: "am", label: "AM Recess", start_time: "10:00:00", end_time: "10:15:00" }];
const CONSTRAINTS = { recessBands: RECESS, schoolStart: "08:00:00", schoolEnd: "15:00:00" };

// A shares specialist S1 with H; B is an unrelated swap partner.
const A = blk({ id: "A", day_of_week: "Mon", start_time: "09:00:00", end_time: "09:45:00", specialist_id: "S1", teacher_id: "T1", subject: "Art", grade: "3" });
const B = blk({ id: "B", day_of_week: "Mon", start_time: "11:00:00", end_time: "11:30:00", specialist_id: "S2", teacher_id: "T2", subject: "Music", grade: "4" });
const H = blk({ id: "H", day_of_week: "Mon", start_time: "11:35:00", end_time: "12:20:00", specialist_id: "S1", teacher_id: "T3", subject: "PE", grade: "5" });

describe("occupantAt", () => {
  it("finds the block covering a slot, ignoring the moving block itself", () => {
    expect(occupantAt(A, [A, B], "Mon", "11:00:00")?.id).toBe("B");
    expect(occupantAt(A, [A, B], "Mon", "13:00:00")).toBeNull();
    expect(occupantAt(A, [A, B], "Mon", "09:00:00")).toBeNull(); // A itself doesn't count
  });

  it("respects week labels — a different-week block does not occupy the slot", () => {
    const aWeek = blk({ id: "A", week_label: "A", day_of_week: "Mon", start_time: "09:00:00", end_time: "09:45:00" });
    const bWeek = blk({ id: "Bb", week_label: "B", day_of_week: "Mon", start_time: "09:00:00", end_time: "09:45:00" });
    expect(occupantAt(aWeek, [aWeek, bWeek], "Mon", "09:15:00")).toBeNull();
  });
});

describe("evaluateDrop — moves", () => {
  it("a free slot on another day is a legal move", () => {
    const r = evaluateDrop({ block: A, allBlocks: [A, B, H], targetDay: "Tue", targetTime: "09:00:00", ...CONSTRAINTS });
    expect(r).toMatchObject({ kind: "move", legal: true });
    expect(r.changes).toEqual([{ id: "A", day_of_week: "Tue", start_time: "09:00", end_time: "09:45", is_override: true }]);
  });

  it("the block's own slot is a no-op (self)", () => {
    const r = evaluateDrop({ block: A, allBlocks: [A, B, H], targetDay: "Mon", targetTime: "09:00:00", ...CONSTRAINTS });
    expect(r.kind).toBe("self");
    expect(r.legal).toBe(false);
  });

  it("landing where too little room remains before recess is illegal", () => {
    const r = evaluateDrop({ block: A, allBlocks: [A], targetDay: "Mon", targetTime: "09:50:00", ...CONSTRAINTS });
    expect(r.legal).toBe(false);
    expect(r.reason).toMatch(/min available|occupied/i);
  });

  it("shortens a move to fit the gap before the day ends", () => {
    const r = evaluateDrop({ block: A, allBlocks: [A], targetDay: "Mon", targetTime: "14:30:00", ...CONSTRAINTS });
    expect(r).toMatchObject({ kind: "move", legal: true, shortened: true });
    expect(r.changes?.[0].end_time).toBe("15:00");
  });

  it("a locked block cannot move", () => {
    const r = evaluateDrop({ block: A, allBlocks: [A, B], targetDay: "Tue", targetTime: "09:00:00", lockedIds: new Set(["A"]), ...CONSTRAINTS });
    expect(r).toMatchObject({ kind: "locked", legal: false });
  });
});

describe("evaluateDrop — swaps", () => {
  it("swaps onto an occupied slot when nothing else clashes", () => {
    const r = evaluateDrop({ block: A, allBlocks: [A, B], targetDay: "Mon", targetTime: "11:00:00", ...CONSTRAINTS });
    expect(r).toMatchObject({ kind: "swap", legal: true });
    // A takes B's start with A's 45-min length; B takes A's start with its 30-min length.
    expect(r.changes).toEqual([
      { id: "A", day_of_week: "Mon", start_time: "11:00:00", end_time: "11:45:00", is_override: true },
      { id: "B", day_of_week: "Mon", start_time: "09:00:00", end_time: "09:30:00", is_override: true },
    ]);
  });

  it("rejects a swap that would overlap a third same-specialist block", () => {
    // Swapping A onto B pushes A to 11:00–11:45, which overlaps H (S1) at 11:35.
    const r = evaluateDrop({ block: A, allBlocks: [A, B, H], targetDay: "Mon", targetTime: "11:00:00", ...CONSTRAINTS });
    expect(r.kind).toBe("swap");
    expect(r.legal).toBe(false);
    expect(r.reason).toMatch(/clash/i);
  });

  it("cannot swap with a locked block", () => {
    const r = evaluateDrop({ block: A, allBlocks: [A, B], targetDay: "Mon", targetTime: "11:00:00", lockedIds: new Set(["B"]), ...CONSTRAINTS });
    expect(r).toMatchObject({ kind: "swap", legal: false });
    expect(r.reason).toMatch(/locked/i);
  });
});

describe("placementProblem", () => {
  it("flags recess collisions", () => {
    const onRecess = blk({ id: "A", start_time: "10:00:00", end_time: "10:45:00" });
    expect(placementProblem([onRecess], ["A"], CONSTRAINTS)).toMatch(/recess or lunch/i);
  });
  it("passes a clean placement", () => {
    expect(placementProblem([A, B], ["A"], CONSTRAINTS)).toBeNull();
  });
});

describe("legalTargets", () => {
  it("evaluates every (day, slot) once, keyed by `day-time`", () => {
    const map = legalTargets({
      block: A,
      allBlocks: [A, B],
      days: ["Mon", "Tue"],
      timeSlots: ["09:00:00", "11:00:00"],
      ...CONSTRAINTS,
    });
    expect(map.size).toBe(4);
    expect(map.get("Mon-09:00:00")?.kind).toBe("self");
    expect(map.get("Tue-09:00:00")?.legal).toBe(true); // free move
    expect(map.get("Mon-11:00:00")?.kind).toBe("swap"); // occupied by B
    expect(map.get("Tue-11:00:00")?.legal).toBe(true); // free move
  });
});
