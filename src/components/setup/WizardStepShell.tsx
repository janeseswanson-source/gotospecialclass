import { ReactNode, useEffect, useState } from 'react';
import { Lightbulb, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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

const STORAGE_KEY = 'wizard.rail.collapsed';

/**
 * Persistent shell rendered around every wizard step.
 * The "why this step" rail is collapsible (40px collapsed, ~240px expanded)
 * and on small screens collapses into a popover above the content.
 */
const WizardStepShell = ({ title, blurb, why, bullets, aiActions, children, className }: WizardStepShellProps) => {
  const hasRail = !!(why || (bullets && bullets.length) || aiActions);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === '1';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  const RailContent = (
    <div className="space-y-3">
      <div className="rounded-xl border border-primary/15 bg-primary/5 p-3 space-y-2">
        <div className="flex items-center gap-2 text-primary">
          <Lightbulb className="h-3.5 w-3.5" />
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
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-3 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-accent">AI shortcuts</div>
          <div className="space-y-2">{aiActions}</div>
        </div>
      )}
    </div>
  );

  if (!hasRail) {
    return <div className={cn('w-full', className)}>{children}</div>;
  }

  return (
    <div className={cn('w-full min-w-0', className)}>
      {/* Mobile / narrow: popover pill */}
      <div className="lg:hidden mb-3">
        <Popover>
          <PopoverTrigger className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs text-primary hover:bg-primary/10">
            <Lightbulb className="h-3 w-3" />
            Why this step?
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80">
            {RailContent}
          </PopoverContent>
        </Popover>
      </div>

      {/* Desktop: collapsible rail */}
      <div
        className={cn(
          'hidden lg:grid gap-4 min-w-0',
          collapsed ? 'grid-cols-[36px_minmax(0,1fr)]' : 'grid-cols-[240px_minmax(0,1fr)]',
        )}
      >
        <aside className="lg:sticky lg:top-4 lg:self-start min-w-0">
          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              title="Show step tips"
              className="flex h-full min-h-[80px] w-9 flex-col items-center justify-start gap-2 rounded-xl border border-primary/15 bg-primary/5 py-3 text-primary hover:bg-primary/10"
            >
              <Lightbulb className="h-3.5 w-3.5" />
              <ChevronRight className="h-3 w-3" />
            </button>
          ) : (
            <div className="relative">
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                title="Hide step tips"
                className="absolute -right-2 top-2 z-10 rounded-full border border-border bg-background p-0.5 text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              {RailContent}
            </div>
          )}
        </aside>
        <div className="min-w-0">{children}</div>
      </div>

      {/* Mobile content */}
      <div className="lg:hidden min-w-0">{children}</div>
    </div>
  );
};

export default WizardStepShell;
