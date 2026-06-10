/**
 * Pre-flight contract / scheduler-data feasibility checks.
 *
 * Surfaces simple, actionable warnings on the Prep page before the user
 * generates a schedule. Intentionally lightweight — heavier feasibility
 * analysis lives in the generator's scoring layer.
 */

export interface FeasibilityNote {
  level: "info" | "warning" | "error";
  message: string;
  suggestion?: string;
}

interface SchoolLike {
  start_time?: string | null;
  end_time?: string | null;
  class_duration?: number | null;
  passing_time?: number | null;
  grades_served?: string[] | null;
}

interface SpecialistLike {
  id: string;
  name: string;
  subject?: string | null;
  working_days?: string[] | null;
  class_duration?: number | null;
  lunch_minutes?: number | null;
  weekly_planning_minutes?: number | null;
  is_part_time?: boolean | null;
}

interface TeacherLike {
  id: string;
  name?: string | null;
  grade?: string | null;
}

function toMin(t?: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function analyzeContractFeasibility(
  school: SchoolLike,
  specialists: SpecialistLike[],
  teachers: TeacherLike[]
): FeasibilityNote[] {
  const notes: FeasibilityNote[] = [];

  const startMin = toMin(school.start_time);
  const endMin = toMin(school.end_time);
  const dayMinutes =
    startMin != null && endMin != null ? Math.max(0, endMin - startMin) : null;

  if (dayMinutes == null) {
    notes.push({
      level: "warning",
      message: "School start/end times are not fully configured.",
      suggestion: "Set start and end times in School Info.",
    });
  }

  const defaultDur = school.class_duration ?? 45;
  const passing = school.passing_time ?? 5;

  // Per-specialist sanity checks
  for (const s of specialists) {
    const dur = s.class_duration ?? defaultDur;
    const lunch = s.lunch_minutes ?? 30;
    const planning = s.weekly_planning_minutes ?? 0;
    const workingDays = (s.working_days ?? ["Mon", "Tue", "Wed", "Thu", "Fri"]).length;

    if (dayMinutes != null) {
      const usable = dayMinutes - lunch - 30; // 30min admin/transitions buffer
      if (usable < dur + passing) {
        notes.push({
          level: "error",
          message: `${s.name} has no usable teaching time in a day.`,
          suggestion: `Reduce lunch (${lunch}m) or class duration (${dur}m), or extend the school day.`,
        });
        continue;
      }

      const slotsPerWeek = Math.floor(usable / (dur + passing)) * workingDays;
      const planningSlots = Math.ceil(planning / (dur + passing));
      if (planningSlots >= slotsPerWeek) {
        notes.push({
          level: "warning",
          message: `${s.name}'s planning time (${planning} min/wk) consumes most teaching slots.`,
          suggestion: "Lower weekly planning minutes or add a working day.",
        });
      }
    }

    if (workingDays === 0) {
      notes.push({
        level: "error",
        message: `${s.name} has no working days selected.`,
        suggestion: "Add at least one working day in the Specialists step.",
      });
    }
  }

  // Grade vs teacher coverage sanity
  const grades = school.grades_served ?? [];
  const gradesWithoutTeachers = grades.filter(
    (g) => !teachers.some((t) => t.grade === g)
  );
  if (gradesWithoutTeachers.length > 0 && teachers.length > 0) {
    notes.push({
      level: "info",
      message: `Grades without teachers: ${gradesWithoutTeachers.join(", ")}.`,
      suggestion:
        "The schedule will use grade-level blocks instead of per-teacher blocks for these.",
    });
  }

  if (specialists.length === 0) {
    notes.push({
      level: "error",
      message: "No specialists configured — nothing to schedule.",
      suggestion: "Add at least one specialist in the Setup Wizard.",
    });
  }

  return notes;
}
