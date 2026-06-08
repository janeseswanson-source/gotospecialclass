import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  status: SaveStatus;
  className?: string;
}

/**
 * Uniform autosave indicator used across the setup wizard steps.
 * Renders nothing when idle so it doesn't take layout space.
 */
export function SaveStatusIndicator({ status, className }: Props) {
  if (status === 'idle') return null;
  return (
    <span className={cn('text-xs text-muted-foreground flex items-center gap-1 shrink-0', className)}>
      {status === 'saving' && (<><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>)}
      {status === 'saved' && (<><Check className="h-3 w-3 text-primary" /> Saved</>)}
      {status === 'error' && (<span className="text-destructive">Save failed</span>)}
    </span>
  );
}
