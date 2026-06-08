export function getMondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 Sun ... 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function addWeeks(date: Date, n: number): Date {
  return addDays(date, n * 7);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatShort(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export function formatWeekHeader(monday: Date): string {
  return `Week of ${DOW[monday.getDay()]}, ${MONTHS[monday.getMonth()]} ${monday.getDate()}, ${monday.getFullYear()}`;
}

export function formatDayHeader(d: Date): string {
  return `${DOW[d.getDay()].toUpperCase()} · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function enumerateWeeks(start: Date, count: number): Date[] {
  const m = getMondayOf(start);
  return Array.from({ length: count }, (_, i) => addWeeks(m, i));
}

export function enumerateWeeksBetween(start: Date, end: Date, cap = 12): Date[] {
  const result: Date[] = [];
  let cur = getMondayOf(start);
  const last = getMondayOf(end);
  while (cur <= last && result.length < cap) {
    result.push(cur);
    cur = addWeeks(cur, 1);
  }
  return result;
}
