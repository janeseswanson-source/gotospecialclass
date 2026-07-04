import { describe, it, expect } from "vitest";
import {
  normalizeSubject,
  normalizeGrade,
  normalizeDays,
  mapParsedSpecialists,
  mapParsedTeachers,
  isUnset,
  mergePrefill,
} from "./setupImport";

describe("normalizeSubject", () => {
  it("maps fuzzy labels to the allowed set", () => {
    expect(normalizeSubject("Phys Ed")).toBe("PE");
    expect(normalizeSubject("p.e.")).toBe("PE");
    expect(normalizeSubject("Computer Lab")).toBe("Technology");
    expect(normalizeSubject("Choir")).toBe("Music");
    expect(normalizeSubject("Media Center")).toBe("Library");
    expect(normalizeSubject("STEM")).toBe("STEAM");
    expect(normalizeSubject("Art")).toBe("Art");
    expect(normalizeSubject("")).toBe("Other");
    expect(normalizeSubject("Underwater Basket Weaving")).toBe("Other");
  });
});

describe("normalizeGrade", () => {
  it("normalizes grade tokens", () => {
    expect(normalizeGrade("Kindergarten")).toBe("K");
    expect(normalizeGrade("1st Grade")).toBe("1");
    expect(normalizeGrade("Pre-K")).toBe("PreK");
    expect(normalizeGrade("3")).toBe("3");
    expect(normalizeGrade("K-1")).toBe("K-1");
    expect(normalizeGrade("2-3")).toBe("2-3");
    expect(normalizeGrade("specials")).toBe("");
    expect(normalizeGrade("")).toBe("");
  });
});

describe("normalizeDays", () => {
  it("blank / all / Mon-Fri → all five", () => {
    expect(normalizeDays("")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(normalizeDays("all")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(normalizeDays("Mon-Fri")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  });
  it("keeps a valid array subset", () => {
    expect(normalizeDays(["Mon", "Wed", "Bogus"])).toEqual(["Mon", "Wed"]);
    expect(normalizeDays([])).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  });
  it("parses MWF and Tue/Thu phrasing", () => {
    expect(normalizeDays("MWF")).toEqual(["Mon", "Wed", "Fri"]);
    expect(normalizeDays("Tuesdays and Thursdays")).toEqual(["Tue", "Thu"]);
  });
});

describe("mapParsedSpecialists", () => {
  it("normalizes parser output and drops nameless rows", () => {
    const rows = mapParsedSpecialists([
      { name: "Ms. Rivera", subject: "Phys Ed", working_days: "MWF", location: "Gym", two_schools: "Yes", second_school_name: "East" },
      { name: "", subject: "Art" }, // dropped
      { subject: "Music" }, // dropped
      { name: "Mr. Poe", subject: "Computer", working_days: ["Tue", "Thu"] },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      name: "Ms. Rivera", subject: "PE", workingDays: ["Mon", "Wed", "Fri"],
      location: "Gym", phone: "", email: "", twoSchools: true, secondSchoolName: "East",
    });
    expect(rows[1].subject).toBe("Technology");
    expect(rows[1].workingDays).toEqual(["Tue", "Thu"]);
  });
  it("returns [] for non-arrays", () => {
    expect(mapParsedSpecialists(null)).toEqual([]);
    expect(mapParsedSpecialists(undefined as any)).toEqual([]);
  });
});

describe("mapParsedTeachers", () => {
  it("normalizes grades and drops nameless rows", () => {
    const rows = mapParsedTeachers([
      { name: "Mrs. Khan", grade: "Kindergarten", room: "12", preferences: "no specials before 9" },
      { name: "  ", grade: "1" }, // dropped
      { name: "Mr. Lee", grade: "3rd", room: "" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "Mrs. Khan", grade: "K", room: "12", preferences: "no specials before 9" });
    expect(rows[1]).toEqual({ name: "Mr. Lee", grade: "3", room: "", preferences: "" });
  });
});

describe("isUnset", () => {
  it("treats empty string / array / null as unset; numbers & booleans as set", () => {
    expect(isUnset("")).toBe(true);
    expect(isUnset("  ")).toBe(true);
    expect(isUnset([])).toBe(true);
    expect(isUnset(null)).toBe(true);
    expect(isUnset(undefined)).toBe(true);
    expect(isUnset("x")).toBe(false);
    expect(isUnset(0)).toBe(false);
    expect(isUnset(false)).toBe(false);
    expect(isUnset(["a"])).toBe(false);
  });
});

describe("mergePrefill", () => {
  it("fills only fields the user hasn't set", () => {
    const prev = { schoolName: "Lincoln", grades: [] as string[], website: "", startTime: "08:00" };
    const seed = { schoolName: "Ignored", grades: ["K", "1"], website: "lincoln.edu", startTime: "07:45" };
    // schoolName + startTime already set → kept; grades + website empty → filled.
    expect(mergePrefill(prev, seed)).toEqual({
      schoolName: "Lincoln", grades: ["K", "1"], website: "lincoln.edu", startTime: "08:00",
    });
  });

  it("does not apply unset seed values over set prev values", () => {
    const prev = { notes: "keep me" };
    expect(mergePrefill(prev, { notes: "" })).toEqual({ notes: "keep me" });
  });

  it("is a no-op when seed is empty", () => {
    const prev = { a: "x", b: [] as string[] };
    expect(mergePrefill(prev, {})).toEqual(prev);
  });
});
