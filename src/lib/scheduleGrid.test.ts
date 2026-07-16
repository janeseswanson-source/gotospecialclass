import { describe, it, expect } from "vitest";
import { buildTimeSlots, buildRecessBands, buildSpecialistBands, friendlyBandLabel, bandLabelMapFromStored, sanitizeBandLabel, isSpecialistLunchBlock, computeAutoFit, computeConflictIds, swapPlacements, minToHMS } from "./scheduleGrid";
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
  it("sanitizes garbage MAP values (label = raw key, or label = another band_ key)", () => {
    // Older wizard versions saved the raw key AS the label — must never print.
    expect(friendlyBandLabel("band_o3re5m", { band_o3re5m: "band_o3re5m" })).toBe("");
    expect(friendlyBandLabel("band_o3re5m", { band_o3re5m: "band_zzz999" })).toBe("");
    // A readable key whose map value just echoes the key falls back to capitalization.
    expect(friendlyBandLabel("primary", { primary: "primary" })).toBe("Primary");
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

describe("bandLabelMapFromStored", () => {
  it("converts the stored array to a key→label map, skipping garbage", () => {
    const map = bandLabelMapFromStored([
      { key: "kindergarten", label: "Kindergarten", grades: ["K"] },
      { key: "band_o3re5m", label: "band_o3re5m", grades: ["1", "2"] }, // label==key garbage
      { key: "band_xgvk5p", label: "3–5", grades: ["3", "4", "5"] },     // real label survives
      { key: "", label: "orphan" },
      { key: "nolabel", label: "" },
    ]);
    expect(map).toEqual({ kindergarten: "Kindergarten", band_xgvk5p: "3–5" });
  });
  it("non-array input (the old broken cast scenario) → empty map", () => {
    expect(bandLabelMapFromStored({ band_x: "K–2" })).toEqual({});
    expect(bandLabelMapFromStored(null)).toEqual({});
    expect(bandLabelMapFromStored(undefined)).toEqual({});
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

describe("sanitizeBandLabel", () => {
  const MONSTER = "AM Recess · AM Recess · AM Recess · AM Recess · AM Recess · AM Recess · AM Recess · band_o3re5m";

  it("reduces a compound amplified label to nothing", () => {
    expect(sanitizeBandLabel(MONSTER, "band_o3re5m")).toBe("");
    expect(sanitizeBandLabel("Lunch · Lunch · Lunch · band_xgvk5p", "band_xgvk5p")).toBe("");
  });

  it("extracts the meaningful segment buried in a compound", () => {
    expect(sanitizeBandLabel("AM Recess · K-2", "band_a")).toBe("K-2");
    expect(sanitizeBandLabel("Lunch · Lunch · Primary · band_b", "band_b")).toBe("Primary");
  });

  it("splits on middots without surrounding spaces", () => {
    expect(sanitizeBandLabel("AM Recess·K-2")).toBe("K-2");
  });

  it("drops only EXACT period-generic names — real names survive", () => {
    expect(sanitizeBandLabel("Lunch")).toBe("");
    expect(sanitizeBandLabel("Recess")).toBe("");
    expect(sanitizeBandLabel("PM Recess (group 2)")).toBe("");
    expect(sanitizeBandLabel("Lunch Bunch")).toBe("Lunch Bunch");
    expect(sanitizeBandLabel("Early Lunch")).toBe("Early Lunch");
    expect(sanitizeBandLabel("Recess Heroes")).toBe("Recess Heroes");
  });

  it("drops exact key echoes and bare band_ keys, keeps case-variant customs", () => {
    expect(sanitizeBandLabel("primary", "primary")).toBe("");
    expect(sanitizeBandLabel("band_abc123")).toBe("");
    // Long-standing behavior: "Kindergarten" IS a custom label for key "kindergarten".
    expect(sanitizeBandLabel("Kindergarten", "kindergarten")).toBe("Kindergarten");
  });

  it("dedupes segments case-insensitively, keeping first casing", () => {
    expect(sanitizeBandLabel("K-2 · k-2 · K-2")).toBe("K-2");
  });

  it("handles null/empty", () => {
    expect(sanitizeBandLabel(null)).toBe("");
    expect(sanitizeBandLabel(undefined)).toBe("");
    expect(sanitizeBandLabel("   ")).toBe("");
  });
});

describe("compound-garbage integration (KK3 shape)", () => {
  const MONSTER = "AM Recess · AM Recess · AM Recess · band_o3re5m";

  it("friendlyBandLabel ignores a compound map value", () => {
    expect(friendlyBandLabel("band_o3re5m", { band_o3re5m: MONSTER })).toBe("");
    expect(friendlyBandLabel("band_a", { band_a: "AM Recess · K-2" })).toBe("K-2");
  });

  it("bandLabelMapFromStored sanitizes stored labels and skips hollow ones", () => {
    const map = bandLabelMapFromStored([
      { key: "band_o3re5m", label: MONSTER, grades: ["K"] },
      { key: "band_b", label: "Lunch · 3-5", grades: ["3", "4", "5"] },
    ]);
    expect(map.band_o3re5m).toBeUndefined();
    expect(map.band_b).toBe("3-5");
  });

  it("buildRecessBands collapses the KK3 all+band_ rows into ONE clean band", () => {
    const rows = [
      { id: "r1", grade_band: "all", am_recess_start: "10:00", am_recess_end: "10:15" },
      { id: "r2", grade_band: "band_o3re5m", am_recess_start: "10:00", am_recess_end: "10:15" },
    ];
    const bands = buildRecessBands(rows, { band_o3re5m: MONSTER });
    expect(bands).toHaveLength(1);
    expect(bands[0].label).toBe("AM Recess");
  });
});

describe("buildSpecialistBands", () => {
  const row = (over: Record<string, unknown>) => ({
    id: "r1", grade_band: "all",
    am_recess_start: null, am_recess_end: null,
    lunch_start: null, lunch_end: null,
    pm_recess_start: null, pm_recess_end: null,
    ...over,
  }) as never;

  it("merges same-window rows into one clean band (KK3 shape)", () => {
    const rows = [
      row({ id: "r1", grade_band: "all", am_recess_start: "10:00", am_recess_end: "10:15" }),
      row({ id: "r2", grade_band: "band_o3re5m", am_recess_start: "10:00", am_recess_end: "10:15" }),
    ];
    const defs = [{ key: "band_o3re5m", label: "AM Recess · AM Recess · band_o3re5m", grades: ["K", "1"] }];
    const bands = buildSpecialistBands(["K"], rows, defs);
    expect(bands).toHaveLength(1);
    expect(bands[0].label).toBe("AM Recess");
    expect(bands[0].kind).toBe("AM Recess");
  });

  it("filters out a resolvable band the specialist does not serve", () => {
    const rows = [row({ id: "r1", grade_band: "band_35", am_recess_start: "10:00", am_recess_end: "10:15" })];
    const defs = [{ key: "band_35", label: "3-5", grades: ["3", "4", "5"] }];
    expect(buildSpecialistBands(["K", "1"], rows, defs)).toHaveLength(0);
    expect(buildSpecialistBands(["3"], rows, defs)).toHaveLength(1);
  });

  it("keeps an unresolvable opaque band visible (never silently vanish)", () => {
    const rows = [row({ id: "r1", grade_band: "band_zzz", lunch_start: "11:40", lunch_end: "12:10" })];
    const bands = buildSpecialistBands(["K"], rows, []);
    expect(bands).toHaveLength(1);
    expect(bands[0].kind).toBe("Lunch");
    expect(bands[0].label).toBe("Lunch");
  });
});

describe("isSpecialistLunchBlock", () => {
  it("matches the generator's duty-free lunch exactly", () => {
    expect(isSpecialistLunchBlock({ grade: "Lunch", subject: "Specialist Lunch" })).toBe(true);
    expect(isSpecialistLunchBlock({ grade: "Lunch", subject: null })).toBe(true);
    expect(isSpecialistLunchBlock({ grade: null, subject: "Specialist Lunch" })).toBe(true);
  });
  it("never matches Lunch Club teaching blocks", () => {
    expect(isSpecialistLunchBlock({ grade: "3", subject: "Doodle Lunch Club" })).toBe(false);
    expect(isSpecialistLunchBlock({ grade: "All", subject: "Lunch Club" })).toBe(false);
  });
});

