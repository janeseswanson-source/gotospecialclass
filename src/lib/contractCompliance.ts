// Contract compliance — does this week's schedule fit the union contract?
//
// The PM supplied her district's numbers (HSTA, Article VI §CC) and asked
// "Should we add contract info from the district contract here?" The load-
// bearing detail she flagged is that specialists and classroom teachers are
// held to DIFFERENT limits, on purpose:
//
//   self-contained (classroom): 1415 instructional, 310 "other"
//   departmental  (specialist): 1285 instructional, 440 "other"
//   both:                        225 prep, 150 lunch (>= 30 continuous)
//
// This is ADVISORY. It reports; it never blocks a schedule and never feeds the
// optimizer. `unaccounted` is always shown rather than hidden, because the
// first thing a coordinator does with a number like this is check the
// arithmetic — and a report that silently absorbs its own rounding is worse
// than useless.

export type ContractCategory = 'self_contained' | 'departmental';

export interface CategoryLimits {
  label: string;
  /** Max minutes of direct instruction per week. */
  instructionalMax: number;
  /** Guaranteed preparation minutes per week. */
  prepMin: number;
  /** Duty-free lunch minutes per week… */
  lunchMin: number;
  /** …in continuous blocks of at least this long. */
  lunchContinuousMin: number;
  /** Prep must include a continuous block of at least this long. */
  prepContinuousMin: number;
  /** Minutes for meetings, passing, recess, opening/closing. */
  otherMin: number;
  /** No more than this much continuous teaching without a break. */
  maxContinuousTeachingMin: number;
  /** Length of the break that must follow it. */
  requiredBreakMin: number;
}

export interface BucketRules {
  /** Time before rotations start is on-duty "Other", not prep. */
  preRotationIsOther: boolean;
  /** A lunch club counts as instruction… */
  lunchClubIsInstructional: boolean;
  /** …plus this much set-up charged to "Other". */
  lunchClubSetupOtherMinutes: number;
  /** Of a recess period, this much is transition ("Other"). */
  recessTransitionOtherMinutes: number;
}

export interface ContractProfile {
  name: string;
  categories: Record<ContractCategory, CategoryLimits>;
  bucketRules: BucketRules;
}

/** Hawaii / HSTA — the numbers the PM supplied, verbatim. */
export const HSTA_PROFILE: ContractProfile = {
  name: 'Hawaii (HSTA)',
  categories: {
    self_contained: {
      label: 'Self-contained (classroom)',
      instructionalMax: 1415,
      prepMin: 225,
      lunchMin: 150,
      lunchContinuousMin: 30,
      prepContinuousMin: 45,
      otherMin: 310,
      maxContinuousTeachingMin: 180,
      requiredBreakMin: 15,
    },
    departmental: {
      label: 'Departmental (specialist)',
      instructionalMax: 1285,
      prepMin: 225,
      lunchMin: 150,
      lunchContinuousMin: 30,
      prepContinuousMin: 45,
      otherMin: 440,
      maxContinuousTeachingMin: 180,
      requiredBreakMin: 15,
    },
  },
  bucketRules: {
    preRotationIsOther: true,
    lunchClubIsInstructional: true,
    lunchClubSetupOtherMinutes: 5,
    recessTransitionOtherMinutes: 5,
  },
};

export interface ComplianceBlock {
  day_of_week: string;
  start_time: string;
  end_time: string;
  subject?: string | null;
  grade?: string | null;
  specialist_id?: string | null;
  teacher_id?: string | null;
  week_label?: string | null;
}

export interface CompliancePerson {
  id: string;
  name: string;
  category: ContractCategory;
  /** Specialist ids this person's class attends WITH them (never prep). */
  accompaniedSpecialistIds?: Set<string>;
  /** Which side of a block links to this person. */
  role: 'specialist' | 'teacher';
}

export interface ComplianceFinding {
  personId: string;
  personName: string;
  type:
    | 'instructional_over'
    | 'prep_short'
    | 'prep_not_continuous'
    | 'lunch_short'
    | 'lunch_not_continuous'
    | 'no_break_over_180'
    | 'other_over';
  severity: 'warning' | 'info';
  message: string;
}

