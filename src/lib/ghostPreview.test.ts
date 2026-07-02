import { describe, it, expect } from "vitest";
import { buildGhostOverlay, toggleRejected, acceptedOps, opBeforeAfter, type PreviewOp, type ProposalItem } from "./ghostPreview";
import type { BlockData } from "@/components/schedule/ScheduleGrid";

const blocks: BlockData[] = [
  { id: "b1", day_of_week: "Mon", start_time: "09:00:00", end_time: "09:45:00", subject: "PE", grade: "1", specialist_name: "Coach P", teacher_name: "Smith", specialist_id: "pe", teacher_id: "t1" },
  { id: "b2", day_of_week: "Tue", start_time: "10:00:00", end_time: "10:45:00", subject: "Art", grade: "2", specialist_name: "Ms A", teacher_name: "Jones", specialist_id: "art", teacher_id: "t2" },
];

describe("buildGhostOverlay", () => {
  it("empty ops → empty overlay", () => {
    const o = buildGhostOverlay(blocks, []);
    expect(o.ghostBlocks).toHaveLength(0);
    expect(o.originIds.size).toBe(0);
    expect(o.deletedIds.size).toBe(0);
  });

  it("move → dashed ghost at destination + faded origin", () => {
    const op: PreviewOp = { kind: "move", block_id: "b1", day_of_week: "Wed", start_time: "11:00:00", end_time: "11:45:00" };
    const o = buildGhostOverlay(blocks, [op]);
    expect(o.originIds.has("b1")).toBe(true);
    expect(o.ghostBlocks).toHaveLength(1);
    const g = o.ghostBlocks[0];
    expect(o.ghostIds.has(g.id)).toBe(true);
    expect(g.day_of_week).toBe("Wed");
    expect(g.start_time).toBe("11:00:00");
    // Ghost carries the source block's identity so the cell reads correctly.
    expect(g.subject).toBe("PE");
    expect(g.teacher_name).toBe("Smith");
  });

  it("swap → two ghosts at exchanged slots + both origins faded", () => {
    const op: PreviewOp = {
      kind: "swap", a_id: "b1", a_day: "Tue", a_start: "10:00:00", a_end: "10:45:00",
      b_id: "b2", b_day: "Mon", b_start: "09:00:00", b_end: "09:45:00",
    };
    const o = buildGhostOverlay(blocks, [op]);
    expect(o.originIds).toEqual(new Set(["b1", "b2"]));
    expect(o.ghostBlocks).toHaveLength(2);
    expect(o.ghostBlocks[0].subject).toBe("PE");
    expect(o.ghostBlocks[0].day_of_week).toBe("Tue");
    expect(o.ghostBlocks[1].subject).toBe("Art");
    expect(o.ghostBlocks[1].day_of_week).toBe("Mon");
  });

  it("delete → struck-through (no ghost); insert → ghost with resolved names", () => {
    const del: PreviewOp = { kind: "delete", block_id: "b2" };
    const ins: PreviewOp = {
      kind: "insert", day_of_week: "Fri", start_time: "13:00:00", end_time: "13:45:00",
      subject: "Music", specialist_id: "mus", teacher_id: "t1", grade: "1", room: null, week_label: null,
    };
    const o = buildGhostOverlay(blocks, [del, ins], {
      specialistName: (id) => (id === "mus" ? "Mr M" : null),
      teacherName: (id) => (id === "t1" ? "Smith" : null),
    });
    expect(o.deletedIds.has("b2")).toBe(true);
    expect(o.ghostBlocks).toHaveLength(1);
    expect(o.ghostBlocks[0].subject).toBe("Music");
    expect(o.ghostBlocks[0].specialist_name).toBe("Mr M");
    expect(o.ghostBlocks[0].teacher_name).toBe("Smith");
  });

  it("move of an unknown block id is ignored (stale proposal safety)", () => {
    const op: PreviewOp = { kind: "move", block_id: "gone", day_of_week: "Wed", start_time: "11:00:00", end_time: "11:45:00" };
    const o = buildGhostOverlay(blocks, [op]);
    expect(o.ghostBlocks).toHaveLength(0);
    expect(o.originIds.size).toBe(0);
  });
});

describe("apply-bar selection", () => {
  const items: ProposalItem[] = [
    { id: "c1:0", op: { kind: "delete", block_id: "b1" } },
    { id: "c1:1", op: { kind: "move", block_id: "b2", day_of_week: "Wed", start_time: "09:00:00", end_time: "09:45:00" } },
    { id: "c2:0", op: { kind: "delete", block_id: "b2" } },
  ];

  it("toggleRejected is immutable and reversible", () => {
    const s0 = new Set<string>();
    const s1 = toggleRejected(s0, "c1:0");
    expect(s0.size).toBe(0);
    expect(s1.has("c1:0")).toBe(true);
    const s2 = toggleRejected(s1, "c1:0");
    expect(s2.has("c1:0")).toBe(false);
  });

  it("acceptedOps excludes rejected items and preserves order", () => {
    const rejected = new Set(["c1:1"]);
    const ops = acceptedOps(items, rejected);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual(items[0].op);
    expect(ops[1]).toEqual(items[2].op);
  });

  it("all rejected → nothing to apply", () => {
    const rejected = new Set(items.map((i) => i.id));
    expect(acceptedOps(items, rejected)).toHaveLength(0);
  });
});

describe("opBeforeAfter", () => {
  it("renders compact before→after lines", () => {
    const mv: PreviewOp = { kind: "move", block_id: "b1", day_of_week: "Wed", start_time: "11:00:00", end_time: "11:45:00" };
    expect(opBeforeAfter(mv, blocks)).toContain("Mon 09:00");
    expect(opBeforeAfter(mv, blocks)).toContain("Wed 11:00");
    const del: PreviewOp = { kind: "delete", block_id: "b2" };
    expect(opBeforeAfter(del, blocks)).toContain("Removed Art");
  });
});
