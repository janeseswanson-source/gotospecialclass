import { describe, it, expect } from "vitest";
import { mapJobProgress, progressLabel, type JobRowLite } from "./genJobProgress";

const job = (over: Partial<JobRowLite>): JobRowLite => ({ status: "running", ...over });

describe("mapJobProgress", () => {
  it("empty progress → cpsat phase with safe defaults", () => {
    expect(mapJobProgress(job({ progress: {} }))).toEqual({
      phase: "cpsat", attempt: 0, attempts: 1, currentQuality: 0, bestQuality: 0, elapsedMs: 0, fallbackUsed: false,
    });
  });

  it("null progress is tolerated", () => {
    expect(mapJobProgress(job({ progress: null })).phase).toBe("cpsat");
  });

  it("passes through cpsat progress", () => {
    const p = mapJobProgress(job({ progress: { phase: "cpsat", attempt: 1, attempts: 1, bestQuality: 92, currentQuality: 92, elapsedMs: 1500 } }));
    expect(p).toMatchObject({ phase: "cpsat", bestQuality: 92, elapsedMs: 1500 });
  });

  it("maps search + refine phases", () => {
    expect(mapJobProgress(job({ progress: { phase: "search", attempt: 2, attempts: 3, bestQuality: 80 } })).phase).toBe("search");
    expect(mapJobProgress(job({ progress: { phase: "refine", attempt: 4, bestQuality: 95 } })).phase).toBe("refine");
  });

  it("coerces an unknown/removed phase (e.g. legacy 'polish') to cpsat", () => {
    expect(mapJobProgress(job({ progress: { phase: "polish" } })).phase).toBe("cpsat");
    expect(mapJobProgress(job({ progress: { phase: 123 as unknown } })).phase).toBe("cpsat");
  });

  it("coerces non-numeric progress values to defaults", () => {
    const p = mapJobProgress(job({ progress: { bestQuality: "oops", attempt: null, attempts: undefined } }));
    expect(p.bestQuality).toBe(0);
    expect(p.attempt).toBe(0);
    expect(p.attempts).toBe(1);
  });

  it("surfaces fallback_used from the row (not progress)", () => {
    expect(mapJobProgress(job({ progress: { phase: "search" }, fallback_used: true })).fallbackUsed).toBe(true);
    expect(mapJobProgress(job({ progress: { phase: "search" }, fallback_used: false })).fallbackUsed).toBe(false);
  });
});

describe("progressLabel", () => {
  it("labels each phase and marks fallback", () => {
    expect(progressLabel({ phase: "cpsat", attempt: 1, attempts: 1, currentQuality: 0, bestQuality: 92, elapsedMs: 0, fallbackUsed: false }))
      .toContain("provably-optimal");
    expect(progressLabel({ phase: "search", attempt: 2, attempts: 3, currentQuality: 0, bestQuality: 80, elapsedMs: 0, fallbackUsed: true }))
      .toContain("(fallback engine)");
    expect(progressLabel({ phase: "refine", attempt: 4, attempts: 5, currentQuality: 0, bestQuality: 95, elapsedMs: 0, fallbackUsed: false }))
      .toContain("Improving");
  });

  it("shows the % when a real quality exists", () => {
    expect(progressLabel({ phase: "cpsat", attempt: 1, attempts: 1, currentQuality: 92, bestQuality: 92, elapsedMs: 0, fallbackUsed: false }))
      .toContain("92%");
    expect(progressLabel({ phase: "search", attempt: 2, attempts: 3, currentQuality: 0, bestQuality: 80, elapsedMs: 0, fallbackUsed: false }))
      .toContain("best 80%");
  });

  it("omits a meaningless 0% / attempt 0 while nothing has landed yet", () => {
    const solving = progressLabel({ phase: "cpsat", attempt: 0, attempts: 1, currentQuality: 0, bestQuality: 0, elapsedMs: 0, fallbackUsed: false });
    expect(solving).not.toContain("0%");
    const searching = progressLabel({ phase: "search", attempt: 0, attempts: 3, currentQuality: 0, bestQuality: 0, elapsedMs: 0, fallbackUsed: true });
    expect(searching).not.toContain("0%");
    expect(searching).not.toContain("attempt 0");
    expect(searching).toContain("(fallback engine)");
  });
});
