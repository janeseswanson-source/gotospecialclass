import { describe, it, expect } from "vitest";
import { scoreSummary, confidenceCopy } from "./scoreSummary";

describe("scoreSummary", () => {
  it("celebrates zero-penalty terms as 'working' and reports rewards", () => {
    const s = scoreSummary({
      full_week_coverage: 600, // 6 grades
      planning_target_met: 150, // 5 specialists
      subject_gap: 0,
      subject_day_clustering: 0,
      class_repeats: 0,
    });
    expect(s.working).toContain("6 grades have specials every day");
    expect(s.working).toContain("5 specialists hit their planning target");
    expect(s.working).toContain("Every grade sees every specialist");
    expect(s.working).toContain("Subjects are well spread across the week");
    expect(s.costs).toEqual([]);
  });

  it("turns active penalties into human costs, worst first", () => {
    const s = scoreSummary({
      class_repeats: -100, // 4 repeats × 25
      subject_day_clustering: -30, // 2 dupes × 15
      day_pref_satisfied: 20, // 1 teacher
    });
    expect(s.costs[0].label).toBe("4 classes see the same specialist twice");
    expect(s.costs[1].label).toBe("2 subjects double up on the same day");
    // sorted by magnitude desc
    expect(s.costs[0].magnitude).toBeGreaterThan(s.costs[1].magnitude);
    expect(s.working).toContain("1 teacher got their preferred day");
  });

  it("derives minute-based costs and singular/plural correctly", () => {
    const s = scoreSummary({ teacher_planning: -36 }); // 36 min / 0.05 = 720
    expect(s.costs[0].label).toBe("about 720 teacher planning minutes short");
    const one = scoreSummary({ subject_gap: -40 });
    expect(one.costs[0].label).toBe("1 grade–specialist pairing never happens this week");
  });

  it("reports the balance term qualitatively, only past its threshold", () => {
    expect(scoreSummary({ spec_dayload_stdev: -0.3 }).working).toContain("Specialist days are evenly balanced");
    expect(scoreSummary({ spec_dayload_stdev: -1.2 }).costs[0].label).toBe("Specialist day-loads are a little uneven");
  });

  it("surfaces the headline percent via the shared rubric and counts errors", () => {
    const s = scoreSummary({ subject_gap: -40, subject_day_clustering: -60 }); // mag 100 → 75%
    expect(s.percent).toBe(75);
    expect(scoreSummary({ errors: -2000 }).errorCount).toBe(2);
    expect(scoreSummary(null).percent).toBeNull();
  });
});

describe("confidenceCopy", () => {
  it("maps each assessment to a calm headline + tone", () => {
    expect(confidenceCopy({ assessment: "near_optimal" })).toMatchObject({ tone: "good", headline: "Near-optimal" });
    expect(confidenceCopy({ assessment: "more_headroom" })).toMatchObject({ tone: "info", headline: "Room to improve" });
    expect(confidenceCopy({ assessment: "structurally_limited" })).toMatchObject({ tone: "warn", headline: "Capacity-limited" });
  });
  it("prefers the engine recommendation as the detail, falling back to a default", () => {
    expect(confidenceCopy({ assessment: "near_optimal", recommendation: "Within 1 point of the bound." }).detail).toBe("Within 1 point of the bound.");
    expect(confidenceCopy({ assessment: "near_optimal" }).detail).toMatch(/very little room/);
  });
  it("degrades gracefully for a missing/unknown signal", () => {
    expect(confidenceCopy(null).assessment).toBe("unknown");
    expect(confidenceCopy({ assessment: "weird" }).assessment).toBe("unknown");
  });
});
