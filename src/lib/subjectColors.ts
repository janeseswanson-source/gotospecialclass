// Shared subject color tokens used by schedule cells and badges.
// Uses keyword matching so subjects like "Physical Education" and "PE" both match.

const SUBJECT_STYLES: Array<{
  keywords: string[];
  colorClass: string;
  leftBorderClass: string;
}> = [
  { keywords: ['art'], colorClass: 'bg-purple/20 text-purple border-purple/30', leftBorderClass: 'border-l-purple' },
  { keywords: ['music'], colorClass: 'bg-primary/15 text-primary border-primary/30', leftBorderClass: 'border-l-primary' },
  { keywords: ['pe', 'physical', 'gym'], colorClass: 'bg-success/15 text-success border-success/30', leftBorderClass: 'border-l-success' },
  { keywords: ['library', 'media'], colorClass: 'bg-warning/20 text-warning-foreground border-warning/30', leftBorderClass: 'border-l-warning' },
  { keywords: ['tech', 'computer'], colorClass: 'bg-[hsl(190,70%,45%)]/15 text-[hsl(190,70%,35%)] border-[hsl(190,70%,45%)]/30', leftBorderClass: 'border-l-[hsl(190,70%,45%)]' },
  { keywords: ['science', 'stem'], colorClass: 'bg-destructive/15 text-destructive border-destructive/30', leftBorderClass: 'border-l-destructive' },
  { keywords: ['spanish', 'language', 'foreign'], colorClass: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30', leftBorderClass: 'border-l-orange-500' },
  { keywords: ['drama', 'theater', 'theatre'], colorClass: 'bg-pink-500/15 text-pink-700 dark:text-pink-400 border-pink-500/30', leftBorderClass: 'border-l-pink-500' },
  { keywords: ['dance'], colorClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30', leftBorderClass: 'border-l-rose-500' },
];

function matchSubject(subject: string): typeof SUBJECT_STYLES[0] | undefined {
  const s = subject.toLowerCase();
  return SUBJECT_STYLES.find(entry => entry.keywords.some(k => s.includes(k)));
}

export function getSubjectColorClass(subject?: string | null): string {
  if (!subject) return 'bg-muted/50 text-muted-foreground border-border';
  return matchSubject(subject)?.colorClass ?? 'bg-accent/15 text-accent-foreground border-accent/30';
}

export function getSubjectLeftBorderClass(subject?: string | null): string {
  if (!subject) return 'border-l-2 border-l-border';
  return `border-l-2 ${matchSubject(subject)?.leftBorderClass ?? 'border-l-accent'}`;
}

export function getSubjectBadgeClass(subject?: string | null): string {
  return getSubjectColorClass(subject);
}

// Legacy exact-key map kept for any direct consumers.
export const subjectColors: Record<string, string> = {
  Art: 'bg-purple/20 text-purple border-purple/30',
  Music: 'bg-primary/15 text-primary border-primary/30',
  PE: 'bg-success/15 text-success border-success/30',
  Library: 'bg-warning/20 text-warning-foreground border-warning/30',
  Technology: 'bg-[hsl(190,70%,45%)]/15 text-[hsl(190,70%,35%)] border-[hsl(190,70%,45%)]/30',
  Science: 'bg-destructive/15 text-destructive border-destructive/30',
};
