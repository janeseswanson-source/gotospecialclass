// Shared subject color tokens. Toned-down style: neutral surface for the
// cell, with a colored left border + subject-tinted title as the only
// "accent". Keeps the schedule readable without feeling like a rainbow.

const SUBJECT_STYLES: Array<{
  keywords: string[];
  accentText: string;
  leftBorderClass: string;
}> = [
  { keywords: ['art'], accentText: 'text-purple', leftBorderClass: 'border-l-purple' },
  { keywords: ['music'], accentText: 'text-primary', leftBorderClass: 'border-l-primary' },
  { keywords: ['pe', 'physical', 'gym'], accentText: 'text-success', leftBorderClass: 'border-l-success' },
  { keywords: ['library', 'media'], accentText: 'text-warning-foreground', leftBorderClass: 'border-l-warning' },
  { keywords: ['tech', 'computer'], accentText: 'text-[hsl(190,70%,35%)] dark:text-[hsl(190,70%,55%)]', leftBorderClass: 'border-l-[hsl(190,70%,45%)]' },
  { keywords: ['science', 'stem'], accentText: 'text-destructive', leftBorderClass: 'border-l-destructive' },
  { keywords: ['spanish', 'language', 'foreign'], accentText: 'text-orange-700 dark:text-orange-400', leftBorderClass: 'border-l-orange-500' },
  { keywords: ['drama', 'theater', 'theatre'], accentText: 'text-pink-700 dark:text-pink-400', leftBorderClass: 'border-l-pink-500' },
  { keywords: ['dance'], accentText: 'text-rose-700 dark:text-rose-400', leftBorderClass: 'border-l-rose-500' },
];

function matchSubject(subject: string): typeof SUBJECT_STYLES[0] | undefined {
  const s = subject.toLowerCase();
  return SUBJECT_STYLES.find(entry => entry.keywords.some(k => s.includes(k)));
}

/** Neutral cell surface. Subject identity = left border + title color. */
export function getSubjectColorClass(_subject?: string | null): string {
  return 'bg-card hover:bg-muted/40 text-foreground border-border';
}

export function getSubjectLeftBorderClass(subject?: string | null): string {
  if (!subject) return 'border-l-[3px] border-l-border';
  return `border-l-[3px] ${matchSubject(subject)?.leftBorderClass ?? 'border-l-accent'}`;
}

export function getSubjectAccentTextClass(subject?: string | null): string {
  if (!subject) return 'text-foreground';
  return matchSubject(subject)?.accentText ?? 'text-accent';
}

export function getSubjectBadgeClass(subject?: string | null): string {
  return getSubjectColorClass(subject);
}

export const subjectColors: Record<string, string> = {};
