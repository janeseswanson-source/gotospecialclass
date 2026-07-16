import { useEffect, useRef, useCallback, useState, useMemo, type ReactNode } from 'react';
import { SaveStatusIndicator, type SaveStatus } from '@/components/setup/SaveStatusIndicator';
import { SETUP_STEPS } from '../stepIndex';
import { useFlushOnUnmount } from '@/hooks/useFlushOnUnmount';
import { useSetup } from '@/contexts/SetupContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, AlertCircle, Plus, Minus, Trash2, Sun, Utensils, Cloud, RefreshCw, Sparkles, Loader2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import PeriodCard, { PeriodKey, PeriodRow } from './recessLunch/PeriodCard';
import { aiErrorToast } from '@/lib/aiError';
import { sanitizeBandLabel } from '@/lib/scheduleGrid';

const PERIOD_META: Record<PeriodKey, { title: string; Icon: any; accent: string }> = {
  amRecess: { title: 'AM Recess', Icon: Sun, accent: 'text-amber-600 dark:text-amber-300' },
  lunch:    { title: 'Lunch',     Icon: Utensils, accent: 'text-amber-700 dark:text-amber-200' },
  pmRecess: { title: 'PM Recess', Icon: Cloud, accent: 'text-sky-600 dark:text-sky-300' },
};

