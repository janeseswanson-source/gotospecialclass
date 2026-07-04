// On-screen subject colors — derived from the ONE brand source of truth
// (src/brand/brand.ts). A subject's hue/saturation/lightness here is IDENTICAL
// to its xlsx fill and pdf chip, so a subject is the same color on screen, in
// the spreadsheet, and on paper. Toned-down: neutral cell surface, subject color
// only as a left border + title accent (keeps the grid readable, not a rainbow).
//
// The color tokens (`subject-art`, `subject-art-dk`, `subject-art-fill`, …) are
// registered in tailwind.config.ts from brand's SUBJECT_HUES/SUBJECT_BAND and
// safelisted, so these template-literal class names resolve.

import { subjectKey } from "@/brand/brand";

/** Brand token name for a subject ("subject-art", … or "subject-gold"). */
function token(subject?: string | null): string {
  const k = subjectKey(subject);
  return k ? `subject-${k}` : "subject-gold";
}

/** Neutral cell surface. Subject identity = left border + title color. */
export function getSubjectColorClass(_subject?: string | null): string {
  return "bg-card hover:bg-muted/40 text-foreground border-border";
}

export function getSubjectLeftBorderClass(subject?: string | null): string {
  return `border-l-[3px] border-l-${token(subject)}`;
}

export function getSubjectAccentTextClass(subject?: string | null): string {
  const t = token(subject);
  return `text-${t} dark:text-${t}-dk`;
}

/** Soft subject fill (used where a tinted chip/cell is wanted). */
export function getSubjectFillClass(subject?: string | null): string {
  return `bg-${token(subject)}-fill`;
}

export function getSubjectBadgeClass(subject?: string | null): string {
  return getSubjectColorClass(subject);
}

export const subjectColors: Record<string, string> = {};
