import { computeConflictPairs, type ConflictBlock } from "@/lib/scheduleGrid";

export interface StrategyContext {
  conflictGrades: string[];
  gradesServed: string[];
  specialistCount: number;
  teachersByGrade: Record<string, number>;
  hasLunchConfig: boolean;
  hasClubs: boolean;
  classDuration: number;
  bigGroupConfig: Array<{ grade: string; teacherIds: string[] }>;
}

export interface StrategyRecommendation {
  key: string;
  reason: string;
}

/**
 * Auto-recommend the best conflict strategies based on school context.
 */
export function getRecommendedStrategies(ctx: StrategyContext): StrategyRecommendation[] {
  const recs: StrategyRecommendation[] = [];

  if (ctx.specialistCount < 1) return recs;

  const gradeCount = ctx.gradesServed.length;

  // Base rotation: if more grades than specialists, need rotation
  if (gradeCount > ctx.specialistCount) {
    const ratio = ctx.specialistCount / gradeCount;
    if (ratio < 0.5) {
      recs.push({ key: "aa_bb_week", reason: `Only ${ctx.specialistCount} specialist(s) for ${gradeCount} grades — AA/BB gives 2-week continuity.` });
    } else {
      recs.push({ key: "ab_week", reason: `${ctx.specialistCount} specialist(s) for ${gradeCount} grades — A/B alternation balances coverage.` });
    }
  }

  // Big Group: any conflict grade with ≥2 teachers
  const bigGroupCandidates = ctx.conflictGrades.filter(g => (ctx.teachersByGrade[g] ?? 0) >= 2);
  if (bigGroupCandidates.length > 0) {
    recs.push({ key: "big_group", reason: `Grades ${bigGroupCandidates.join(", ")} have 2+ teachers — combining reduces total slots needed.` });
  }

  // Quick 30: if class duration > 30 and K or 1 exist
  const youngGrades = ctx.gradesServed.filter(g => g === "K" || g === "1");
  if (ctx.classDuration > 30 && youngGrades.length > 0) {
    recs.push({ key: "quick_30", reason: `Grades ${youngGrades.join(", ")} benefit from shorter 30-min sessions, freeing slots.` });
  }

  // Lunch Clubs: if both exist
  if (ctx.hasClubs && ctx.hasLunchConfig) {
    recs.push({ key: "lunch_clubs", reason: "Clubs and lunch windows are configured — adds specialist teaching time." });
  }

  // Make-up: always recommend as safety net
  recs.push({ key: "makeup", reason: "Covers missed classes from holidays or assemblies with flex time." });

  return recs;
}

export interface StrategyNote {
  note: string;
  severity: "info" | "warning" | "error";
}