export interface PersonCompliance {
  personId: string;
  personName: string;
  category: ContractCategory;
  limits: CategoryLimits;
  /** Weekly minutes per bucket. */
  instructional: number;
  prep: number;
  lunch: number;
  other: number;
  /** Duty minutes not attributed to any bucket. ALWAYS displayed. */
  unaccounted: number;
  /** Total duty minutes measured (the denominator). */
  dutyTotal: number;
  findings: ComplianceFinding[];
}

const RESERVED_GRADES = new Set(['lunch', 'planning', 'makeup', '']);

function toMin(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

const dur = (b: ComplianceBlock) => Math.max(0, toMin(b.end_time) - toMin(b.start_time));

function isLunchClub(b: ComplianceBlock): boolean {
  return /lunch club/i.test(b.subject ?? '');
}

function isSpecialistLunch(b: ComplianceBlock): boolean {
  return (b.grade ?? '').trim().toLowerCase() === 'lunch'
    || (b.subject ?? '').trim().toLowerCase() === 'specialist lunch';
}

function isPlanningBlock(b: ComplianceBlock): boolean {
  const g = (b.grade ?? '').trim().toLowerCase();
  const s = (b.subject ?? '').toLowerCase();
  return g === 'planning' || /planning|plc|prep\b/.test(s);
}

/** Merge intervals that touch or overlap, so "continuous" means continuous. */
function mergeTouching(intervals: Array<{ start: number; end: number }>) {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = out[out.length - 1];
    if (sorted[i].start <= cur.end) cur.end = Math.max(cur.end, sorted[i].end);
    else out.push({ ...sorted[i] });
  }
  return out;
}

export interface ComplianceInput {
  blocks: ComplianceBlock[];
  people: CompliancePerson[];
  profile: ContractProfile;
  /** Weekly on-duty minutes per person (the teacher day × working days). */
  dutyMinutesFor: (person: CompliancePerson) => number;
  /** Minutes per week before rotations start — "Other" under the contract. */
  preRotationMinutesPerWeek?: number;
}

/**
 * Bucket every duty minute for each person and report contract findings.
 *
 * Deliberately simple arithmetic on the schedule we have: no estimation, no
 * pro-rating. Anything we can't attribute lands in `unaccounted`.
 */
