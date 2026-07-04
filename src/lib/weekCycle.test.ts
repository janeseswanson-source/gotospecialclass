import { describe, it, expect } from "vitest";
import { buildWeekCycle, type CalendarEventLike } from "./weekCycle";

// Fixture year: Mon Jan 6 2025 → Fri Feb 28 2025 = exactly 8 weeks.
//  W0 Jan 6–10 | W1 Jan 13–17 | W2 Jan 20–24 (HOLIDAY) | W3 Jan 27–31
//  W4 Feb 3–7  | W5 Feb 10–14 | W6 Feb 17–21          | W7 Feb 24–28
const START = "2025-01-06";
const END = "2025-02-28";

// A full-week holiday over W2 (Mon–Fri Jan 20–24), given as one ranged event.
const HOLIDAY_WEEK: CalendarEventLike[] = [
  { event_date: "2025-01-20", end_date: "2025-01-24", event_type: "holiday", title: "Winter Break" },
];

const labels = (weeks: { label: string | null }[]) => weeks.map((w) => w.label);

describe("buildWeekCycle — structure", () => {
  it("enumerates every Mon–Fri week in range", () => {
    const c = buildWeekCycle({ strategy: "standard", startDate: START, endDate: END });
    expect(c.weeks).toHaveLength(8);
    expect(c.weeks[0].monday.getFullYear()).toBe(2025);
    expect(c.weeks[0].monday.getMonth()).toBe(0); // Jan
    expect(c.weeks[0].monday.getDate()).toBe(6);
    expect(c.weeks[7].friday.getMonth()).toBe(1); // Feb
    expect(c.weeks[7].friday.getDate()).toBe(28);
    expect(c.weeks[0].rangeText).toBe("Jan 6 – Jan 10");
  });

  it("detects a full-week holiday and excludes it from instructional weeks", () => {
    const c = buildWeekCycle({ strategy: "standard", startDate: START, endDate: END, events: HOLIDAY_WEEK });
    expect(c.weeks[2].isHolidayWeek).toBe(true);
    expect(c.holidayWeekCount).toBe(1);
    expect(c.instructionalWeeks).toHaveLength(7);
    // Standard = no labels anywhere.
    expect(labels(c.weeks)).toEqual([null, null, null, null, null, null, null, null]);
  });

  it("does NOT treat an early-release week as a holiday", () => {
    const early: CalendarEventLike[] = [
      { event_date: "2025-01-20", end_date: "2025-01-24", event_type: "early_release", title: "Conferences" },
    ];
    const c = buildWeekCycle({ strategy: "standard", startDate: START, endDate: END, events: early });
    expect(c.weeks[2].isHolidayWeek).toBe(false);
    expect(c.holidayWeekCount).toBe(0);
  });

  it("requires ALL five weekdays off to count as a holiday week", () => {
    const partial: CalendarEventLike[] = [
      { event_date: "2025-01-20", end_date: "2025-01-23", event_type: "holiday", title: "4-day" }, // Fri Jan 24 still taught
    ];
    const c = buildWeekCycle({ strategy: "standard", startDate: START, endDate: END, events: partial });
    expect(c.weeks[2].isHolidayWeek).toBe(false);
  });
});

describe("ab_week", () => {
  it("continue policy: alternation resumes on the next taught week (holiday invisible)", () => {
    const c = buildWeekCycle({ strategy: "ab_week", startDate: START, endDate: END, events: HOLIDAY_WEEK, holidayPolicy: "continue" });
    // W2 is a skipped holiday (null); the A/B counter holds across it.
    expect(labels(c.weeks)).toEqual(["A", "B", null, "A", "B", "A", "B", "A"]);
    expect(c.rangesFor("A").map((w) => w.weekIndex)).toEqual([0, 3, 5, 7]);
    expect(c.rangesFor("B").map((w) => w.weekIndex)).toEqual([1, 4, 6]);
  });

  it("skip_and_hold policy: labels stay anchored to the calendar (week keeps its letter)", () => {
    const c = buildWeekCycle({ strategy: "ab_week", startDate: START, endDate: END, events: HOLIDAY_WEEK, holidayPolicy: "skip_and_hold" });
    expect(labels(c.weeks)).toEqual(["A", "B", "A", "B", "A", "B", "A", "B"]);
    // The holiday week still carries its calendar label but isn't instructional.
    expect(c.weeks[2].label).toBe("A");
    expect(c.weeks[2].isHolidayWeek).toBe(true);
    expect(c.rangesFor("A").map((w) => w.weekIndex)).toEqual([0, 4, 6]); // W2 excluded (holiday)
  });

  it("the two policies diverge on the week after the holiday", () => {
    const cont = buildWeekCycle({ strategy: "ab_week", startDate: START, endDate: END, events: HOLIDAY_WEEK, holidayPolicy: "continue" });
    const hold = buildWeekCycle({ strategy: "ab_week", startDate: START, endDate: END, events: HOLIDAY_WEEK, holidayPolicy: "skip_and_hold" });
    expect(cont.weeks[3].label).toBe("A"); // rhythm continued
    expect(hold.weeks[3].label).toBe("B"); // calendar-anchored
  });
});

