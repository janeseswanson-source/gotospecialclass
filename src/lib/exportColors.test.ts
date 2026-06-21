import { describe, it, expect } from "vitest";
import { subjectColors, parseMin, GOLD } from "./exportColors";

const ARGB = /^FF[0-9A-Fa-f]{6}$/;

describe("parseMin", () => {
  it("parses HH:MM and HH:MM:SS to minutes", () => {
    expect(parseMin("08:30")).toBe(510);
    expect(parseMin("08:30:00")).toBe(510);
    expect(parseMin("00:00")).toBe(0);
    expect(parseMin("13:05")).toBe(785);
  });
  it("returns 0 for empty/nullish", () => {
    expect(parseMin("")).toBe(0);
    expect(parseMin(null)).toBe(0);
    expect(parseMin(undefined)).toBe(0);
  });
});

describe("subjectColors", () => {
  it("returns valid 8-digit ARGB for fill and accent", () => {
    for (const subj of ["Art", "Music", "PE", "Library", "STEM", "Spanish", "Technology", "Drama", "Dance", "Garden", "Lunch"]) {
      const { fill, accent } = subjectColors(subj);
      expect(fill).toMatch(ARGB);
      expect(accent).toMatch(ARGB);
    }
  });
  it("matches on partial/case-insensitive names", () => {
    expect(subjectColors("Physical Education")).toEqual(subjectColors("PE"));
    expect(subjectColors("art studio").accent).toBe("FFD97706");
  });
  it("falls back to the brand gold for unknown subjects", () => {
    expect(subjectColors("Underwater Basket Weaving").accent).toBe(GOLD);
    expect(subjectColors(null).accent).toBe(GOLD);
  });
});
