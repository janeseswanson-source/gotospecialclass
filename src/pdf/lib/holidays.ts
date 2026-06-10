// Day labels for PDF overlays. The school's own APPROVED calendar events
// (parsed during setup) take priority; the hardcoded US holiday list below is
// only the fallback when no school calendar exists.

export type DayLabel = { type: 'holiday' | 'pd' | 'waiver'; label: string };

export interface SchoolCalendarEvent {
  event_date: string | null; // YYYY-MM-DD
  end_date?: string | null;
  title: string;
  event_type: string;
}

const NO_SCHOOL_TYPES = new Set(['holiday', 'no_school', 'closure', 'break']);
const PD_TYPES = new Set(['teacher_workday', 'pd', 'professional_development']);

function isoOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Label a date from the school's approved calendar events; falls back to the
 *  generic US holiday list when no events are provided / none match. */
export function getDayLabelFor(date: Date, events?: SchoolCalendarEvent[] | null): DayLabel | null {
  if (events && events.length) {
    const iso = isoOf(date);
    for (const ev of events) {
      if (!ev?.event_date) continue;
      const start = ev.event_date;
      const end = ev.end_date ?? ev.event_date;
      if (iso < start || iso > end) continue;
      if (NO_SCHOOL_TYPES.has(ev.event_type)) return { type: 'holiday', label: ev.title || 'No School' };
      if (PD_TYPES.has(ev.event_type)) return { type: 'pd', label: ev.title || 'PD Day' };
    }
    // A school calendar exists but doesn't mark this date — trust it over the
    // generic stub (a school in session on a federal holiday prints normally).
    return null;
  }
  return getDayLabel(date);
}

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
