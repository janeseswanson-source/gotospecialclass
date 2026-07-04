import { describe, it, expect } from "vitest";
import { subjectColors, parseMin, GOLD, NAVY, CREAM, WHITE, MUTE, GRIDLINE, ZEBRA, PAPER } from "./exportColors";
import { BRAND_ARGB, subjectColorsFor } from "@/brand/brand";

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

describe("export palette derives from the brand SoT", () => {
  it("re-exports the brand ARGB values verbatim", () => {
    expect(NAVY).toBe(BRAND_ARGB.ink);
    expect(GOLD).toBe(BRAND_ARGB.gold);
    expect(CREAM).toBe(BRAND_ARGB.cream);
    expect(WHITE).toBe(BRAND_ARGB.white);
    expect(MUTE).toBe(BRAND_ARGB.mute);
    expect(GRIDLINE).toBe(BRAND_ARGB.gridline);
    expect(ZEBRA).toBe(BRAND_ARGB.zebra);
    expect(PAPER).toBe(BRAND_ARGB.paper);
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
  });

  it("uses the shared brand subject band (same color as grid + pdf)", () => {
    // The xlsx accent is the SAME harmonized hue/value as the brand band.
    expect(subjectColors("art studio").accent).toBe(subjectColorsFor("art studio").accentArgb);
    expect(subjectColors("art studio").accent).toBe("FFA95F2D");
  });

  it("gives non-teaching bands the brand gold/cream", () => {
    expect(subjectColors("Lunch").accent).toBe(GOLD);
    expect(subjectColors("Lunch").fill).toBe(CREAM);
    expect(subjectColors("Recess").accent).toBe(GOLD);
  });

  it("falls back to the deep brand gold for unknown subjects", () => {
    expect(subjectColors("Underwater Basket Weaving").accent).toBe(BRAND_ARGB.goldDeep);
    expect(subjectColors(null).accent).toBe(BRAND_ARGB.goldDeep);
  });
});
