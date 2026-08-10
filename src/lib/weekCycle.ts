// weekCycle — the single source of truth for "what week is it, and what is that
// week called?" across the grid week selector, the PDFs, and the exports.
//
// Given the school's strategy, its year bounds, and the approved calendar events,
// it produces the DATED cycle: an ordered list of instructional weeks, each with a
// real Monday–Friday range and its persisted label (A/B for ab_week, AA/BB for
// aa_bb_week, none for standard). Full-week holidays are detected and skipped so
// the labels line up with the calendar instead of drifting.
//
// This replaces the heuristics in pdf/lib/sessionCalendar.ts (which guessed dates
// from the school_year string and never accounted for holidays).

export type WeekStrategy = "standard" | "ab_week" | "aa_bb_week";

/** Persisted week label. `null` = standard (every week, unlabelled). */
export type WeekLabel = "A" | "B" | "AA" | "BB" | null;

/**
 * How the alternation behaves across a full-week holiday:
 *  - "continue": the A/B (or AA/BB) rhythm runs over instructional weeks only;
 *    a skipped holiday week is invisible and the next taught week takes the next
 *    label. (Best when "every other time we meet" matters.)
 *  - "skip_and_hold": labels are anchored to the calendar week index, so a given
 *    calendar week always keeps its letter even if a holiday interrupts the
 *    rhythm. (Best when families think "this is always an A week".)
 */
export type HolidayPolicy = "continue" | "skip_and_hold";

/** Minimal shape of an approved parsed_calendar_events row. */
export interface CalendarEventLike {
  event_date: string | null;
  end_date?: string | null;
  event_type?: string | null;
  title?: string | null;
}

export interface CycleWeek {
  /** 0-based position among ALL weeks in range (holiday weeks included). */
  weekIndex: number;
  monday: Date;
  friday: Date;
  /** The persisted label for this week (null for standard, or a skipped week
   *  under the "continue" policy). */
  label: WeekLabel;
  /** True when every Mon–Fri day is a non-instructional (holiday/no-school) day. */
  isHolidayWeek: boolean;
  /** School is in session but the specials wheel hasn't started yet — the
   *  first week or two of the year, when teachers are settling classes. */
  isPreRotation: boolean;
  /** "Week A", "AA · Weeks 1–2", or "Week" — a display-ready label. */
  labelText: string;
  /** "Mar 2 – Mar 6". */
  rangeText: string;
}

export interface WeekCycleInput {
  strategy: WeekStrategy;
  /** ISO "YYYY-MM-DD" or Date. Falls back to `schoolYear` when absent. */
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  /** e.g. "2025-2026" — parsed for bounds only when explicit dates are missing. */
  schoolYear?: string | null;
  events?: CalendarEventLike[] | null;
  /** Defaults to "continue". */
  holidayPolicy?: HolidayPolicy;
  /** First day the specials wheel runs. Usually a week or two after the first
   *  student day. Weeks before it are marked `isPreRotation`. */
  rotationsStartDate?: string | Date | null;
  /** Which week counts as Week A. Defaults to "school_year", which keeps the
   *  historical lettering exactly as it was. */
  weekAnchor?: WeekAnchor;
}

/**
 * What "Week A" is anchored to.
 *  - "school_year": the first instructional week of the year (historical
 *    behaviour — labels are unchanged for every existing school).
 *  - "rotations_start": the first week the rotation actually runs, so a
 *    wheel that starts in week 3 still opens on Week A.
 */
export type WeekAnchor = "school_year" | "rotations_start";

/**
 * The rotation-cycle columns as seen by pages that read a `schools` row.
 * Migration 20260808020000 may not be applied yet, so these aren't in the
 * generated Supabase types — cast the row to this instead of `any`.
 */
export interface RotationCycleFields {
  rotations_start_date?: string | null;
  rotations_week_anchor?: WeekAnchor | null;
}

