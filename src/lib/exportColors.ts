// Pure palette + helpers for the branded spreadsheet export.
// Kept free of ExcelJS / supabase imports so it stays cheap to import and easy
// to unit-test in a node environment.

// Brand palette (ARGB — 8 hex digits, leading FF = fully opaque).
export const NAVY = "FF1B2A4A";
export const GOLD = "FFC5A55A";
export const CREAM = "FFFBF5E6";
export const WHITE = "FFFFFFFF";
export const MUTE = "FF6B7280";
export const GRIDLINE = "FFD9DCE3";
export const ZEBRA = "FFF7F8FA";

/** Subject → soft fill + accent (ARGB), matching the app/PDF subject colors. */
export function subjectColors(subject?: string | null): { fill: string; accent: string } {
  const s = (subject ?? "").toLowerCase();
  const mk = (accent: string, fill: string) => ({ accent, fill });
  if (s.includes("art")) return mk("FFD97706", "FFFDF6EC");
  if (s.includes("music")) return mk("FF2563EB", "FFEFF4FE");
  if (s.includes("pe") || s.includes("physical") || s.includes("gym")) return mk("FF16A34A", "FFEFFAF1");
  if (s.includes("library") || s.includes("media")) return mk("FF92400E", "FFFBF3EA");
  if (s.includes("spanish") || s.includes("language") || s.includes("foreign")) return mk("FFDC2626", "FFFDEFEF");
  if (s.includes("stem") || s.includes("science")) return mk("FF0369A1", "FFEDF6FC");
  if (s.includes("tech") || s.includes("computer")) return mk("FF7C3AED", "FFF4F0FE");
  if (s.includes("drama") || s.includes("theat")) return mk("FF9333EA", "FFF7F0FD");
  if (s.includes("dance")) return mk("FFBE185D", "FFFCEFF4");
  if (s.includes("garden")) return mk("FF4D7C0F", "FFF3F8EA");
  if (s.includes("lunch") || s.includes("recess")) return mk(GOLD, CREAM);
  return mk(GOLD, "FFF7F4EC");
}

/** Parse "HH:MM[:SS]" to minutes-from-midnight; 0 for empty/nullish. */
export function parseMin(t?: string | null): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
