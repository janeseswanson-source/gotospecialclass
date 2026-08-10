import { AlertTriangle, Check, Loader2, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  status: SaveStatus;
  className?: string;
  /** Shown on hover of the error state — the raw DB message. */
  errorMessage?: string | null;
  /** When provided, the error state offers a Retry affordance. */
  onRetry?: () => void;
}

/**
 * Uniform autosave indicator used across the setup wizard steps.
 * Renders nothing when idle so it doesn't take layout space.
 *
 * The error state is deliberately loud and never auto-clears: a silent failure
 * once let a coordinator fill in an entire wizard that was saving nothing.
 */
export function SaveStatusIndicator({ status, className, errorMessage, onRetry }: Props) {
  if (status === 'idle') return null;

  if (status === 'error') {
    return (
      <span
        title={errorMessage ?? undefined}
        className={cn(
          'text-xs flex items-center gap-1.5 shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 font-medium text-destructive',
          className,
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5" /> Not saved
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="ml-0.5 inline-flex items-center gap-1 underline underline-offset-2 hover:no-underline"
          >
            <RotateCw className="h-3 w-3" /> Retry
          </button>
        )}
      </span>
    );
  }

  return (
    <span className={cn('text-xs text-muted-foreground flex items-center gap-1 shrink-0', className)}>
      {status === 'saving' && (<><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>)}
      {status === 'saved' && (<><Check className="h-3 w-3 text-primary" /> Saved</>)}
    </span>
  );
}
