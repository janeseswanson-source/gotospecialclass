import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getStrategyTitle } from '@/lib/conflictStrategies';

interface SlotCell { label: string; tone?: 'normal' | 'highlight' | 'muted' }
interface PreviewData {
  blurb: string;
  headers: string[]; // first column is time, others are days
  rows: { time: string; cells: SlotCell[] }[];
}

const PREVIEWS: Record<string, PreviewData> = {
  ab_week: {
    blurb: 'On Week A the specialist sees one class; on Week B they see the other. Each class gets one session per two-week cycle.',
    headers: ['Time', 'Mon (Week A)', 'Mon (Week B)'],
    rows: [
      { time: '9:00', cells: [{ label: '' }, { label: 'Grade 3-A · Music', tone: 'highlight' }, { label: 'Grade 3-B · Music', tone: 'highlight' }] },
      { time: '9:45', cells: [{ label: '' }, { label: '—', tone: 'muted' }, { label: '—', tone: 'muted' }] },
    ],
  },
  aa_bb_week: {
    blurb: 'A class gets two consecutive sessions, then the specialist rotates to the next class for two sessions.',
    headers: ['Time', 'Mon', 'Wed'],
    rows: [
      { time: '9:00', cells: [{ label: '' }, { label: 'Grade 3-A · Art', tone: 'highlight' }, { label: 'Grade 3-A · Art', tone: 'highlight' }] },
      { time: '10:00', cells: [{ label: '' }, { label: 'Grade 3-B · Art', tone: 'highlight' }, { label: 'Grade 3-B · Art', tone: 'highlight' }] },
    ],
  },
  quick_30: {
    blurb: 'Selected grades (often K–1) get 30-minute sessions instead of 45, freeing slots elsewhere.',
    headers: ['Time', 'Mon', 'Tue'],
    rows: [
      { time: '9:00', cells: [{ label: '' }, { label: 'Kinder · PE (30m)', tone: 'highlight' }, { label: 'Kinder · Music (30m)', tone: 'highlight' }] },
      { time: '9:30', cells: [{ label: '' }, { label: 'Grade 3 · PE (45m)' }, { label: 'Grade 3 · Music (45m)' }] },
    ],
  },
  lunch_clubs: {
    blurb: 'Lunch clubs fill open lunch slots, adding teaching minutes for the specialist.',
    headers: ['Time', 'Mon', 'Tue'],
    rows: [
      { time: '11:30', cells: [{ label: '' }, { label: 'Doodle Club (K–2)', tone: 'highlight' }, { label: '—', tone: 'muted' }] },
      { time: '12:00', cells: [{ label: '' }, { label: 'Lunch' }, { label: 'Art Apprentice (4–5)', tone: 'highlight' }] },
    ],
  },
  event_planning: {
    blurb: 'Reserves blocks on the specialist schedule for school-wide events like Art Show or STEAM Night.',
    headers: ['Time', 'Thu', 'Fri'],
    rows: [
      { time: '1:00', cells: [{ label: '' }, { label: 'Art Show Prep', tone: 'highlight' }, { label: 'Art Show Prep', tone: 'highlight' }] },
      { time: '2:00', cells: [{ label: '' }, { label: 'Grade 4 · Art' }, { label: 'Grade 5 · Art' }] },
    ],
  },
  big_group: {
    blurb: 'Two classes from the same grade combine into one larger group sharing a single specialist slot.',
    headers: ['Time', 'Mon'],
    rows: [
      { time: '10:00', cells: [{ label: '' }, { label: 'Grade 3-A + 3-B · PE (combined)', tone: 'highlight' }] },
      { time: '10:45', cells: [{ label: '' }, { label: 'Grade 4-A · PE' }] },
    ],
  },
  makeup: {
    blurb: 'When a class is missed, the scheduler suggests an open flex slot to make up the session.',
    headers: ['Time', 'Wed'],
    rows: [
      { time: '1:00', cells: [{ label: '' }, { label: 'Grade 2-A · Music (make-up)', tone: 'highlight' }] },
      { time: '1:45', cells: [{ label: '' }, { label: 'Open flex' }] },
    ],
  },
};

/** Plain-language "what your week will look like" line for a strategy (or null). */
export function getStrategyPreviewBlurb(strategyKey: string): string | null {
  return PREVIEWS[strategyKey]?.blurb ?? null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strategyKey: string | null;
}

export const StrategyPreviewModal = ({ open, onOpenChange, strategyKey }: Props) => {
  const data = strategyKey ? PREVIEWS[strategyKey] : null;
  const title = strategyKey ? getStrategyTitle(strategyKey) : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Preview: {title}</DialogTitle>
        </DialogHeader>
        {data ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{data.blurb}</p>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-secondary/40 text-muted-foreground">
                  <tr>
                    {data.headers.map(h => (
                      <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1.5 font-medium text-foreground">{row.time}</td>
                      {row.cells.slice(1).map((c, j) => (
                        <td key={j} className={cellClass(c.tone)}>{c.label}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] italic text-muted-foreground">
              This is a sample preview — your real schedule will use your actual classes and specialists.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No preview available.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

function cellClass(tone?: 'normal' | 'highlight' | 'muted') {
  if (tone === 'highlight') return 'px-2 py-1.5 bg-primary/10 text-primary font-medium';
  if (tone === 'muted') return 'px-2 py-1.5 text-muted-foreground italic';
  return 'px-2 py-1.5 text-foreground';
}

export default StrategyPreviewModal;
