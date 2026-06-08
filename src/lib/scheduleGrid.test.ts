import { describe, it, expect } from "vitest";
import { buildTimeSlots, computeAutoFit, computeConflictIds } from "./scheduleGrid";
import type { BlockData } from "@/components/schedule/ScheduleGrid";

const mkBlock = (over: Partial<BlockData>): BlockData => ({
  id: "x", day_of_week: "Mon", start_time: "08:00", end_time: "08:45",
  subject: "Art", specialist_name: "A", teacher_name: "T1", grade: "K", ...over,
});

describe("buildTimeSlots", () => {
  it("spans school start to end on a 5-min grid", () => {
    const slots = buildTimeSlots("08:00", "10:00", []);
    expect(slots[0]).toBe("08:00");
    expect(slots[slots.length - 1]).toBe("10:00");
    expect(slots.length).toBe(25);
  });
  it("extends to include off-grid blocks", () => {
    const slots = buildTimeSlots("08:00", "09:00", [mkBlock({ start_time: "07:45", end_time: "08:30" })]);
    expect(slots.includes("07:45")).toBe(true);
  });
});

describe("computeConflictIds", () => {
  it("flags same specialist overlapping same week", () => {
    const blocks = [
      mkBlock({ id: "a", start_time: "08:00", end_time: "08:45" }),
      mkBlock({ id: "b", start_time: "08:30", end_time: "09:15" }),
    ];
    const ids = computeConflictIds(blocks);
    expect(ids.has("a") && ids.has("b")).toBe(true);
  });
  it("allows A/B week overlap", () => {
    const blocks = [
      mkBlock({ id: "a", start_time: "08:00", end_time: "08:45", week_label: "A" }),
      mkBlock({ id: "b", start_time: "08:00", end_time: "08:45", week_label: "B" }),
    ];
    expect(computeConflictIds(blocks).size).toBe(0);
  });
});

describe("computeAutoFit", () => {
  const moving = mkBlock({ id: "m", start_time: "08:00", end_time: "08:45" });
  it("keeps full duration when slot is free", () => {
    const r = computeAutoFit({ movingBlock: moving, targetDay: "Tue", targetTime: "09:00", allBlocks: [moving], recessBands: [], schoolEnd: "15:00" });
    expect(r.ok).toBe(true);
    expect(r.end).toBe("09:45");
    expect(r.shortened).toBe(false);
  });
  it("shrinks duration to fit before next block", () => {
    const next = mkBlock({ id: "n", day_of_week: "Tue", start_time: "09:30", end_time: "10:15" });
    const r = computeAutoFit({ movingBlock: moving, targetDay: "Tue", targetTime: "09:00", allBlocks: [moving, next], recessBands: [], schoolEnd: "15:00" });
    expect(r.ok).toBe(true);
    expect(r.duration).toBe(30);
    expect(r.shortened).toBe(true);
  });
  it("rejects drops that overlap an existing block", () => {
    const other = mkBlock({ id: "o", day_of_week: "Tue", start_time: "08:55", end_time: "09:40" });
    const r = computeAutoFit({ movingBlock: moving, targetDay: "Tue", targetTime: "09:00", allBlocks: [moving, other], recessBands: [], schoolEnd: "15:00" });
    expect(r.ok).toBe(false);
  });
  it("rejects drops that hit a recess band", () => {
    const r = computeAutoFit({
      movingBlock: moving, targetDay: "Tue", targetTime: "09:00",
      allBlocks: [moving],
      recessBands: [{ id: "r", label: "Recess", start_time: "09:10", end_time: "09:25" }],
      schoolEnd: "15:00",
    });
    expect(r.ok).toBe(false); // 10 min < 20 min minimum
  });
});