export interface WeekCycle {
  strategy: WeekStrategy;
  holidayPolicy: HolidayPolicy;
  start: Date;
  end: Date;
  weeks: CycleWeek[];
  /** Instructional (non-holiday) weeks only. */
  instructionalWeeks: CycleWeek[];
  holidayWeekCount: number;
  /** Monday of the first week the rotation runs, or null when rotations start
   *  with the school year. Drives the "Rotations start Mon Aug 18" pill. */
  rotationsStartMonday: Date | null;
  /** The label in effect for a given date (null if outside the year / standard). */
  currentLabelFor(date: Date): WeekLabel;
  /** The CycleWeek containing a date, or null if outside the year. */
  currentWeekFor(date: Date): CycleWeek | null;
  /** All instructional weeks carrying a label ("A","B","AA","BB"); for a null
   *  label (standard) returns every instructional week. */
  rangesFor(label: WeekLabel): CycleWeek[];
  /** Plain-language description of how the cycle works. */
  explanation: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Types that make a weekday non-instructional. early_release / event / first_day /
// last_day are still teaching days and do NOT count toward a holiday week.
const NON_INSTRUCTIONAL_TYPES = new Set([
  "holiday",
  "no_school",
  "closure",
  "teacher_workday",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse "YYYY-MM-DD" as a LOCAL date (avoids the UTC-midnight off-by-one). */
function parseISODate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) {
    const d = new Date(v);
    d.setHours(0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  return parseISODate(v);
}

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 Sun … 6 Sat
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isoKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmt(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Parse a "2025-2026" style string to heuristic Aug 25 → Jun 15 bounds. */
function parseSchoolYear(schoolYear?: string | null): { start: Date; end: Date } {
  const now = new Date();
  const fallback = {
    start: new Date(now.getFullYear(), 7, 25), // Aug 25
    end: new Date(now.getFullYear() + 1, 5, 15), // Jun 15
  };
  if (!schoolYear) return fallback;
  const m = schoolYear.match(/(\d{4}).*?(\d{4})/);
  if (!m) return fallback;
  return {
    start: new Date(Number(m[1]), 7, 25),
    end: new Date(Number(m[2]), 5, 15),
  };
}

/** Expand non-instructional events into a Set of "YYYY-MM-DD" day keys. */
function buildNonInstructionalDays(events?: CalendarEventLike[] | null): Set<string> {
  const days = new Set<string>();
  for (const ev of events ?? []) {
    if (!ev.event_date) continue;
    const type = (ev.event_type ?? "").toLowerCase();
    if (!NON_INSTRUCTIONAL_TYPES.has(type)) continue;
    const start = parseISODate(ev.event_date);
    if (!start) continue;
    const end = ev.end_date ? parseISODate(ev.end_date) ?? start : start;
    // Guard against reversed / absurd ranges.
    const span = Math.min(Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS)), 370);
    for (let i = 0; i <= span; i++) days.add(isoKey(addDays(start, i)));
  }
  return days;
}

function isHolidayWeek(monday: Date, nonInstructional: Set<string>): boolean {
  for (let i = 0; i < 5; i++) {
    if (!nonInstructional.has(isoKey(addDays(monday, i)))) return false;
  }
  return true;
}

/** Map a cycle position (0-based) to its label under the active strategy. */
function labelForPosition(strategy: WeekStrategy, position: number): WeekLabel {
  if (strategy === "standard") return null;
  if (strategy === "ab_week") return position % 2 === 0 ? "A" : "B";
  // aa_bb_week: consecutive PAIRS — weeks 0,1 = AA; 2,3 = BB; repeat.
  return Math.floor(position / 2) % 2 === 0 ? "AA" : "BB";
}

function labelText(label: WeekLabel, position: number): string {
  if (label === null) return "Week";
  if (label === "A" || label === "B") return `Week ${label}`;
  // AA/BB pair — surface which two-week block this is (1-indexed pair number).
  const pair = Math.floor(position / 2) + 1;
  return `${label} · Weeks ${pair * 2 - 1}–${pair * 2}`;
}

/**
 * Build the dated week cycle. Pure and deterministic — safe to unit-test and to
 * call from the grid, the PDFs, and the exports with the same inputs.
 */
export function buildWeekCycle(input: WeekCycleInput): WeekCycle {
  const strategy = input.strategy;
  const holidayPolicy = input.holidayPolicy ?? "continue";

  const explicitStart = toDate(input.startDate);
  const explicitEnd = toDate(input.endDate);
  const parsed = parseSchoolYear(input.schoolYear);
  const start = explicitStart ?? parsed.start;
  const end = explicitEnd ?? parsed.end;

  const nonInstructional = buildNonInstructionalDays(input.events);

  // Rotations often begin a week or two after the students do. Weeks before
  // that Monday are real school weeks with no wheel running.
  const rotationsStart = toDate(input.rotationsStartDate);
  const rotationsStartMonday = rotationsStart ? getMondayOf(rotationsStart) : null;
  const weekAnchor: WeekAnchor = input.weekAnchor ?? "school_year";

  const weeks: CycleWeek[] = [];
  const firstMonday = getMondayOf(start);
  const lastMonday = getMondayOf(end);

  // `continueCounter` advances only on instructional weeks (the "continue" policy).
  let continueCounter = 0;
  let weekIndex = 0;
  // Counts weeks from the ROTATION start for the "rotations_start" anchor.
  let rotationCounter = 0;

  for (
    let monday = new Date(firstMonday);
    monday <= lastMonday;
    monday = addDays(monday, 7), weekIndex++
  ) {
    const friday = addDays(monday, 4);
    const holiday = isHolidayWeek(monday, nonInstructional);
    const preRotation = rotationsStartMonday !== null && monday < rotationsStartMonday;

    // Position drives the label. Under "skip_and_hold" the calendar week index is
    // the position (labels are anchored to the calendar). Under "continue" the
    // position is the running count of instructional weeks (holidays are invisible).
    // Under the "rotations_start" anchor the count instead begins at the first
    // rotation week, so the wheel always opens on Week A.
    const anchored = weekAnchor === "rotations_start" && rotationsStartMonday !== null;
    let label: WeekLabel = null;
    let position: number;
    if (anchored) {
      position = rotationCounter;
      // A pre-rotation week has no wheel, so it carries no label at all.
      label = preRotation ? null : labelForPosition(strategy, rotationCounter);
    } else if (holidayPolicy === "skip_and_hold") {
      // Labels anchored to the calendar week index — a holiday week keeps its
      // letter (isHolidayWeek still marks it as non-teaching), so weeks never drift.
      position = weekIndex;
      label = labelForPosition(strategy, weekIndex);
    } else {
      position = continueCounter;
      // continue: label advances only on taught weeks; skipped weeks carry none.
      if (!holiday) label = labelForPosition(strategy, continueCounter);
    }

    weeks.push({
      weekIndex,
      monday: new Date(monday),
      friday,
      label,
      isHolidayWeek: holiday,
      isPreRotation: preRotation,
      labelText: preRotation ? "Before rotations" : labelText(label, position),
      rangeText: `${fmt(monday)} – ${fmt(friday)}`,
    });

    if (!holiday) continueCounter++;
    // The rotation clock starts at the rotation week and, like `continue`,
    // ignores full-week holidays so the A/B rhythm doesn't drift.
    if (anchored && !preRotation && !holiday) rotationCounter++;
  }

  // "Instructional" here means "a week the schedule applies to", so weeks
  // before the wheel starts are excluded — otherwise rangesFor() would hand
  // the PDFs date ranges in which no rotation runs.
  const instructionalWeeks = weeks.filter((w) => !w.isHolidayWeek && !w.isPreRotation);
  const holidayWeekCount = weeks.filter((w) => w.isHolidayWeek).length;

  const currentWeekFor = (date: Date): CycleWeek | null => {
    const monday = getMondayOf(date);
    const t = monday.getTime();
    return weeks.find((w) => w.monday.getTime() === t) ?? null;
  };

  const currentLabelFor = (date: Date): WeekLabel => currentWeekFor(date)?.label ?? null;

  const rangesFor = (label: WeekLabel): CycleWeek[] => {
    if (label === null) return instructionalWeeks;
    return instructionalWeeks.filter((w) => w.label === label);
  };

  return {
    strategy,
    holidayPolicy,
    start,
    end,
    weeks,
    instructionalWeeks,
    holidayWeekCount,
    rotationsStartMonday,
    currentLabelFor,
    currentWeekFor,
    rangesFor,
    explanation: buildExplanation(
      strategy,
      holidayPolicy,
      instructionalWeeks.length,
      holidayWeekCount,
      rotationsStartMonday,
    ),
  };
}

function buildExplanation(
  strategy: WeekStrategy,
  policy: HolidayPolicy,
  instructional: number,
  holidays: number,
  rotationsStartMonday?: Date | null,
): string {
  const rotationNote = rotationsStartMonday
    ? ` Rotations start the week of ${fmt(rotationsStartMonday)}; earlier weeks are school weeks with no wheel.`
    : "";
  const holidayNote =
    holidays === 0
      ? ""
      : policy === "continue"
        ? ` ${holidays} full-week holiday${holidays === 1 ? "" : "s"} ${holidays === 1 ? "is" : "are"} skipped, and the rhythm continues on the next taught week.`
        : ` ${holidays} full-week holiday${holidays === 1 ? "" : "s"} ${holidays === 1 ? "keeps" : "keep"} its calendar label so weeks never drift.`;

  if (strategy === "standard") {
    return `Every week runs the same schedule across ${instructional} instructional week${instructional === 1 ? "" : "s"}.${holidayNote}${rotationNote}`;
  }
  if (strategy === "ab_week") {
    return `Alternating A / B weeks across ${instructional} instructional week${instructional === 1 ? "" : "s"}.${holidayNote}${rotationNote}`;
  }
  return `Two-week blocks — AA (weeks 1–2), then BB (weeks 3–4), repeating across ${instructional} instructional week${instructional === 1 ? "" : "s"}.${holidayNote}${rotationNote}`;
}
