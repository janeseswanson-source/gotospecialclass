import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { SaveStatusIndicator, type SaveStatus } from '@/components/setup/SaveStatusIndicator';
import { SETUP_STEPS } from '../stepIndex';
import { useFlushOnUnmount } from '@/hooks/useFlushOnUnmount';
import { useSetup } from '@/contexts/SetupContext';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import PeriodCard, { PeriodKey, PeriodRow } from './recessLunch/PeriodCard';

type CardsState = Record<PeriodKey, PeriodRow[]>;

const PERIOD_ORDER: PeriodKey[] = ['amRecess', 'lunch', 'pmRecess'];
const PERIOD_LABEL: Record<PeriodKey, string> = {
  amRecess: 'AM Recess',
  lunch: 'Lunch',
  pmRecess: 'PM Recess',
};

const genBandKey = () => `band_${Math.random().toString(36).slice(2, 8)}`;
const genRowId = () => `r_${Math.random().toString(36).slice(2, 10)}`;

interface ConfigRow {
  grade_band: string;
  am_recess_start: string | null; am_recess_end: string | null;
  lunch_start: string | null; lunch_end: string | null;
  pm_recess_start: string | null; pm_recess_end: string | null;
  early_release_am_recess_start: string | null; early_release_am_recess_end: string | null;
  early_release_lunch_start: string | null; early_release_lunch_end: string | null;
  early_release_pm_recess_start: string | null; early_release_pm_recess_end: string | null;
}

interface StoredBand { key: string; label: string; grades: string[] }

const DEFAULT_BANDS = (gradesServed: string[]): StoredBand[] => {
  const k = gradesServed.filter(g => g === 'K' || g === 'PK' || g.toLowerCase() === 'kindergarten');
  const primary = gradesServed.filter(g => ['1', '2', '3'].includes(g));
  const intermediate = gradesServed.filter(g => ['4', '5', '6'].includes(g));
  const out: StoredBand[] = [];
  if (k.length) out.push({ key: 'kindergarten', label: 'Kindergarten', grades: k });
  if (primary.length) out.push({ key: 'primary', label: 'Primary 1-3', grades: primary });
  if (intermediate.length) out.push({ key: 'intermediate', label: 'Intermediate 4-6', grades: intermediate });
  if (out.length === 0 && gradesServed.length) out.push({ key: 'all', label: 'Whole School', grades: [...gradesServed] });
  return out;
};

const periodColumns = (p: PeriodKey): { start: keyof ConfigRow; end: keyof ConfigRow; erStart: keyof ConfigRow; erEnd: keyof ConfigRow } => {
  switch (p) {
    case 'amRecess': return { start: 'am_recess_start', end: 'am_recess_end', erStart: 'early_release_am_recess_start', erEnd: 'early_release_am_recess_end' };
    case 'lunch':    return { start: 'lunch_start', end: 'lunch_end', erStart: 'early_release_lunch_start', erEnd: 'early_release_lunch_end' };
    case 'pmRecess': return { start: 'pm_recess_start', end: 'pm_recess_end', erStart: 'early_release_pm_recess_start', erEnd: 'early_release_pm_recess_end' };
  }
};

