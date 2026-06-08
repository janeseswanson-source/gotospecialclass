// Generates 2-week alternating A / B session date ranges across the school year.
// TODO: Replace heuristic dates with explicit school_year_start_date / end_date
// from the schools table once those fields are added (follow-up).

function parseSchoolYear(schoolYear?: string): { start: Date; end: Date } {
  const fallbackStart = new Date(new Date().getFullYear(), 7, 25); // Aug 25
  const fallbackEnd = new Date(new Date().getFullYear() + 1, 5, 15); // Jun 15
  if (!schoolYear) return { start: fallbackStart, end: fallbackEnd };
  const m = schoolYear.match(/(\d{4}).*?(\d{4})/);
  if (!m) return { start: fallbackStart, end: fallbackEnd };
  const y1 = parseInt(m[1], 10);
  const y2 = parseInt(m[2], 10);
  return {
    start: new Date(y1, 7, 25), // Aug 25 of first year
    end: new Date(y2, 5, 15),   // Jun 15 of second year
  };
}

function getMonday(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmt(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export interface SessionRange {
  label: 'A' | 'B';
  start: Date;
  end: Date; // Friday
  text: string; // "8/24-9/4"
}

export function generateSessionRanges(schoolYear?: string): SessionRange[] {
  try {
    const { start, end } = parseSchoolYear(schoolYear);
    const firstMon = getMonday(start);
    const ranges: SessionRange[] = [];
    let cursor = new Date(firstMon);
    let label: 'A' | 'B' = 'A';
    while (cursor <= end) {
      // Each session spans 2 weeks (Mon -> Fri of week 2)
      const periodEnd = new Date(cursor);
      periodEnd.setDate(periodEnd.getDate() + 11); // 2 weeks - weekend = Friday of week 2
      ranges.push({
        label,
        start: new Date(cursor),
        end: periodEnd,
        text: `${fmt(cursor)}-${fmt(periodEnd)}`,
      });
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() + 14);
      label = label === 'A' ? 'B' : 'A';
    }
    return ranges;
  } catch {
    return [];
  }
}
