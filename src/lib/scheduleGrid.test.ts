import { describe, it, expect } from "vitest";
import { buildTimeSlots, buildRecessBands, friendlyBandLabel, computeAutoFit, computeConflictIds, swapPlacements, minToHMS } from "./scheduleGrid";
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

describe("buildRecessBands", () => {
  it("merges rows sharing the same kind + window into ONE band (no ×17 spam)", () => {
    const rows = Array.from({ length: 17 }, (_, i) => ({
      id: `r${i}`, grade_band: "all", am_recess_start: "09:30", am_recess_end: "09:45",
    }));
    const bands = buildRecessBands(rows);
    expect(bands).toHaveLength(1);
    expect(bands[0].label).toBe("AM Recess");
  });

  it("joins distinct group labels on a merged band", () => {
    const rows = [
      { id: "a", grade_band: "primary", am_recess_start: "09:30", am_recess_end: "09:45" },
      { id: "b", grade_band: "intermediate", am_recess_start: "09:30", am_recess_end: "09:45" },
    ];
    const bands = buildRecessBands(rows, { primary: "Primary (1, 2, 3)", intermediate: "Intermediate (4, 5)" });
    expect(bands).toHaveLength(1);
    expect(bands[0].label).toBe("AM Recess · Primary (1, 2, 3) & Intermediate (4, 5)");
  });

  it("keeps DIFFERENT windows as separate bands (staggered schedules)", () => {
    const rows = [
      { id: "a", grade_band: "k2", am_recess_start: "09:30", am_recess_end: "09:45", lunch_start: "11:00", lunch_end: "11:30" },
      { id: "b", grade_band: "35", am_recess_start: "10:00", am_recess_end: "10:15", lunch_start: "11:40", lunch_end: "12:10" },
    ];
    const bands = buildRecessBands(rows, { k2: "K–2", 35: "3–5" });
    expect(bands).toHaveLength(4);
    expect(bands.map((b) => b.label).sort()).toEqual([
      "AM Recess · 3–5", "AM Recess · K–2", "Lunch · 3–5", "Lunch · K–2",
    ]);
  });

  it("never leaks a raw band_xxxxxx key", () => {
    const rows = [{ id: "a", grade_band: "band_o3re5m", am_recess_start: "09:30", am_recess_end: "09:45" }];
    const bands = buildRecessBands(rows); // no label map at all
    expect(bands[0].label).toBe("AM Recess");
  });
});

describe("friendlyBandLabel", () => {
  it("prefers the custom wizard label", () => {
    expect(friendlyBandLabel("band_o3re5m", { band_o3re5m: "K–2" })).toBe("K–2");
  });
  it("hides opaque auto keys without a label", () => {
    expect(friendlyBandLabel("band_xgvk5p", {})).toBe("");
    expect(friendlyBandLabel("band_xgvk5p", null)).toBe("");
  });
  it("blank / 'all' → empty", () => {
    expect(friendlyBandLabel("all")).toBe("");
    expect(friendlyBandLabel("")).toBe("");
    expect(friendlyBandLabel(null)).toBe("");
  });
  it("readable keys pass through capitalized", () => {
    expect(friendlyBandLabel("primary")).toBe("Primary");
    expect(friendlyBandLabel("K-2")).toBe("K-2");
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