const addMinutes = (hhmm: string, minutes: number): string => {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor((total % (24 * 60)) / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
};


type CardsState = Record<PeriodKey, PeriodRow[]>;

const PERIOD_ORDER: PeriodKey[] = ['amRecess', 'lunch', 'pmRecess'];
const PERIOD_LABEL: Record<PeriodKey, string> = {
  amRecess: 'AM Recess',
  lunch: 'Lunch',
  pmRecess: 'PM Recess',
};

const genBandKey = () => `band_${Math.random().toString(36).slice(2, 8)}`;
const genRowId = () => `r_${Math.random().toString(36).slice(2, 10)}`;

/** "K–2" / "3–5" style label from a grades list (order = grades-served order).
 *  Beats the old "(group N)" naming, which leaked meaningless names into every
 *  schedule view and export. */
const gradeRangeLabel = (grades: string[]): string => {
  if (grades.length === 0) return '';
  if (grades.length === 1) return grades[0];
  return `${grades[0]}–${grades[grades.length - 1]}`;
};

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
  const [nlOpen, setNlOpen] = useState(false);
  const [nlText, setNlText] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
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
        const seedLabel = sanitizeBandLabel(seed.label, seed.key)
          || (seed.key === 'all' ? 'Whole School' : (gradeRangeLabel(seed.grades) || 'Group'));
        PERIOD_ORDER.forEach(p => {
          next[p] = [{
            rowId: genRowId(),
            bandKey: seed.key,
            label: seedLabel,
            grades: [...seed.grades],
            start: '', end: '',
          }];
        });
      } else {
        configRows.forEach((r) => {
          // A config row whose band key is missing from the stored bands must
          // NOT get the raw key as its display label (that's how "band_o3re5m"
          // leaked into prints) — name it by its grades instead.
          const band = bandByKey.get(r.grade_band) ?? {
            key: r.grade_band,
            label: r.grade_band === 'all' ? 'Whole School' : (gradeRangeLabel(gradesServed) || 'Group'),
            grades: [...gradesServed],
          };
          // The card label must ROUND-TRIP the stored band label unchanged.
          // The old expression prepended the period name ("AM Recess · ") to
          // the STORED label, and autosave persisted the grown compound back —
          // one extra segment per wizard visit (the KK3 label monster).
          const cardLabel = sanitizeBandLabel(band.label, band.key)
            || (band.key === 'all' ? 'Whole School' : (gradeRangeLabel(band.grades) || 'Group'));
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
                label: cardLabel,
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
    // A stored band label must NAME the group, not echo the period or the raw
    // key — older saves leaked "AM Recess" / "band_xxxxxx" labels into every
    // schedule view and export, and COMPOUND garbage ("AM Recess · band_x")
    // slipped past the old bare-form checks. sanitizeBandLabel strips all of
    // it; fall back to a grade-range name ("K–2").
    const cleanLabel = (key: string, label: string, grades: string[]): string =>
      sanitizeBandLabel(label, key)
      || gradeRangeLabel(grades)
      || (key === 'all' ? 'Whole School' : 'Group');
    // Unique bands across all rows, keyed by bandKey (defaulting empty -> 'all').
    const bandIndex = new Map<string, StoredBand>();
    PERIOD_ORDER.forEach(p => cards[p].forEach(r => {
      const key = (r.bandKey || 'all').trim() || 'all';
      if (!bandIndex.has(key)) {
        bandIndex.set(key, { key, label: cleanLabel(key, r.label, r.grades), grades: r.grades });
      } else {
        // Merge grades so the stored band reflects every row using the same key.
        const existing = bandIndex.get(key)!;
        const merged = Array.from(new Set([...existing.grades, ...r.grades]));
        bandIndex.set(key, { ...existing, grades: merged, label: cleanLabel(key, existing.label, merged) });
      }
    }));

    // Build one recess_lunch_config row per bandKey
    const configRows: any[] = [];
    Array.from(bandIndex.keys()).forEach((bandKey) => {
      const row: any = { grade_band: bandKey };
      let hasAny = false;
      PERIOD_ORDER.forEach(p => {
        const cols = periodColumns(p);
        const r = cards[p].find(x => (x.bandKey || 'all') === bandKey);
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
      const keepBands = configRows.map(r => r.grade_band as string);

      // Selective delete: only rows whose grade_band is no longer present.
      // Avoids the delete+insert race that surfaced as the toast error.
      if (keepBands.length > 0) {
        const inList = `(${keepBands.map(k => `"${k.replace(/"/g, '\\"')}"`).join(',')})`;
        const { error: delErr } = await supabase
          .from('recess_lunch_config')
          .delete()
          .eq('school_id', schoolId)
          .not('grade_band', 'in', inList);
        if (delErr) throw delErr;
      } else {
        const { error: delErr } = await supabase
          .from('recess_lunch_config')
          .delete()
          .eq('school_id', schoolId);
        if (delErr) throw delErr;
      }

      if (configRows.length > 0) {
        const rows = configRows.map(r => ({ ...r, school_id: schoolId }));
        const { error } = await supabase
          .from('recess_lunch_config')
          .upsert(rows, { onConflict: 'school_id,grade_band' });
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
    } catch (err: any) {
      console.error('[StepRecessLunch] save failed', {
        code: err?.code, details: err?.details, hint: err?.hint, message: err?.message, raw: err,
      });
      const msg = err?.message || err?.details || 'unknown error';
      toast.error(`Failed to save recess configuration: ${msg}`);
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
        // Remaining grades = grades not covered by existing rows in this period
        const taken = new Set(existing.flatMap(r => r.grades));
        const leftover = gradesServed.filter(g => !taken.has(g));
        grades = leftover.length ? leftover : fallbackGrades;
        label = gradeRangeLabel(grades) || `${PERIOD_LABEL[period]} (group ${existing.length + 1})`;
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
    } else {
      // Staggered means at least TWO grade groups — auto-split each single-row
      // period into lower/upper halves (e.g. K–2 / 3–5) so the user starts from
      // two labelled rows instead of having to discover the "+" themselves.
      // Both groups share the same band keys across periods so the schedule
      // views group them consistently.
      if (gradesServed.length >= 2) {
        const half = Math.ceil(gradesServed.length / 2);
        const lower = gradesServed.slice(0, half);
        const upper = gradesServed.slice(half);
        const lowerKey = genBandKey();
        const upperKey = genBandKey();
        setCards(prev => {
          const out: CardsState = { ...prev };
          PERIOD_ORDER.forEach(p => {
            if (prev[p].length === 1) {
              const first = prev[p][0];
              out[p] = [
                { ...first, bandKey: lowerKey, label: gradeRangeLabel(lower), grades: lower },
                { rowId: genRowId(), bandKey: upperKey, label: gradeRangeLabel(upper), grades: upper, start: '', end: '' },
              ];
            }
          });
          return out;
        });
      }
    }
    updateData({ scheduleType: next });
  };

  // ------- New simpler UI helpers -------
  const [defaultLunchMinutes, setDefaultLunchMinutes] = useState<number>(data.lunchMinutes || 30);
  useEffect(() => {
    if (data.lunchMinutes) setDefaultLunchMinutes(data.lunchMinutes);
  }, [data.lunchMinutes]);

  const setCount = (period: PeriodKey, target: number) => {
    setCards(prev => {
      const cur = prev[period];
      const clamped = Math.max(1, Math.min(8, target));
      if (clamped === cur.length) return prev;
      if (clamped < cur.length) {
        return { ...prev, [period]: cur.slice(0, clamped) };
      }
      // Grow
      let next = [...cur];
      while (next.length < clamped) {
        const firstAcrossAll = PERIOD_ORDER.flatMap(p => p === period ? next : prev[p])[0];
        const fallbackGrades = firstAcrossAll?.grades ?? [...gradesServed];
        let bandKey: string, label: string, grades: string[];
        let start = '';
        let end = '';
        if (next.length === 0) {
          bandKey = firstAcrossAll?.bandKey || 'all';
          label = PERIOD_LABEL[period];
          grades = fallbackGrades;
        } else {
          bandKey = genBandKey();
          const taken = new Set(next.flatMap(r => r.grades));
          const leftover = gradesServed.filter(g => !taken.has(g));
          grades = leftover.length ? leftover : fallbackGrades;
          label = gradeRangeLabel(grades) || `${PERIOD_LABEL[period]} (group ${next.length + 1})`;
        }
        // For PM Recess: try to auto-populate from corresponding lunch row.
        if (period === 'pmRecess') {
          const lunchRow = prev.lunch[next.length];
          if (lunchRow) {
            grades = [...lunchRow.grades];
            bandKey = lunchRow.bandKey;
            if (lunchRow.end) {
              start = lunchRow.end;
              end = addMinutes(start, 15);
            }
          }
        }
        next.push({ rowId: genRowId(), bandKey, label, grades, start, end });
      }
      return { ...prev, [period]: next };
    });
    if (target > 1 && data.scheduleType !== 'staggered') updateData({ scheduleType: 'staggered' });
  };

  // Update start time → auto-derive end based on the period's default duration.
  const setRowStart = (period: PeriodKey, rowId: string, start: string) => {
    const dur = period === 'lunch' ? defaultLunchMinutes : 15;
    const end = start ? addMinutes(start, dur) : '';
    updateRow(period, rowId, { start, end });
  };

  // When defaultLunchMinutes changes, recompute lunch ends.
  useEffect(() => {
    setCards(prev => ({
      ...prev,
      lunch: prev.lunch.map(r => r.start ? { ...r, end: addMinutes(r.start, defaultLunchMinutes) } : r),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultLunchMinutes]);

  const syncPmFromLunch = () => {
    setCards(prev => {
      const next = prev.lunch.map((l, i) => {
        const existing = prev.pmRecess[i];
        const start = l.end || '';
        return {
          rowId: existing?.rowId ?? genRowId(),
          bandKey: l.bandKey,
          label: existing?.label ?? `${PERIOD_LABEL.pmRecess}${prev.lunch.length > 1 ? ` (group ${i + 1})` : ''}`,
          grades: [...l.grades],
          start,
          end: start ? addMinutes(start, 15) : '',
          erStart: existing?.erStart,
          erEnd: existing?.erEnd,
        };
      });
      return { ...prev, pmRecess: next };
    });
  };

  // ------- Render -------
  // Expand a grade-band label ("K-2", "3-5", "all") to the grades it covers.
  const expandBand = (band: string): string[] => {
    const b = band.trim();
    if (!b || b.toLowerCase() === 'all' || /whole/i.test(b)) return [...gradesServed];
    const order = ['K', '1', '2', '3', '4', '5', '6', '7', '8'];
    const norm = (x: string) => (/^k/i.test(x) ? 'K' : x.replace(/[^0-9]/g, ''));
    const m = b.match(/^\s*([A-Za-z0-9]+)\s*[–-]\s*([A-Za-z0-9]+)\s*$/);
    if (m) {
      const a = order.indexOf(norm(m[1]));
      const z = order.indexOf(norm(m[2]));
      if (a >= 0 && z >= 0) {
        const range = order.slice(Math.min(a, z), Math.max(a, z) + 1);
        const kept = range.filter(g => gradesServed.includes(g));
        return kept.length ? kept : range;
      }
    }
    return b.split(',').map(s => norm(s.trim())).filter(Boolean);
  };

  // AI quick-fill: "K-2 recess 10:00-10:20, lunch 11:30…" → recess/lunch cards.
  const applyRecessNl = async () => {
    if (!nlText.trim() || nlLoading) return;
    setNlLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke('parse-recess-nl', { body: { description: nlText } });
      if (error) throw error;
      const rows = (res?.rows ?? []) as Array<Record<string, string | null>>;
      if (rows.length === 0) { toast.error('No recess/lunch windows detected — add some times and try again.'); return; }
      setCards(prev => {
        // Drop empty placeholder rows, then append the parsed windows.
        const next: CardsState = {
          amRecess: prev.amRecess.filter(r => r.start || r.end),
          lunch: prev.lunch.filter(r => r.start || r.end),
          pmRecess: prev.pmRecess.filter(r => r.start || r.end),
        };
        rows.forEach(r => {
          const band = String(r.grade_band || 'all').trim() || 'all';
          const isAll = band.toLowerCase() === 'all' || /whole/i.test(band);
          const bandKey = isAll ? 'all' : band.toLowerCase().replace(/\s+/g, '-');
          const grades = expandBand(band);
          const label = isAll ? 'Whole School' : band;
          const push = (period: PeriodKey, start?: string | null, end?: string | null) => {
            if (!start && !end) return;
            next[period].push({ rowId: genRowId(), bandKey, label, grades, start: start || '', end: end || '' });
          };
          push('amRecess', r.am_recess_start, r.am_recess_end);
          push('lunch', r.lunch_start, r.lunch_end);
          push('pmRecess', r.pm_recess_start, r.pm_recess_end);
        });
        return next;
      });
      const distinctBands = new Set(rows.map(r => String(r.grade_band || 'all').toLowerCase()));
      if (distinctBands.size > 1 && data.scheduleType !== 'staggered') updateData({ scheduleType: 'staggered' });
      toast.success('Filled recess & lunch from your description — review below.');
      setNlText('');
      setNlOpen(false);
    } catch (err: any) {
      console.error('[RecessNL]', err);
      aiErrorToast(err, { retry: applyRecessNl, title: "Couldn't read that" });
    } finally {
      setNlLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-card-foreground">Recess & Lunch</h2>
          <p className="text-sm text-muted-foreground">Protected windows so the scheduler avoids placing specialist classes here.</p>
        </div>
        <SaveStatusIndicator status={saveStatus} />
      </div>

      {/* AI quick-fill */}
      <Collapsible open={nlOpen} onOpenChange={setNlOpen}>
        <CollapsibleTrigger className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/5 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/10">
          <Sparkles className="h-3.5 w-3.5" /> Quick-fill with AI
          <ChevronDown className={cn('h-3 w-3 transition-transform', nlOpen && 'rotate-180')} />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
            <Textarea
              value={nlText}
              onChange={(e) => setNlText(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. K-2 recess 10:00-10:20, lunch 11:30-12:00. Grades 3-5 lunch 12:00-12:30, PM recess 2:00."
              disabled={nlLoading}
            />
            <div className="flex justify-end">
              <Button size="sm" className="gap-1.5" onClick={applyRecessNl} disabled={!nlText.trim() || nlLoading}>
                {nlLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {nlLoading ? 'Reading…' : 'Fill windows'}
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

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
          <div className="space-y-3">
            <CompactSection
              period="amRecess"
              rows={cards.amRecess}
              gradesServed={gradesServed}
              showGrades={isStaggered}
              countLocked={!isStaggered}
              defaultDuration={15}
              onSetCount={(n) => setCount('amRecess', n)}
              onSetStart={(rowId, s) => setRowStart('amRecess', rowId, s)}
              onUpdate={(rowId, patch) => updateRow('amRecess', rowId, patch)}
              onRemove={(rowId) => removeRow('amRecess', rowId)}
            />

            <CompactSection
              period="lunch"
              rows={cards.lunch}
              gradesServed={gradesServed}
              showGrades={isStaggered}
              countLocked={!isStaggered}
              defaultDuration={defaultLunchMinutes}
              onDefaultDurationChange={setDefaultLunchMinutes}
              onSetCount={(n) => setCount('lunch', n)}
              onSetStart={(rowId, s) => setRowStart('lunch', rowId, s)}
              onUpdate={(rowId, patch) => updateRow('lunch', rowId, patch)}
              onRemove={(rowId) => removeRow('lunch', rowId)}
            />

            <CompactSection
              period="pmRecess"
              rows={cards.pmRecess}
              gradesServed={gradesServed}
              showGrades={isStaggered}
              countLocked={!isStaggered}
              defaultDuration={15}
              onSetCount={(n) => setCount('pmRecess', n)}
              onSetStart={(rowId, s) => setRowStart('pmRecess', rowId, s)}
              onUpdate={(rowId, patch) => updateRow('pmRecess', rowId, patch)}
              onRemove={(rowId) => removeRow('pmRecess', rowId)}
              extraHeader={
                cards.lunch.some(l => l.end) && (
                  <button
                    type="button"
                    onClick={syncPmFromLunch}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  >
                    <RefreshCw className="h-3 w-3" /> Auto from Lunch
                  </button>
                )
              }
            />
          </div>

          {/* Early release block — collapsed by default, unchanged */}
          {hasEarlyRelease ? (
            <Collapsible open={erOpen} onOpenChange={setErOpen}>
              <div className="rounded-xl border border-border bg-muted/20">
                <CollapsibleTrigger className="flex w-full items-center justify-between p-3 text-left">
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
                <CollapsibleContent className="px-3 pb-3">
                  <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 min-w-0">
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
        <Button variant="outline" onClick={() => setStep(SETUP_STEPS.SCHOOL_INFO)}>Back</Button>
        {/* Invalid rows block the WHOLE autosave (valid rows included) — letting
            Continue through would silently drop the entire recess config. */}
        <div className="flex flex-col items-end gap-1">
          <Button onClick={() => setStep(SETUP_STEPS.SPECIALISTS)} disabled={validation.hasError}>Continue</Button>
          {validation.hasError && (
            <p className="text-xs text-destructive">Fix the highlighted times first — nothing saves while a row is invalid.</p>
          )}
        </div>
      </div>
    </div>
  );
};

// ------- Compact section (count-first, auto-fill end times) -------
interface CompactSectionProps {
  period: PeriodKey;
  rows: PeriodRow[];
  gradesServed: string[];
  showGrades: boolean;
  countLocked: boolean;
  defaultDuration: number;
  onDefaultDurationChange?: (n: number) => void;
  onSetCount: (n: number) => void;
  onSetStart: (rowId: string, start: string) => void;
  onUpdate: (rowId: string, patch: Partial<PeriodRow>) => void;
  onRemove: (rowId: string) => void;
  extraHeader?: ReactNode;
}

const CompactSection = ({
  period, rows, gradesServed, showGrades, countLocked, defaultDuration,
  onDefaultDurationChange, onSetCount, onSetStart, onUpdate, onRemove, extraHeader,
}: CompactSectionProps) => {
  const meta = PERIOD_META[period];
  const Icon = meta.Icon;
  const count = rows.length;

  return (
    <div className="rounded-xl border border-border bg-muted/10">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className={cn('flex items-center gap-2 text-sm font-semibold', meta.accent)}>
          <Icon className="h-4 w-4" />
          <span>{meta.title}</span>
          <span className="text-xs font-normal text-muted-foreground">· {defaultDuration} min blocks</span>
        </div>
        <div className="flex items-center gap-3">
          {extraHeader}
          {period === 'lunch' && onDefaultDurationChange && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Length
              <Input
                type="number"
                min={5}
                max={120}
                value={defaultDuration}
                onChange={(e) => onDefaultDurationChange(Math.max(5, Math.min(120, Number(e.target.value) || 30)))}
                className="h-7 w-16 text-xs"
              />
              min
            </label>
          )}
          {!countLocked && (
            <div className="flex items-center gap-1 rounded-md border border-border bg-background px-1 py-0.5">
              <button
                type="button"
                onClick={() => onSetCount(count - 1)}
                disabled={count <= 1}
                className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Decrease"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[1.5rem] text-center text-xs font-medium">{count}</span>
              <button
                type="button"
                onClick={() => onSetCount(count + 1)}
                disabled={count >= 8}
                className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Increase"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border/40">
        {rows.length === 0 && (
          <p className="px-4 py-3 text-xs italic text-muted-foreground">No rows.</p>
        )}
        {rows.map((row, idx) => (
          <div key={row.rowId} className="px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary/10 px-2 text-[11px] font-semibold text-primary">
                #{idx + 1}
              </span>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Start
                <Input
                  type="time"
                  value={row.start}
                  onChange={(e) => onSetStart(row.rowId, e.target.value)}
                  className="h-8 w-[7.5rem] text-xs"
                />
              </label>
              <span className="text-xs text-muted-foreground">→</span>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                End
                <Input
                  type="time"
                  value={row.end}
                  onChange={(e) => onUpdate(row.rowId, { end: e.target.value })}
                  className="h-8 w-[7.5rem] text-xs"
                  title="Auto-filled — edit to override"
                />
              </label>
              {row.start && row.end && row.end === addMinutes(row.start, defaultDuration) && (
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">auto</span>
              )}
              {!countLocked && rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemove(row.rowId)}
                  className="ml-auto rounded p-1 text-muted-foreground hover:text-destructive"
                  aria-label="Remove row"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {showGrades && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">Grades</span>
                {gradesServed.map(g => {
                  const selected = row.grades.includes(g);
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => {
                        const next = selected ? row.grades.filter(x => x !== g) : [...row.grades, g];
                        onUpdate(row.rowId, { grades: next });
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
                <button
                  type="button"
                  onClick={() => onUpdate(row.rowId, { grades: [...gradesServed] })}
                  className="ml-2 text-[10px] text-primary hover:underline"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => onUpdate(row.rowId, { grades: [] })}
                  className="text-[10px] text-muted-foreground hover:underline"
                >
                  None
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};


export default StepRecessLunch;
