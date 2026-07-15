// Shared grade label helpers. Grades are stored as raw strings ("K", "TK",
// "PreK", "1", "2", …). Every print/screen surface should sort them with
// gradeRank and label them with formatGradeOrdinal so "1st" reads the same
// on the Admin View, the Admin Overview PDF, and the Specialist Planner.

/** Stable grade ordering: PreK, TK, K first, then numeric, unknowns last. */
export function gradeRank(g: string | null | undefined): number {
  if (!g) return 999;
  const u = g.toUpperCase();
  if (u === 'TK') return -2;
  if (u === 'PREK' || u === 'PRE-K') return -3;
  if (u === 'K') return -1;
  const n = parseInt(g, 10);
  return Number.isFinite(n) ? n : 998;
}

/**
 * "1" → "1st", "2" → "2nd", "3" → "3rd", "4" → "4th", "11" → "11th"…
 * Non-numeric grades ("K", "TK", "PreK", "Lunch") pass through unchanged.
 */
export function formatGradeOrdinal(grade: string | null | undefined): string {
  if (!grade) return '';
  const g = grade.trim();
  if (!/^\d+$/.test(g)) return g;
  const n = parseInt(g, 10);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