export function getStrategyNote(strategyKey: string, ctx: StrategyContext): StrategyNote {
  switch (strategyKey) {
    case "ab_week": {
      if (ctx.specialistCount < 1) return { severity: "error", note: "No specialists configured — add at least one specialist first." };
      if (ctx.gradesServed.length <= 1) return { severity: "warning", note: "Only 1 grade configured. A/B weeks help when there are more grades than weekly slots." };
      return { severity: "info", note: "Works well when there are more grade-teacher pairs than a single week can fit. Specialists alternate classes every other week." };
    }

    case "aa_bb_week": {
      if (ctx.specialistCount < 1) return { severity: "error", note: "No specialists configured — add at least one specialist first." };
      if (ctx.gradesServed.length <= 1) return { severity: "warning", note: "Only 1 grade configured. AA/BB rotation is most useful with multiple grades." };
      return { severity: "info", note: "Provides 2-week continuity — students see the same specialist twice before rotating. Best for skill-building subjects like Art or Music." };
    }

    case "quick_30": {
      if (ctx.classDuration <= 30) return { severity: "warning", note: "Class duration is already ≤ 30 min — this strategy won't save additional time." };
      if (ctx.conflictGrades.length === 0) return { severity: "warning", note: "No conflict grades selected yet. Select grades that should get shorter 30-minute sessions." };
      return { severity: "info", note: `Shortens sessions for ${ctx.conflictGrades.join(", ")} to 30 min, freeing slots for other grades. Ideal for younger students (K-1) with shorter attention spans.` };
    }

    case "lunch_clubs": {
      if (!ctx.hasLunchConfig) return { severity: "warning", note: "No recess/lunch windows configured. Set up lunch times first so the engine knows when to schedule clubs." };
      if (!ctx.hasClubs) return { severity: "warning", note: "No clubs defined. Add clubs in the Setup Wizard (Clubs step) to use this strategy." };
      return { severity: "info", note: "Adds specialist teaching time during lunch periods. Works when clubs are defined and lunch windows have enough time (≥ 20 min)." };
    }

    case "event_planning": {
      if (ctx.specialistCount < 1) return { severity: "error", note: "No specialists configured." };
      return { severity: "info", note: "Reserves end-of-day blocks for school-wide event prep (Art Show, STEAM Night). Works when specialists have at least one free slot." };
    }

    case "big_group": {
      const conflictGradesWithEnoughTeachers = ctx.conflictGrades.filter(
        g => (ctx.teachersByGrade[g] ?? 0) >= 2
      );
      if (ctx.bigGroupConfig.length === 0 && conflictGradesWithEnoughTeachers.length === 0) {
        const gradesLacking = ctx.conflictGrades.filter(g => (ctx.teachersByGrade[g] ?? 0) < 2);
        if (gradesLacking.length > 0) {
          return { severity: "error", note: `Conflict grades ${gradesLacking.join(", ")} have fewer than 2 teachers each. Big Group requires ≥ 2 classes per grade to combine.` };
        }
        return { severity: "warning", note: "No big group splits configured. Select a grade and pick 2+ teachers to combine in the configuration panel." };
      }
      if (ctx.bigGroupConfig.length > 0) {
        return { severity: "info", note: `${ctx.bigGroupConfig.length} split(s) configured. The engine will combine these classes into one large group per specialist session.` };
      }
      return { severity: "info", note: "Combines 2+ classes into one large group for a specialist. Reduces total slots needed per grade." };
    }

    case "makeup": {
      if (ctx.specialistCount < 1) return { severity: "error", note: "No specialists configured." };
      return { severity: "info", note: "Suggests available flex time after the main schedule is built. Useful for covering missed classes due to holidays or assemblies." };
    }

    default:
      return { severity: "info", note: "" };
  }
}

/**
 * Analyze generated schedule blocks for conflict warnings.
 */
export type WarningFixTarget = 'specialists' | 'teachers' | 'clubs' | 'conflicts' | 'rotation' | 'events' | 'recess';

export interface ScheduleWarning {
  type: string;
  message: string;
  severity: "info" | "warning" | "error";
  suggestion?: string;
  fixAction?: { label: string; target: WarningFixTarget; anchor?: string };
}


