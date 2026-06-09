import { ReactNode } from 'react';
import { Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RationaleBullet {
  label: string;
  detail?: string;
}

interface WizardStepShellProps {
  title: string;
  blurb?: string;
  why?: string;
  bullets?: RationaleBullet[];
  aiActions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Persistent shell rendered around every wizard step.
 * Provides a left rationale rail explaining *why this step matters*
 * and an optional slot for step-level AI shortcuts.
 */
const WizardStepShell = ({ title, blurb, why, bullets, aiActions, children, className }: WizardStepShellProps) => {
  const hasRail = !!(why || (bullets && bullets.length) || aiActions);

  return (
    <div className={cn('w-full', className)}>
      <div className={cn('grid gap-5', hasRail ? 'lg:grid-cols-[260px_minmax(0,1fr)]' : 'grid-cols-1')}>
        {hasRail && (
          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <div className="rounded-xl border border-primary/15 bg-primary/5 p-4 space-y-2">
              <div className="flex items-center gap-2 text-primary">
                <Lightbulb className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Why this step</span>
              </div>
              {why && <p className="text-xs leading-relaxed text-foreground/80">{why}</p>}
              {bullets && bullets.length > 0 && (
                <ul className="space-y-1.5 text-xs text-foreground/75">
                  {bullets.map((b, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-primary">•</span>
                      <span>
                        <span className="font-medium text-foreground">{b.label}</span>
                        {b.detail && <span className="text-muted-foreground"> — {b.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {aiActions && (
              <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-accent">AI shortcuts</div>
                <div className="space-y-2">{aiActions}</div>
              </div>
            )}
          </aside>
        )}

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
};

export default WizardStepShell;
