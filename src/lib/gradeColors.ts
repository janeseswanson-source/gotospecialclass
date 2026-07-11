// On-screen grade colors — derived from the ONE brand source of truth
// (src/brand/brand.ts), exactly like subjectColors. A grade's hue is the same
// band the subject colors use, so the grid stays visually consistent when the
// Specialist Planner swaps its rails from subject to grade.
//
// The color tokens (`grade-k`, `grade-1`, … `grade-8`, `grade-any`) are
// registered in tailwind.config.ts from brand's GRADE_HUES/SUBJECT_BAND and
// safelisted, so these template-literal class names resolve.

import { gradeKey } from "@/brand/brand";

/** Brand token name for a grade ("grade-k", "grade-3", … or "grade-any"). */
function token(grade?: string | null): string {
  const k = gradeKey(grade);
  return k ? `grade-${k}` : "grade-any";
}

export function getGradeLeftBorderClass(grade?: string | null): string {
  return `border-l-[3px] border-l-${token(grade)}`;
}

export function getGradeAccentTextClass(grade?: string | null): string {
  const t = token(grade);
  return `text-${t} dark:text-${t}-dk`;
}

/** Soft grade fill (used where a tinted chip is wanted). */
export function getGradeFillClass(grade?: string | null): string {
  return `bg-${token(grade)}-fill`;
}