export function analyzeScheduleBlocks(
  blocks: Array<{
    id?: string;
    day_of_week: string;
    start_time: string;
    end_time?: string;
    specialist_name?: string | null;
    specialist_id?: string | null;
    teacher_name?: string | null;
    teacher_id?: string | null;
    grade?: string | null;
    week_label?: string | null;
    subject?: string | null;
  }>,
  specialists: Array<{ id: string; name: string; subject: string }>,
  grades: string[]
): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

  // 1. Grades with no specialist coverage at all
  for (const grade of grades) {
    const gradeBlocks = blocks.filter(b => b.grade === grade && b.specialist_id);
    if (gradeBlocks.length === 0) {
      warnings.push({
        type: "no_coverage",
        severity: "error",
        message: `Grade ${grade} has no specialist sessions scheduled.`,
        suggestion: "Consider adding more specialists or enabling A/B Week rotation.",
        fixAction: { label: 'Adjust specialists', target: 'specialists' },
      });
    }
  }

  // 2. Double-booking via the SHARED interval-overlap detector (same source the
  //    grid uses), so a 45-min block overlapping a 30-min one at a different
  //    start minute is caught and the panel never disagrees with the grid rings.
  const conflictBlocks: ConflictBlock[] = blocks
    .filter((b): b is typeof b & { id: string; end_time: string } => !!b.id && !!b.end_time)
    .map(b => ({
      id: b.id,
      day_of_week: b.day_of_week,
      start_time: b.start_time,
      end_time: b.end_time,
      specialist_id: b.specialist_id,
      teacher_id: b.teacher_id,
      specialist_name: b.specialist_name,
      teacher_name: b.teacher_name,
      grade: b.grade,
      week_label: b.week_label,
    }));

  // Group conflicting pairs by colliding entity + day so we emit one readable
  // warning per double-booked person/day instead of N pairwise rows.
  const doubleBookGroups = new Map<string, { who: string; day: string; entries: Set<string>; isTeacher: boolean }>();
  for (const { a, b, kinds } of computeConflictPairs(conflictBlocks)) {
    for (const kind of kinds) {
      const isTeacher = kind === "teacher";
      const id = isTeacher ? (a.teacher_id ?? a.teacher_name) : (a.specialist_id ?? a.specialist_name);
      const who = (isTeacher ? a.teacher_name : a.specialist_name) ?? (isTeacher ? "Teacher" : "Specialist");
      const key = `${kind}:${id}:${a.day_of_week}`;
      const group = doubleBookGroups.get(key) ?? { who, day: a.day_of_week, entries: new Set<string>(), isTeacher };
      group.entries.add(`${a.start_time} (Gr ${a.grade ?? "?"})`);
      group.entries.add(`${b.start_time} (Gr ${b.grade ?? "?"})`);
      doubleBookGroups.set(key, group);
    }
  }
  for (const { who, day, entries, isTeacher } of doubleBookGroups.values()) {
    warnings.push({
      type: "double_booked",
      severity: "error",
      message: `${who} is double-booked on ${day} (${Array.from(entries).join(", ")}).`,
      suggestion: isTeacher
        ? "Move one block so the class isn't scheduled with two specialists at once."
        : "Move one block or enable Make-Up Sessions for overflow.",
      fixAction: { label: 'Update conflicts', target: 'conflicts' },
    });
  }

  // 3. Uneven A/B week distribution
  const weekA = blocks.filter(b => b.week_label === "A").length;
  const weekB = blocks.filter(b => b.week_label === "B").length;
  if (weekA > 0 && weekB > 0) {
    const ratio = Math.min(weekA, weekB) / Math.max(weekA, weekB);
    if (ratio < 0.7) {
      warnings.push({
        type: "uneven_weeks",
        severity: "warning",
        message: `Week A has ${weekA} blocks vs Week B with ${weekB} blocks — uneven distribution.`,
        suggestion: "Review specialist assignments to balance across weeks.",
        fixAction: { label: 'Update conflicts', target: 'conflicts' },
      });
    }
  }

  // 4. Specialists with working days but 0 blocks on a day
  for (const spec of specialists) {
    for (const day of DAYS) {
      const dayBlocks = blocks.filter(b => b.specialist_id === spec.id && b.day_of_week === day);
      if (dayBlocks.length === 0) {
        // Only warn if they have blocks on other days (meaning they should be working)
        const totalBlocks = blocks.filter(b => b.specialist_id === spec.id);
        if (totalBlocks.length > 0) {
          warnings.push({
            type: "gap",
            severity: "warning",
            message: `${spec.name} has no blocks on ${day}.`,
            suggestion: "This may be intentional (planning day) or could indicate a scheduling gap.",
            fixAction: { label: "Edit specialist's days", target: 'specialists', anchor: spec.id },
          });
        }
      }
    }
  }

  return warnings;
}