export function computeCompliance(input: ComplianceInput): PersonCompliance[] {
  const { blocks, people, profile } = input;
  const rules = profile.bucketRules;

  return people.map((person) => {
    const limits = profile.categories[person.category];
    const mine = blocks.filter((b) =>
      person.role === 'specialist' ? b.specialist_id === person.id : b.teacher_id === person.id,
    );

    let instructional = 0;
    let prep = 0;
    let lunch = 0;
    let other = 0;
    const prepIntervalsByDay = new Map<string, Array<{ start: number; end: number }>>();
    const lunchIntervalsByDay = new Map<string, Array<{ start: number; end: number }>>();
    const teachIntervalsByDay = new Map<string, Array<{ start: number; end: number }>>();

    for (const b of mine) {
      const minutes = dur(b);
      if (minutes <= 0) continue;
      const interval = { start: toMin(b.start_time), end: toMin(b.end_time) };

      if (isSpecialistLunch(b)) {
        lunch += minutes;
        (lunchIntervalsByDay.get(b.day_of_week) ?? lunchIntervalsByDay.set(b.day_of_week, []).get(b.day_of_week)!).push(interval);
        continue;
      }
      if (isLunchClub(b)) {
        // Her rule: a lunch club counts as teaching, plus 5 minutes of set-up
        // charged to "Other".
        if (rules.lunchClubIsInstructional) {
          instructional += minutes;
          (teachIntervalsByDay.get(b.day_of_week) ?? teachIntervalsByDay.set(b.day_of_week, []).get(b.day_of_week)!).push(interval);
        } else {
          other += minutes;
        }
        other += rules.lunchClubSetupOtherMinutes;
        continue;
      }
      if (isPlanningBlock(b)) {
        prep += minutes;
        (prepIntervalsByDay.get(b.day_of_week) ?? prepIntervalsByDay.set(b.day_of_week, []).get(b.day_of_week)!).push(interval);
        continue;
      }
      if (RESERVED_GRADES.has((b.grade ?? '').trim().toLowerCase())) {
        other += minutes;
        continue;
      }

      if (person.role === 'specialist') {
        instructional += minutes;
        (teachIntervalsByDay.get(b.day_of_week) ?? teachIntervalsByDay.set(b.day_of_week, []).get(b.day_of_week)!).push(interval);
      } else {
        // A classroom teacher's class at specials IS their prep — UNLESS the
        // teacher goes along, which is exactly the PM's "so it is not a prep
        // minutes unequal use of time".
        const accompanied = b.specialist_id
          ? person.accompaniedSpecialistIds?.has(b.specialist_id) ?? false
          : false;
        if (accompanied) {
          instructional += minutes;
          (teachIntervalsByDay.get(b.day_of_week) ?? teachIntervalsByDay.set(b.day_of_week, []).get(b.day_of_week)!).push(interval);
        } else {
          prep += minutes;
          (prepIntervalsByDay.get(b.day_of_week) ?? prepIntervalsByDay.set(b.day_of_week, []).get(b.day_of_week)!).push(interval);
        }
      }
    }

    if (rules.preRotationIsOther) other += input.preRotationMinutesPerWeek ?? 0;

    const dutyTotal = input.dutyMinutesFor(person);
    const unaccounted = Math.max(0, dutyTotal - instructional - prep - lunch - other);

    const findings: ComplianceFinding[] = [];
    const add = (type: ComplianceFinding['type'], severity: ComplianceFinding['severity'], message: string) =>
      findings.push({ personId: person.id, personName: person.name, type, severity, message });

    if (instructional > limits.instructionalMax) {
      add('instructional_over', 'warning',
        `${instructional} instructional min/wk exceeds the ${limits.instructionalMax} cap by ${instructional - limits.instructionalMax}.`);
    }
    if (prep < limits.prepMin) {
      add('prep_short', 'warning', `${prep} prep min/wk is short of the ${limits.prepMin} guarantee.`);
    } else {
      const longestPrep = Math.max(0, ...[...prepIntervalsByDay.values()]
        .flatMap((iv) => mergeTouching(iv).map((r) => r.end - r.start)));
      if (longestPrep < limits.prepContinuousMin) {
        add('prep_not_continuous', 'warning',
          `Prep totals ${prep} min/wk but the longest unbroken block is ${longestPrep} min (needs ${limits.prepContinuousMin}).`);
      }
    }
    if (lunch < limits.lunchMin) {
      add('lunch_short', 'warning', `${lunch} lunch min/wk is short of the ${limits.lunchMin} guarantee.`);
    }
    const shortLunchDay = [...lunchIntervalsByDay.entries()].find(([, iv]) =>
      mergeTouching(iv).every((r) => r.end - r.start < limits.lunchContinuousMin));
    if (shortLunchDay) {
      add('lunch_not_continuous', 'warning',
        `Lunch on ${shortLunchDay[0]} is shorter than the ${limits.lunchContinuousMin} continuous minutes the contract requires.`);
    }
    for (const [day, iv] of teachIntervalsByDay) {
      const longest = Math.max(0, ...mergeTouching(iv).map((r) => r.end - r.start));
      if (longest > limits.maxContinuousTeachingMin) {
        add('no_break_over_180', 'warning',
          `${longest} min of continuous teaching on ${day} without a ${limits.requiredBreakMin}-min break (max ${limits.maxContinuousTeachingMin}).`);
      }
    }
    if (other > limits.otherMin) {
      // Informational: the "other" bucket is an allowance, and exceeding it is
      // a planning observation rather than a violation to act on.
      add('other_over', 'info',
        `${other} min/wk in "other" duties against a ${limits.otherMin} allowance.`);
    }

    return { personId: person.id, personName: person.name, category: person.category, limits,
      instructional, prep, lunch, other, unaccounted, dutyTotal, findings };
  });
}
