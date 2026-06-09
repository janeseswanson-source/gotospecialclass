// Pre-generation feasibility analysis for the new scheduler-data
// integrations. Surfaced in PrepPage before the user clicks Generate
// so contract gaps and infeasible PLT targets are visible up-front
// rather than only appearing post-generation as warnings.

export type FeasibilityLevel = "info" | "warning";

export interface FeasibilityNote {
  level: FeasibilityLevel;
  message: string;
  suggestion?: string;
}

interface ContractSubject { grade?: string | null; subject?: string | null; weekly_minutes?: number | null }
interface ContractTeacher { role?: string | null; planning_minutes?: number | null; duty_free_minutes?: number | null }
interface ContractExtract {
  subjects?: ContractSubject[] | null;
  teachers?: ContractTeacher[] | null;
}

interface SchoolLike {
  start_time?: string | null;
  end_time?: string | null;
  early_release_day?: string | null;
  early_release_end_time?: string | null;
  suggest_extra_plt?: boolean | null;
  extra_plt_target_minutes?: number | null;
  contractual_minutes_extracted?: unknown;
  grades_served?: string[] | null;
}

interface SpecialistLike {
  id: string;
  name?: string | null;
  subject?: string | null;
  working_days?: string[] | null;
  weekly_planning_minutes?: number | null;
}

interface TeacherLike {
  id: string;
  name?: string | null;
  grade?: string | null;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const DAY_FULL_TO_SHORT: Record<string, string> = {
  Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri",
};

function timeToMinutes(t?: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function normalize(s?: string | null): string {
  return String(s ?? "").trim().toLowerCase();
}

export function analyzeContractFeasibility(
  school: SchoolLike,
  specialists: SpecialistLike[],
  teachers: TeacherLike[],
): FeasibilityNote[] {
  const notes: FeasibilityNote[] = [];
  const extracted = (school?.contractual_minutes_extracted ?? null) as ContractExtract | null;

  // ── 1. Contract subjects must map to a specialist subject ───────────
  if (extracted?.subjects?.length) {
    const knownSubjects = new Set(specialists.map((s) => normalize(s.subject)));
    const knownGrades = new Set((school.grades_served ?? []).map((g) => normalize(g)));
    const missingSubjects = new Map<string, number>();
    const missingGrades = new Map<string, number>();
    for (const s of extracted.subjects) {
      const sub = normalize(s.subject);
      const grd = normalize(s.grade);
      if (sub && !knownSubjects.has(sub) && !Array.from(knownSubjects).some((k) => k.includes(sub) || sub.includes(k))) {
        missingSubjects.set(s.subject ?? sub, (missingSubjects.get(s.subject ?? sub) ?? 0) + 1);
      }
      if (grd && knownGrades.size > 0 && !knownGrades.has(grd)) {
        missingGrades.set(s.grade ?? grd, (missingGrades.get(s.grade ?? grd) ?? 0) + 1);
      }
    }
    for (const [name, count] of missingSubjects) {
      notes.push({
        level: "warning",
        message: `Contract requires "${name}" but no specialist teaches that subject (${count} requirement${count === 1 ? "" : "s"}).`,
        suggestion: "Add a specialist for this subject, or remove/rename the contract entry.",
      });
    }
    for (const [name, count] of missingGrades) {
      notes.push({
        level: "info",
        message: `Contract references grade "${name}" which isn't in this school's grades (${count} entry${count === 1 ? "" : "ies"}).`,
      });
    }
  }

  // ── 2. Contract roles must map to a specialist or classroom teacher ─
  if (extracted?.teachers?.length) {
    const specSubjects = specialists.map((s) => normalize(s.subject));
    const teacherGrades = teachers.map((t) => normalize(t.grade));
    for (const t of extracted.teachers) {
      const role = normalize(t.role);
      if (!role) continue;
      const matchesSpec = specSubjects.some((s) => s && (s.includes(role) || role.includes(s)));
      const matchesTeacher =
        teacherGrades.some((g) => g && (g.includes(role) || role.includes(g))) ||
        role.includes("classroom") || role.includes("teacher");
      if (!matchesSpec && !matchesTeacher) {
        notes.push({
          level: "info",
          message: `Contract role "${t.role}" can't be matched to a specialist or teacher.`,
          suggestion: "Rename the role to match a specialist subject (e.g. PE, Music) or 'Classroom Teacher'.",
        });
      }
    }
  }

  // ── 3. Extra-PLT target must fit within available free time ─────────
  if (school?.suggest_extra_plt) {
    const target = Number(school?.extra_plt_target_minutes ?? 0);
    const startMin = timeToMinutes(school?.start_time) ?? 8 * 60;
    const endMin = timeToMinutes(school?.end_time) ?? 15 * 60;
    if (target > 0 && endMin > startMin) {
      const dayMinutes = endMin - startMin;
      const earlyShort = DAY_FULL_TO_SHORT[school?.early_release_day ?? ""] ?? "";
      const earlyEnd = timeToMinutes(school?.early_release_end_time);
      for (const spec of specialists) {
        const workDays = (spec.working_days ?? DAYS).filter((d) => DAYS.includes(d));
        if (workDays.length === 0) continue;
        let weekly = 0;
        for (const d of workDays) {
          if (earlyShort && d === earlyShort && earlyEnd != null) {
            weekly += Math.max(0, earlyEnd - startMin);
          } else {
            weekly += dayMinutes;
          }
        }
        // Already-required planning eats into available capacity.
        const required = spec.weekly_planning_minutes ?? 0;
        const free = Math.max(0, weekly - required);
        if (target > free) {
          notes.push({
            level: "warning",
            message: `${spec.name ?? "Specialist"} can offer at most ${free} min/wk of extra planning but the target is ${target}.`,
            suggestion: "Lower the extra-PLT target or add a working day for this specialist.",
          });
        }
      }
    }
  }

  return notes;
}
