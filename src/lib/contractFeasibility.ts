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

  // Grade vs teacher coverage sanity.
  const grades = school.grades_served ?? [];

  // HARD gap: the optimal solver (CP-SAT) builds one class per classroom teacher,
  // so with zero teachers it has literally nothing to place — generation yields an
  // empty schedule (and the metaheuristic fallback can't recover a real one). The
  // per-teacher planners also need these rows. So require at least one teacher.
  if (teachers.length === 0) {
    notes.push({
      level: "error",
      message: "No classroom teachers added — the scheduler has no classes to place.",
      suggestion: "Add at least one classroom teacher (with its grade) in the Teachers step.",
    });
  } else {
    // Some grades have teachers, others don't. CP-SAT gives the teacher-less grades
    // NO specialist coverage (it only schedules the grades that have a class), so
    // this is a real coverage hole, not just a display detail — warn, don't inform.
    const gradesWithoutTeachers = grades.filter(
      (g) => !teachers.some((t) => t.grade === g)
    );
    if (gradesWithoutTeachers.length > 0) {
      notes.push({
        level: "warning",
        message: `These grades have no classroom teacher: ${gradesWithoutTeachers.join(", ")}.`,
        suggestion:
          "Add a teacher for each so the optimal solver schedules their specialist classes; otherwise those grades may be left uncovered.",
      });
    }

    // A teacher whose grade isn't in grades_served has no time grid to be placed in —
    // that class silently can't be scheduled. Point the user at the mismatch.
    const servedSet = new Set(grades);
    const orphanGrades = Array.from(
      new Set(
        teachers
          .map((t) => (t.grade ?? "").trim())
          .filter((g) => g.length > 0 && !servedSet.has(g))
      )
    );
    if (orphanGrades.length > 0) {
      notes.push({
        level: "warning",
        message: `Teacher grade(s) not in the school's grade list: ${orphanGrades.join(", ")}.`,
        suggestion:
          "Add these to Grades Served in School Info, or fix the teacher's grade — otherwise those classes can't be scheduled.",
      });
    }
  }

  if (specialists.length === 0) {
    notes.push({
      level: "error",
      message: "No specialists configured — nothing to schedule.",
      suggestion: "Add at least one specialist in the Setup Wizard.",
    });
  }

  if (grades.length === 0) {
    notes.push({
      level: "error",
      message: "No grades selected — the scheduler has no grade time grids to fill.",
      suggestion: "Choose the grades your school serves in School Info.",
    });
  }

  return notes;
}
