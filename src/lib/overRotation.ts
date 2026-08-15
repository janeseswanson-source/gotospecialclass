// Detect grades that can't fit one clean rotation wheel.
//
// PM: "5th - 5 classes (Conflict issues — May need a AA/BB type schedule or
// different days for 5th or split one 5th and divide them into each specialist
// class so there are four rotations)."
//
// When a grade has more classrooms than there are specialists, no single wave
// can serve the whole grade: someone is always left over. That shows up
// downstream as a PD window that can never be met and as uneven rotations, so
// it's worth naming at setup time, before a schedule is generated.

export interface OverRotationInput {
  /** One entry per CLASS (classroom teacher), carrying its grade. */
  teachers: Array<{ grade?: string | null }>;
  /** Specialists available to run a wheel. */
  specialistCount: number;
}

export interface OverRotationFinding {
  grade: string;
  classCount: number;
  specialistCount: number;
  /** Class counts of the other grades, for the "others have 3-4" phrasing. */
  otherCounts: number[];
  /** How many classes can't fit in one wave. */
  overflow: number;
}

const RESERVED = new Set(['lunch', 'planning', 'makeup', 'all', '']);

/** Class count per grade, in a stable K-first order. */
export function classCountsByGrade(teachers: Array<{ grade?: string | null }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of teachers) {
    const g = String(t.grade ?? '').trim();
    if (!g || RESERVED.has(g.toLowerCase())) continue;
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return counts;
}

/**
 * Grades whose class count exceeds the number of specialists — the only case
 * where a full-grade wheel is arithmetically impossible.
 *
 * Deliberately NOT flagging "bigger than the other grades": a grade with more
 * classes than its neighbours is perfectly schedulable as long as the wheel
 * can still hold it, and warning about it would be noise.
 */
export function detectOverRotation({ teachers, specialistCount }: OverRotationInput): OverRotationFinding[] {
  const counts = classCountsByGrade(teachers);
  if (counts.size === 0 || specialistCount <= 0) return [];

  const findings: OverRotationFinding[] = [];
  for (const [grade, classCount] of counts) {
    if (classCount <= specialistCount) continue;
    findings.push({
      grade,
      classCount,
      specialistCount,
      otherCounts: [...counts.entries()].filter(([g]) => g !== grade).map(([, n]) => n).sort((a, b) => a - b),
      overflow: classCount - specialistCount,
    });
  }
  return findings.sort((a, b) => b.overflow - a.overflow);
}

/** One sentence a coordinator can act on. */
export function describeOverRotation(f: OverRotationFinding): string {
  const others = f.otherCounts.length > 0
    ? (() => {
        const min = f.otherCounts[0];
        const max = f.otherCounts[f.otherCounts.length - 1];
        return min === max ? `others have ${min}` : `others have ${min}–${max}`;
      })()
    : 'it is your largest grade';
  return `Grade ${f.grade} has ${f.classCount} classes (${others}) and you have ${f.specialistCount} specialists, ` +
    `so ${f.overflow} class${f.overflow === 1 ? '' : 'es'} can't fit in one rotation.`;
}
