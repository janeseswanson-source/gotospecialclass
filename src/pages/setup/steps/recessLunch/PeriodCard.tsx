import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Sun, Utensils, Cloud } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PeriodKey = 'amRecess' | 'lunch' | 'pmRecess';

export interface PeriodRow {
  rowId: string;
  bandKey: string;
  label: string;
  grades: string[];
  start: string;
  end: string;
  erStart?: string;
  erEnd?: string;
}

interface Props {
  period: PeriodKey;
  rows: PeriodRow[];
  gradesServed: string[];
  showGrades: boolean;        // staggered mode
  showEarlyRelease: boolean;
  onAddRow: (period: PeriodKey) => void;
  onRemoveRow: (period: PeriodKey, rowId: string) => void;
  onUpdate: (period: PeriodKey, rowId: string, patch: Partial<PeriodRow>) => void;
}

const META: Record<PeriodKey, { title: string; Icon: any; accent: string }> = {
  amRecess: { title: 'AM Recess', Icon: Sun, accent: 'text-amber-600 dark:text-amber-300' },
  lunch:    { title: 'Lunch',     Icon: Utensils, accent: 'text-amber-700 dark:text-amber-200' },
  pmRecess: { title: 'PM Recess', Icon: Cloud, accent: 'text-amber-600 dark:text-amber-300' },
};

const PeriodCard = ({ period, rows, gradesServed, showGrades, showEarlyRelease, onAddRow, onRemoveRow, onUpdate }: Props) => {
  const { title, Icon, accent } = META[period];

  const coverage = useMemo(() => {
    const counts: Record<string, number> = {};
    rows.forEach(r => r.grades.forEach(g => { counts[g] = (counts[g] || 0) + 1; }));
    const missing = gradesServed.filter(g => !counts[g]);
    const dup = Object.keys(counts).filter(g => counts[g] > 1);
    return { missing, dup };
  }, [rows, gradesServed]);

  return (
    <div className="rounded-xl border border-amber-300/50 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-950/20">
      <div className="flex items-center justify-between gap-3 border-b border-amber-300/40 dark:border-amber-500/20 px-4 py-2">
        <div className={cn('flex items-center gap-2 text-sm font-semibold', accent)}>
          <Icon className="h-4 w-4" />
          <span>{title}</span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {rows.length === 0 ? 'Not scheduled' : `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}
        </span>
      </div>

      <div className="p-3 space-y-2">
        {rows.length === 0 && (
          <p className="text-xs italic text-muted-foreground px-1">No times set — add a row to enable.</p>
        )}

        {rows.map(row => (
          <div key={row.rowId} className="rounded-lg border border-border bg-background p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={row.label}
                onChange={(e) => onUpdate(period, row.rowId, { label: e.target.value })}
                placeholder={rows.length > 1 ? 'e.g. Early lunch' : title}
                className="h-8 text-sm flex-1"
              />
              <Input
                type="time"
                value={row.start}
                onChange={(e) => onUpdate(period, row.rowId, { start: e.target.value })}
                className="h-8 text-xs w-[110px]"
                aria-label="Start"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                type="time"
                value={row.end}
                onChange={(e) => onUpdate(period, row.rowId, { end: e.target.value })}
                className="h-8 text-xs w-[110px]"
                aria-label="End"
              />
              <Button size="sm" variant="ghost" onClick={() => onRemoveRow(period, row.rowId)} aria-label="Remove row">
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>

            {showGrades && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {gradesServed.map(g => {
                  const selected = row.grades.includes(g);
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => {
                        const next = selected ? row.grades.filter(x => x !== g) : [...row.grades, g];
                        onUpdate(period, row.rowId, { grades: next });
                      }}
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-muted-foreground hover:border-primary/40',
                      )}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            )}

            {showEarlyRelease && (
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-dashed border-border">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Early-release start</label>
                  <Input
                    type="time"
                    value={row.erStart || ''}
                    onChange={(e) => onUpdate(period, row.rowId, { erStart: e.target.value })}
                    className="h-7 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Early-release end</label>
                  <Input
                    type="time"
                    value={row.erEnd || ''}
                    onChange={(e) => onUpdate(period, row.rowId, { erEnd: e.target.value })}
                    className="h-7 text-xs"
                  />
                </div>
              </div>
            )}
          </div>
        ))}

        <Button size="sm" variant="outline" onClick={() => onAddRow(period)} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> {rows.length === 0 ? 'Add row' : 'Add staggered row'}
        </Button>

        {(coverage.missing.length > 0 || coverage.dup.length > 0) && rows.length > 0 && showGrades && (
          <div className="text-[11px] text-muted-foreground pt-1 space-y-0.5">
            {coverage.missing.length > 0 && (
              <div>Not covered: <span className="font-medium text-amber-700 dark:text-amber-300">{coverage.missing.join(', ')}</span></div>
            )}
            {coverage.dup.length > 0 && (
              <div>In multiple rows: <span className="font-medium text-destructive">{coverage.dup.join(', ')}</span></div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PeriodCard;
