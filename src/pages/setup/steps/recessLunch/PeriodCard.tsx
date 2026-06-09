import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Sun, Utensils, Cloud, ChevronDown } from 'lucide-react';
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
  showEarlyRelease: boolean;  // entire card is ER overrides (collapsible section)
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
  const [openErForRow, setOpenErForRow] = useState<Set<string>>(new Set());

  const coverage = useMemo(() => {
    const counts: Record<string, number> = {};
    rows.forEach(r => r.grades.forEach(g => { counts[g] = (counts[g] || 0) + 1; }));
    const missing = gradesServed.filter(g => !counts[g]);
    const dup = Object.keys(counts).filter(g => counts[g] > 1);
    return { missing, dup };
  }, [rows, gradesServed]);

  const toggleEr = (rowId: string) => {
    setOpenErForRow(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      return next;
    });
  };

  return (
    <div className="min-w-0 rounded-xl border border-amber-300/50 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-950/20">
      <div className="flex items-center justify-between gap-3 border-b border-amber-300/40 dark:border-amber-500/20 px-3 py-2">
        <div className={cn('flex items-center gap-2 text-sm font-semibold', accent)}>
          <Icon className="h-4 w-4" />
          <span>{title}</span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {rows.length === 0 ? 'Not scheduled' : `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}
        </span>
      </div>

      <div className="p-2.5 space-y-2">
        {rows.length === 0 && (
          <p className="text-xs italic text-muted-foreground px-1">No times set — add a row to enable.</p>
        )}

        {rows.map(row => {
          const erOpen = openErForRow.has(row.rowId);
          return (
            <div key={row.rowId} className="rounded-lg border border-border bg-background p-2.5 space-y-2 min-w-0">
              {/* Label + delete */}
              <div className="flex items-center gap-1.5 min-w-0">
                <Input
                  value={row.label}
                  onChange={(e) => onUpdate(period, row.rowId, { label: e.target.value })}
                  placeholder={rows.length > 1 ? 'e.g. Early lunch' : title}
                  className="h-8 text-sm flex-1 min-w-0"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={() => onRemoveRow(period, row.rowId)}
                  aria-label="Remove row"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>

              {/* Times on their own row */}
              <div className="flex items-center gap-1.5 min-w-0">
                <Input
                  type="time"
                  value={row.start}
                  onChange={(e) => onUpdate(period, row.rowId, { start: e.target.value })}
                  className="h-8 text-xs flex-1 min-w-0"
                  aria-label="Start"
                />
                <span className="text-xs text-muted-foreground shrink-0">→</span>
                <Input
                  type="time"
                  value={row.end}
                  onChange={(e) => onUpdate(period, row.rowId, { end: e.target.value })}
                  className="h-8 text-xs flex-1 min-w-0"
                  aria-label="End"
                />
              </div>

              {showGrades && (
                <div className="space-y-1 pt-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Grades</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="text-[10px] text-primary hover:underline"
                        onClick={() => onUpdate(period, row.rowId, { grades: [...gradesServed] })}
                      >
                        All
                      </button>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <button
                        type="button"
                        className="text-[10px] text-muted-foreground hover:underline"
                        onClick={() => onUpdate(period, row.rowId, { grades: [] })}
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
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
                            'rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
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
                </div>
              )}

              {showEarlyRelease && (
                <div className="pt-1.5 border-t border-dashed border-border">
                  <button
                    type="button"
                    onClick={() => toggleEr(row.rowId)}
                    className="flex w-full items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    <span>Early-release override</span>
                    <ChevronDown className={cn('h-3 w-3 transition-transform', erOpen && 'rotate-180')} />
                  </button>
                  {erOpen && (
                    <div className="flex items-center gap-1.5 pt-1.5 min-w-0">
                      <Input
                        type="time"
                        value={row.erStart || ''}
                        onChange={(e) => onUpdate(period, row.rowId, { erStart: e.target.value })}
                        className="h-7 text-xs flex-1 min-w-0"
                        aria-label="ER start"
                      />
                      <span className="text-xs text-muted-foreground shrink-0">→</span>
                      <Input
                        type="time"
                        value={row.erEnd || ''}
                        onChange={(e) => onUpdate(period, row.rowId, { erEnd: e.target.value })}
                        className="h-7 text-xs flex-1 min-w-0"
                        aria-label="ER end"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <Button size="sm" variant="outline" onClick={() => onAddRow(period)} className="gap-1 w-full">
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
