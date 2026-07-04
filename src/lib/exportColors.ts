// Palette + helpers for the branded spreadsheet exports (ARGB for ExcelJS).
// ALL colors derive from the ONE brand source of truth (src/brand/brand.ts), so
// the spreadsheet matches the app and the PDFs exactly. Kept free of ExcelJS /
// supabase imports so it stays cheap to import and easy to unit-test in node.

import { BRAND_ARGB, subjectColorsFor } from "@/brand/brand";

// Brand palette (ARGB — 8 hex digits, leading FF = fully opaque).
export const NAVY = BRAND_ARGB.ink;
export const GOLD = BRAND_ARGB.gold;
export const CREAM = BRAND_ARGB.cream;
export const WHITE = BRAND_ARGB.white;
export const MUTE = BRAND_ARGB.mute;
export const GRIDLINE = BRAND_ARGB.gridline;
export const ZEBRA = BRAND_ARGB.zebra;
export const PAPER = BRAND_ARGB.paper;

/** Subject → soft fill + accent (ARGB), from the shared brand subject band —
 *  IDENTICAL hue/value to the on-screen grid and the PDF chips. Lunch/recess use
 *  the brand gold/cream so non-teaching bands read as neutral. */
export function subjectColors(subject?: string | null): { fill: string; accent: string } {
  const s = (subject ?? "").toLowerCase();
  if (s.includes("lunch") || s.includes("recess")) return { accent: GOLD, fill: CREAM };
  const c = subjectColorsFor(subject);
  return { accent: c.accentArgb, fill: c.fillArgb };
}

/** Parse "HH:MM[:SS]" to minutes-from-midnight; 0 for empty/nullish. */
export function parseMin(t?: string | null): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
