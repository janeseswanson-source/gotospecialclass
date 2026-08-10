import { History, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSetup } from '@/contexts/SetupContext';

function whenLabel(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'earlier';
  const sameDay = new Date().toDateString() === then.toDateString();
  const time = then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return sameDay
    ? `today at ${time}`
    : `${then.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}`;
}

/**
 * Offers back an unfinished setup session found in localStorage.
 *
 * Opt-in by design: silently replaying a stale draft over freshly-loaded
 * database values would be its own kind of data loss. Shown only when a draft
 * exists, and dismissed for good by either button.
 */
export function DraftRestoreBanner() {
  const { draftAvailable, restoreDraft, discardDraft } = useSetup();
  if (!draftAvailable) return null;

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2.5">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="text-sm">
          <p className="font-medium text-foreground">We kept your unfinished setup</p>
          <p className="text-xs text-muted-foreground">
            Last edited {whenLabel(draftAvailable.savedAt)} on this device. Restore it, or start from what's saved.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" onClick={restoreDraft}>Restore</Button>
        <Button size="sm" variant="ghost" onClick={discardDraft}>
          <X className="mr-1 h-3.5 w-3.5" /> Discard
        </Button>
      </div>
    </div>
  );
}

export default DraftRestoreBanner;
