// Stub US K-12 holiday list. Real holiday config can replace this later.

export type DayLabel = { type: 'holiday' | 'pd' | 'waiver'; label: string };

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  // month is 0-indexed; weekday: 0 Sun .. 6 Sat
  const d = new Date(year, month, 1);
  const offset = (weekday - d.getDay() + 7) % 7;
  d.setDate(1 + offset + (n - 1) * 7);
  return d;
}

function lastWeekday(year: number, month: number, weekday: number): Date {
  const d = new Date(year, month + 1, 0); // last day of month
  const offset = (d.getDay() - weekday + 7) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function getDayLabel(date: Date): DayLabel | null {
  try {
    const y = date.getFullYear();
    const m = date.getMonth();
    const d = date.getDate();

    // Winter break: Dec 23 – Jan 3
    if ((m === 11 && d >= 23) || (m === 0 && d <= 3)) {
      return { type: 'holiday', label: 'Winter Break' };
    }
    // Independence Day
    if (m === 6 && d === 4) return { type: 'holiday', label: 'Independence Day' };
    // Labor Day: 1st Mon Sep
    if (sameDay(date, nthWeekday(y, 8, 1, 1))) return { type: 'holiday', label: 'Labor Day' };
    // Thanksgiving: 4th Thu Nov + Fri after
    const thx = nthWeekday(y, 10, 4, 4);
    if (sameDay(date, thx)) return { type: 'holiday', label: 'Thanksgiving' };
    const dayAfterThx = new Date(thx); dayAfterThx.setDate(thx.getDate() + 1);
    if (sameDay(date, dayAfterThx)) return { type: 'holiday', label: 'Thanksgiving Break' };
    // MLK Day: 3rd Mon Jan
    if (sameDay(date, nthWeekday(y, 0, 1, 3))) return { type: 'holiday', label: 'MLK Day' };
    // Presidents Day: 3rd Mon Feb
    if (sameDay(date, nthWeekday(y, 1, 1, 3))) return { type: 'holiday', label: 'Presidents Day' };
    // Memorial Day: last Mon May
    if (sameDay(date, lastWeekday(y, 4, 1))) return { type: 'holiday', label: 'Memorial Day' };

    return null;
  } catch {
    return null;
  }
}
