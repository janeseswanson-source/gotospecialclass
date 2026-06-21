import { describe, it, expect } from "vitest";
import { buildTimeSlots, computeAutoFit, computeConflictIds, swapPlacements, minToHMS } from "./scheduleGrid";
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

describe("minToHMS", () => {
  it("formats minutes as HH:MM:SS", () => {
    expect(minToHMS(8 * 60 + 30)).toBe("08:30:00");
    expect(minToHMS(0)).toBe("00:00:00");
    expect(minToHMS(13 * 60 + 5)).toBe("13:05:00");
  });
});

describe("swapPlacements", () => {
  const a = mkBlock({ id: "a", day_of_week: "Mon", start_time: "08:00", end_time: "08:45" }); // 45 min
  const b = mkBlock({ id: "b", day_of_week: "Tue", start_time: "10:00", end_time: "11:00" }); // 60 min

  it("exchanges each block's day + start", () => {
    const { a: na, b: nb } = swapPlacements(a, b);
    expect(na.day_of_week).toBe("Tue");
    expect(na.start_time).toBe("10:00:00");
    expect(nb.day_of_week).toBe("Mon");
    expect(nb.start_time).toBe("08:00:00");
  });

  it("preserves each block's OWN duration (does not resize)", () => {
    const { a: na, b: nb } = swapPlacements(a, b);
    expect(na.end_time).toBe("10:45:00"); // a keeps 45 min
    expect(nb.end_time).toBe("09:00:00"); // b keeps 60 min
  });

  it("a clean swap of two non-conflicting blocks introduces no conflict", () => {
    const { a: na, b: nb } = swapPlacements(a, b);
    const after = [{ ...a, ...na }, { ...b, ...nb }];
    expect(computeConflictIds(after).size).toBe(0);
  });

  it("surfaces a conflict when the swap double-books a teacher", () => {
    // c shares a's teacher and sits where a would land after the swap.
    const c = mkBlock({ id: "c", day_of_week: "Tue", start_time: "10:00", end_time: "10:45", teacher_name: "T1", specialist_name: "Z" });
    const { a: na, b: nb } = swapPlacements(a, b);
    const after = [{ ...a, ...na }, { ...b, ...nb }, c];
    const ids = computeConflictIds(after);
    expect(ids.has("a") && ids.has("c")).toBe(true);
  });
});