const StepRecessLunch = () => {
  const { data, updateData, setStep, schoolId } = useSetup();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [cards, setCards] = useState<CardsState>({ amRecess: [], lunch: [], pmRecess: [] });
  const [erOpen, setErOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const isLoaded = useRef(false);

  const gradesServed = data.gradesServed || [];
  const isStaggered = data.scheduleType === 'staggered';
  const hasEarlyRelease = !!data.earlyReleaseDay;

  // ------- Hydration -------
  useEffect(() => {
    if (!schoolId) { isLoaded.current = true; return; }
    const load = async () => {
      const [{ data: rows }, { data: school }] = await Promise.all([
        supabase.from('recess_lunch_config').select('*').eq('school_id', schoolId),
        supabase.from('schools').select('recess_grade_bands').eq('id', schoolId).maybeSingle(),
      ]);

      const storedBands: StoredBand[] = Array.isArray((school as any)?.recess_grade_bands)
        ? (school as any).recess_grade_bands
        : DEFAULT_BANDS(gradesServed);

      const bandByKey = new Map(storedBands.map(b => [b.key, b]));
      const next: CardsState = { amRecess: [], lunch: [], pmRecess: [] };

      const configRows = (rows ?? []) as any[];

      if (configRows.length === 0) {
        // No existing config — seed empty cards so the user has something to fill in
        const seed = storedBands[0] ?? { key: 'all', label: 'Whole School', grades: [...gradesServed] };
        PERIOD_ORDER.forEach(p => {
          next[p] = [{
            rowId: genRowId(),
            bandKey: seed.key,
            label: PERIOD_LABEL[p],
            grades: [...seed.grades],
            start: '', end: '',
          }];
        });
      } else {
        configRows.forEach((r) => {
          const band = bandByKey.get(r.grade_band) ?? { key: r.grade_band, label: r.grade_band === 'all' ? 'Whole School' : r.grade_band, grades: [...gradesServed] };
          PERIOD_ORDER.forEach(p => {
            const cols = periodColumns(p);
            const start = (r as any)[cols.start] || '';
            const end = (r as any)[cols.end] || '';
            const erStart = (r as any)[cols.erStart] || '';
            const erEnd = (r as any)[cols.erEnd] || '';
            if (start || end || erStart || erEnd) {
              next[p].push({
                rowId: genRowId(),
                bandKey: band.key,
                label: configRows.length > 1 ? `${PERIOD_LABEL[p]} · ${band.label}` : PERIOD_LABEL[p],
                grades: [...band.grades],
                start, end,
                erStart: erStart || undefined,
                erEnd: erEnd || undefined,
              });
            }
          });
        });
      }

      setCards(next);
      isLoaded.current = true;
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  // ------- Validation -------
  const validation = useMemo(() => {
    const issues: string[] = [];
    PERIOD_ORDER.forEach(p => {
      cards[p].forEach((r, i) => {
        if (!r.label.trim()) issues.push(`${PERIOD_LABEL[p]} row ${i + 1} needs a label`);
        if ((r.start && !r.end) || (!r.start && r.end)) issues.push(`${PERIOD_LABEL[p]} "${r.label || i + 1}" missing start or end`);
        if (r.start && r.end && r.start >= r.end) issues.push(`${PERIOD_LABEL[p]} "${r.label}" — end must be after start`);
        if (isStaggered && r.grades.length === 0) issues.push(`${PERIOD_LABEL[p]} "${r.label}" — pick at least one grade`);
      });
    });
    return { issues, hasError: issues.length > 0 };
  }, [cards, isStaggered]);

  // ------- Persistence -------
  const buildPayload = useCallback(() => {
    // Unique bands across all rows
    const bandIndex = new Map<string, StoredBand>();
    PERIOD_ORDER.forEach(p => cards[p].forEach(r => {
      if (!bandIndex.has(r.bandKey)) {
        bandIndex.set(r.bandKey, { key: r.bandKey, label: r.label, grades: r.grades });
      }
    }));

    // Build one recess_lunch_config row per bandKey
    const configRows: any[] = [];
    bandIndex.forEach((_, bandKey) => {
      const row: any = { grade_band: bandKey };
      let hasAny = false;
      PERIOD_ORDER.forEach(p => {
        const cols = periodColumns(p);
        const r = cards[p].find(x => x.bandKey === bandKey);
        if (r) {
          row[cols.start] = r.start || null;
          row[cols.end] = r.end || null;
          row[cols.erStart] = r.erStart || null;
          row[cols.erEnd] = r.erEnd || null;
          if (r.start || r.end || r.erStart || r.erEnd) hasAny = true;
        } else {
          row[cols.start] = null; row[cols.end] = null;
          row[cols.erStart] = null; row[cols.erEnd] = null;
        }
      });
      if (hasAny) configRows.push(row);
      else bandIndex.delete(bandKey);
    });

    return {
      configRows,
      storedBands: Array.from(bandIndex.values()),
    };
  }, [cards]);

  const autoSave = useCallback(async () => {
    if (!schoolId || !isLoaded.current) return;
    if (validation.hasError) { setSaveStatus('idle'); return; }
    setSaveStatus('saving');
    try {
      const { configRows, storedBands } = buildPayload();

      // Selective delete + insert (keeps RLS-safe, simple).
      await supabase.from('recess_lunch_config').delete().eq('school_id', schoolId);
      if (configRows.length > 0) {
        const rows = configRows.map(r => ({ ...r, school_id: schoolId }));
        const { error } = await supabase.from('recess_lunch_config').insert(rows);
        if (error) throw error;
      }

      const { error: schoolErr } = await supabase.from('schools').update({
        schedule_type: data.scheduleType,
        recess_grade_bands: storedBands as any,
      } as any).eq('id', schoolId);
      if (schoolErr) throw schoolErr;

      // Mirror to setup context so other steps (Clubs default times) keep working
      const mirror: Record<string, any> = {};
      configRows.forEach(r => {
        mirror[r.grade_band] = {
          amRecessStart: r.am_recess_start || '', amRecessEnd: r.am_recess_end || '',
          lunchStart: r.lunch_start || '', lunchEnd: r.lunch_end || '',
          pmRecessStart: r.pm_recess_start || '', pmRecessEnd: r.pm_recess_end || '',
          earlyReleaseAmRecessStart: r.early_release_am_recess_start || '',
          earlyReleaseAmRecessEnd: r.early_release_am_recess_end || '',
          earlyReleaseLunchStart: r.early_release_lunch_start || '',
          earlyReleaseLunchEnd: r.early_release_lunch_end || '',
          earlyReleasePmRecessStart: r.early_release_pm_recess_start || '',
          earlyReleasePmRecessEnd: r.early_release_pm_recess_end || '',
        };
      });
      updateData({ recessConfig: mirror });

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch (err) {
      console.error('[StepRecessLunch] save failed', err);
      toast.error('Failed to save recess configuration');
      setSaveStatus('idle');
    }
  }, [schoolId, buildPayload, validation.hasError, data.scheduleType, updateData]);

  useFlushOnUnmount(saveTimer, () => { if (isLoaded.current) autoSave(); });

  useEffect(() => {
    if (!isLoaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => autoSave(), 800);
  }, [autoSave]);

  // ------- Mutations -------
  const updateRow = (period: PeriodKey, rowId: string, patch: Partial<PeriodRow>) => {
    setCards(prev => ({
      ...prev,
      [period]: prev[period].map(r => r.rowId === rowId ? { ...r, ...patch } : r),
    }));
  };

  const addRow = (period: PeriodKey) => {
    setCards(prev => {
      const existing = prev[period];
      const firstAcrossAll = PERIOD_ORDER.flatMap(p => prev[p])[0];
      const fallbackGrades = firstAcrossAll?.grades ?? [...gradesServed];

      let bandKey: string;
      let label: string;
      let grades: string[];

      if (existing.length === 0) {
        bandKey = firstAcrossAll?.bandKey || 'all';
        label = PERIOD_LABEL[period];
        grades = fallbackGrades;
      } else {
        // Adding staggered row → new bandKey
        bandKey = genBandKey();
        label = `${PERIOD_LABEL[period]} (group ${existing.length + 1})`;
        // Remaining grades = grades not covered by existing rows in this period
        const taken = new Set(existing.flatMap(r => r.grades));
        const leftover = gradesServed.filter(g => !taken.has(g));
        grades = leftover.length ? leftover : fallbackGrades;
        if (!isStaggered) updateData({ scheduleType: 'staggered' });
      }

      return {
        ...prev,
        [period]: [...existing, { rowId: genRowId(), bandKey, label, grades, start: '', end: '' }],
      };
    });
  };

  const removeRow = (period: PeriodKey, rowId: string) => {
    setCards(prev => ({
      ...prev,
      [period]: prev[period].filter(r => r.rowId !== rowId),
    }));
  };

  const toggleMode = (next: 'whole_school' | 'staggered') => {
    if (next === data.scheduleType) return;
    if (next === 'whole_school') {
      // Collapse each period to its first row, covering all grades served
      const anyStaggered = PERIOD_ORDER.some(p => cards[p].length > 1);
      if (anyStaggered && !confirm('Switching to Whole School will keep only the first row of each period. Continue?')) return;
      setCards(prev => {
        const next: CardsState = { amRecess: [], lunch: [], pmRecess: [] };
        PERIOD_ORDER.forEach(p => {
          const first = prev[p][0];
          if (first) next[p] = [{ ...first, bandKey: 'all', label: PERIOD_LABEL[p], grades: [...gradesServed] }];
        });
        return next;
      });
    }
    updateData({ scheduleType: next });
  };

  // ------- Render -------
  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-card-foreground">Recess & Lunch</h2>
          <p className="text-sm text-muted-foreground">Protected windows so the scheduler avoids placing specialist classes here.</p>
        </div>
        <SaveStatusIndicator status={saveStatus} />
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2">
        {(['whole_school', 'staggered'] as const).map(type => (
          <button
            key={type}
            onClick={() => toggleMode(type)}
            className={cn(
              'rounded-lg border-2 px-4 py-2 text-sm font-medium transition-all',
              data.scheduleType === type
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/30',
            )}
          >
            {type === 'whole_school' ? 'Whole School' : 'Staggered by Grade'}
          </button>
        ))}
      </div>

      {gradesServed.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4">
          <p className="text-sm text-muted-foreground">
            No grades selected yet.{' '}
            <button onClick={() => setStep(SETUP_STEPS.SCHOOL_INFO)} className="text-primary hover:underline">
              Add grades served in School Info →
            </button>
          </p>
        </div>
      ) : (
        <>
          {/* Three period cards */}
          <div className="grid gap-3 md:grid-cols-3">
            {PERIOD_ORDER.map(p => (
              <PeriodCard
                key={p}
                period={p}
                rows={cards[p]}
                gradesServed={gradesServed}
                showGrades={isStaggered}
                showEarlyRelease={false}
                onAddRow={addRow}
                onRemoveRow={removeRow}
                onUpdate={updateRow}
              />
            ))}
          </div>

          {/* Early release block */}
          {hasEarlyRelease ? (
            <Collapsible open={erOpen} onOpenChange={setErOpen}>
              <div className="rounded-xl border border-border bg-muted/20">
                <CollapsibleTrigger className="flex w-full items-center justify-between p-4 text-left">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Early Release Day overrides</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className="font-medium text-foreground">{data.earlyReleaseDay}</span>
                      {data.earlyReleaseEndTime && <> · ends {data.earlyReleaseEndTime}</>}
                      {' '}— optional adjusted times.
                    </p>
                  </div>
                  <ChevronDown className={cn('h-4 w-4 transition-transform', erOpen && 'rotate-180')} />
                </CollapsibleTrigger>
                <CollapsibleContent className="px-4 pb-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    {PERIOD_ORDER.map(p => (
                      <PeriodCard
                        key={`er-${p}`}
                        period={p}
                        rows={cards[p]}
                        gradesServed={gradesServed}
                        showGrades={false}
                        showEarlyRelease={true}
                        onAddRow={addRow}
                        onRemoveRow={removeRow}
                        onUpdate={updateRow}
                      />
                    ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">
                No early release day configured.{' '}
                <button onClick={() => setStep(SETUP_STEPS.SCHOOL_INFO)} className="text-primary hover:underline">Set one in School Info →</button>
              </p>
            </div>
          )}

          {validation.hasError && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-1">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-medium">
                <AlertCircle className="h-3.5 w-3.5" /> Resolve before continuing:
              </div>
              <ul className="list-disc pl-5 text-amber-700/90 dark:text-amber-200/90 space-y-0.5">
                {validation.issues.slice(0, 6).map((m, i) => <li key={i}>{m}</li>)}
                {validation.issues.length > 6 && <li>…and {validation.issues.length - 6} more</li>}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={() => setStep(SETUP_STEPS.CALENDAR)}>Back</Button>
        <Button onClick={() => setStep(SETUP_STEPS.SPECIALISTS)}>Continue</Button>
      </div>
    </div>
  );
};

export default StepRecessLunch;