describe("aa_bb_week", () => {
  it("continue policy: two-week blocks over taught weeks", () => {
    const c = buildWeekCycle({ strategy: "aa_bb_week", startDate: START, endDate: END, events: HOLIDAY_WEEK, holidayPolicy: "continue" });
    expect(labels(c.weeks)).toEqual(["AA", "AA", null, "BB", "BB", "AA", "AA", "BB"]);
  });

  it("skip_and_hold policy: blocks anchored to the calendar", () => {
    const c = buildWeekCycle({ strategy: "aa_bb_week", startDate: START, endDate: END, events: HOLIDAY_WEEK, holidayPolicy: "skip_and_hold" });
    expect(labels(c.weeks)).toEqual(["AA", "AA", "BB", "BB", "AA", "AA", "BB", "BB"]);
  });

  it("labelText names the two-week block", () => {
    const c = buildWeekCycle({ strategy: "aa_bb_week", startDate: START, endDate: END });
    expect(c.weeks[0].labelText).toBe("AA · Weeks 1–2");
    expect(c.weeks[2].labelText).toBe("BB · Weeks 3–4");
  });
});

describe("currentLabelFor / currentWeekFor", () => {
  it("returns the label in effect for a date inside a week", () => {
    const cont = buildWeekCycle({ strategy: "ab_week", startDate: START, endDate: END, events: HOLIDAY_WEEK, holidayPolicy: "continue" });
    const hold = buildWeekCycle({ strategy: "ab_week", startDate: START, endDate: END, events: HOLIDAY_WEEK, holidayPolicy: "skip_and_hold" });
    const midW3 = new Date(2025, 0, 29); // Wed Jan 29, inside W3
    expect(cont.currentLabelFor(midW3)).toBe("A");
    expect(hold.currentLabelFor(midW3)).toBe("B");
    expect(cont.currentWeekFor(midW3)?.weekIndex).toBe(3);
  });

  it("returns null outside the school year", () => {
    const c = buildWeekCycle({ strategy: "ab_week", startDate: START, endDate: END });
    expect(c.currentWeekFor(new Date(2024, 11, 1))).toBeNull();
    expect(c.currentLabelFor(new Date(2030, 0, 1))).toBeNull();
  });
});

describe("year bounds", () => {
  it("falls back to parsing the school_year string when no explicit dates", () => {
    const c = buildWeekCycle({ strategy: "standard", schoolYear: "2025-2026" });
    expect(c.start.getFullYear()).toBe(2025);
    expect(c.start.getMonth()).toBe(7); // Aug
    expect(c.end.getFullYear()).toBe(2026);
    expect(c.end.getMonth()).toBe(5); // Jun
  });

  it("prefers explicit dates over the school_year string", () => {
    const c = buildWeekCycle({ strategy: "standard", startDate: START, endDate: END, schoolYear: "2030-2031" });
    expect(c.start.getFullYear()).toBe(2025);
  });
});

describe("explanation", () => {
  it("describes the strategy and holiday handling in plain language", () => {
    const cont = buildWeekCycle({ strategy: "ab_week", startDate: START, endDate: END, events: HOLIDAY_WEEK, holidayPolicy: "continue" });
    expect(cont.explanation).toContain("Alternating A / B");
    expect(cont.explanation).toContain("7 instructional weeks");
    expect(cont.explanation.toLowerCase()).toContain("holiday");

    const std = buildWeekCycle({ strategy: "standard", startDate: START, endDate: END });
    expect(std.explanation).toContain("Every week");
  });
});
