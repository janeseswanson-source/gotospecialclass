import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { SaveStatusIndicator, type SaveStatus } from '@/components/setup/SaveStatusIndicator';
import { SETUP_STEPS } from '../stepIndex';
import { useFlushOnUnmount } from '@/hooks/useFlushOnUnmount';
import { useSetup } from '@/contexts/SetupContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field-label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Plus, Trash2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Band = { key: string; label: string; grades: string[] };

const DEFAULT_BAND_TEMPLATE = (gradesServed: string[]): Band[] => {
  const k = gradesServed.filter(g => g === 'K' || g === 'PK' || g.toLowerCase() === 'kindergarten');
  const primary = gradesServed.filter(g => ['1', '2', '3'].includes(g));
  const intermediate = gradesServed.filter(g => ['4', '5', '6'].includes(g));
  const bands: Band[] = [];
  if (k.length) bands.push({ key: 'kindergarten', label: 'Kindergarten', grades: k });
  if (primary.length) bands.push({ key: 'primary', label: 'Primary (1-3)', grades: primary });
  if (intermediate.length) bands.push({ key: 'intermediate', label: 'Intermediate (4-6)', grades: intermediate });
  if (bands.length === 0 && gradesServed.length > 0) {
    bands.push({ key: 'all', label: 'All Grades', grades: [...gradesServed] });
  }
  return bands;
};

const genBandKey = () => `band_${Math.random().toString(36).slice(2, 8)}`;

const StepRecessLunch = () => {
  const { data, updateData, setStep, schoolId } = useSetup();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [bands, setBands] = useState<Band[]>([]);
  const [configureOpen, setConfigureOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const isLoaded = useRef(false);
  const lastSavedBands = useRef<Band[]>([]);

  const config = data.recessConfig;
  const isStaggered = data.scheduleType === 'staggered';
  const gradesServed = data.gradesServed || [];

  // Load bands and recess config from DB
  useEffect(() => {
    if (!schoolId) { isLoaded.current = true; return; }
    const load = async () => {
      const [{ data: rows }, { data: school }] = await Promise.all([
        supabase.from('recess_lunch_config').select('*').eq('school_id', schoolId),
        supabase.from('schools').select('recess_grade_bands').eq('id', schoolId).maybeSingle(),
      ]);

      const stored = (school as any)?.recess_grade_bands as Band[] | null;
      const initial = Array.isArray(stored) && stored.length > 0 ? stored : DEFAULT_BAND_TEMPLATE(gradesServed);
      setBands(initial);
      lastSavedBands.current = initial;

      if (rows && rows.length > 0) {
        const recessConfig: Record<string, any> = {};
        rows.forEach(r => {
          recessConfig[r.grade_band] = {
            amRecessStart: r.am_recess_start || '',
            amRecessEnd: r.am_recess_end || '',
            lunchStart: r.lunch_start || '',
            lunchEnd: r.lunch_end || '',
            pmRecessStart: r.pm_recess_start || '',
            pmRecessEnd: r.pm_recess_end || '',
            earlyReleaseLunchStart: r.early_release_lunch_start || '',
            earlyReleaseLunchEnd: r.early_release_lunch_end || '',
            earlyReleaseAmRecessStart: (r as any).early_release_am_recess_start || '',
            earlyReleaseAmRecessEnd: (r as any).early_release_am_recess_end || '',
            earlyReleasePmRecessStart: (r as any).early_release_pm_recess_start || '',
            earlyReleasePmRecessEnd: (r as any).early_release_pm_recess_end || '',
          };
        });
        updateData({ recessConfig });
      }
      isLoaded.current = true;
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  // Validation
  const validation = useMemo(() => {
    const counts: Record<string, number> = {};
    bands.forEach(b => b.grades.forEach(g => { counts[g] = (counts[g] || 0) + 1; }));
    const unassigned = gradesServed.filter(g => !counts[g]);
    const duplicated = Object.keys(counts).filter(g => counts[g] > 1);
    const emptyBands = bands.filter(b => b.grades.length === 0).map(b => b.label || b.key);
    const hasError = duplicated.length > 0 || emptyBands.length > 0;
    return { unassigned, duplicated, emptyBands, hasError };
  }, [bands, gradesServed]);

  const autoSave = useCallback(async () => {
    if (!schoolId || !isLoaded.current) return;
    if (validation.hasError) { setSaveStatus('idle'); return; }
    setSaveStatus('saving');
    const previousBands = lastSavedBands.current;
    try {
      await supabase.from('recess_lunch_config').delete().eq('school_id', schoolId);
      const rows = Object.entries(config).map(([band, cfg]: [string, any]) => ({
        school_id: schoolId,
        grade_band: band,
        am_recess_start: cfg.amRecessStart || null,
        am_recess_end: cfg.amRecessEnd || null,
        lunch_start: cfg.lunchStart || null,
        lunch_end: cfg.lunchEnd || null,
        pm_recess_start: cfg.pmRecessStart || null,
        pm_recess_end: cfg.pmRecessEnd || null,
        early_release_lunch_start: cfg.earlyReleaseLunchStart || null,
        early_release_lunch_end: cfg.earlyReleaseLunchEnd || null,
        early_release_am_recess_start: cfg.earlyReleaseAmRecessStart || null,
        early_release_am_recess_end: cfg.earlyReleaseAmRecessEnd || null,
        early_release_pm_recess_start: cfg.earlyReleasePmRecessStart || null,
        early_release_pm_recess_end: cfg.earlyReleasePmRecessEnd || null,
      }));
      if (rows.length > 0) {
        await supabase.from('recess_lunch_config').insert(rows);
      }
      const { error } = await supabase.from('schools').update({
        schedule_type: data.scheduleType,
        recess_grade_bands: bands as any,
      } as any).eq('id', schoolId);
      if (error) throw error;
      lastSavedBands.current = bands;
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('[StepRecessLunch] save failed', err);
      setBands(previousBands);
      toast.error('Failed to save recess configuration');
      setSaveStatus('idle');
    }
  }, [schoolId, config, data.scheduleType, bands, validation.hasError]);

  useFlushOnUnmount(saveTimer, () => { if (isLoaded.current) autoSave(); });

  useEffect(() => {
    if (!isLoaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => autoSave(), 1000);
  }, [autoSave]);

  const updateConfig = (band: string, field: string, value: string) => {
    updateData({
      recessConfig: {
        ...config,
        [band]: { ...config[band], [field]: value }
      }
    });
  };

  const toggleType = (type: 'whole_school' | 'staggered') => {
    updateData({ scheduleType: type });
  };

  // Band editors
  const updateBandLabel = (key: string, label: string) => {
    setBands(prev => prev.map(b => b.key === key ? { ...b, label } : b));
  };

  const toggleBandGrade = (key: string, grade: string) => {
    setBands(prev => prev.map(b => {
      if (b.key !== key) return b;
      const has = b.grades.includes(grade);
      return { ...b, grades: has ? b.grades.filter(g => g !== grade) : [...b.grades, grade] };
    }));
  };

  const addBand = () => {
    setBands(prev => [...prev, { key: genBandKey(), label: `Band ${prev.length + 1}`, grades: [] }]);
  };

  const deleteBand = (key: string) => {
    if (bands.length <= 1) return;
    if (!confirm('Delete this grade band? Its recess times will be removed.')) return;
    setBands(prev => prev.filter(b => b.key !== key));
    const next = { ...config };
    delete next[key];
    updateData({ recessConfig: next });
  };

  const applyWholeSchoolPreset = () => {
    if (gradesServed.length === 0) return;
    // Inherit times from the band containing the most grades
    const donor = [...bands].sort((a, b) => b.grades.length - a.grades.length)[0];
    const donorTimes = donor ? config[donor.key] : undefined;
    setBands([{ key: 'all', label: 'Whole School', grades: [...gradesServed] }]);
    updateData({ recessConfig: donorTimes ? { all: donorTimes } : {} });
  };

  const applyDefaultPreset = () => {
    const fresh = DEFAULT_BAND_TEMPLATE(gradesServed);
    setBands(fresh);
    const next: Record<string, any> = {};
    fresh.forEach(b => { if (config[b.key]) next[b.key] = config[b.key]; });
    updateData({ recessConfig: next });
  };

  // Bands to render time inputs for
  const renderBands: Band[] = isStaggered
    ? bands
    : [{ key: 'all', label: 'Whole School', grades: [...gradesServed] }];

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-card-foreground">Recess & Lunch Configuration</h2>
        <SaveStatusIndicator status={saveStatus} />
      </div>
      <p className="text-sm text-muted-foreground -mt-4">Set recess and lunch windows so the scheduler avoids placing classes during these times</p>

      <div className="flex gap-2">
        {(['whole_school', 'staggered'] as const).map(type => (
          <button
            key={type}
            onClick={() => toggleType(type)}
            className={cn(
              'rounded-lg border-2 px-4 py-2 text-sm font-medium transition-all',
              data.scheduleType === type
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/30'
            )}
          >
            {type === 'whole_school' ? 'Whole School' : 'Staggered by Grade Band'}
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
          {isStaggered && (
            <Collapsible open={configureOpen} onOpenChange={setConfigureOpen}>
              <div className="rounded-lg border border-border bg-muted/20">
                <CollapsibleTrigger className="flex w-full items-center justify-between p-4 text-left">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Recess Grade Groups</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {bands.length} {bands.length === 1 ? 'group' : 'groups'} — click to customize how grades are grouped for recess
                    </p>
                  </div>
                  <ChevronDown className={cn('h-4 w-4 transition-transform', configureOpen && 'rotate-180')} />
                </CollapsibleTrigger>
                <CollapsibleContent className="px-4 pb-4 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={applyWholeSchoolPreset}>Use whole-school</Button>
                    <Button size="sm" variant="outline" onClick={applyDefaultPreset}>Use K / Primary / Intermediate</Button>
                  </div>

                  {bands.map(band => (
                    <div key={band.key} className="rounded-md border border-border bg-background p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={band.label}
                          onChange={(e) => updateBandLabel(band.key, e.target.value)}
                          placeholder="Band name"
                          className="h-8 text-sm flex-1"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteBand(band.key)}
                          disabled={bands.length <= 1}
                          aria-label="Delete band"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {gradesServed.map(grade => {
                          const selected = band.grades.includes(grade);
                          return (
                            <button
                              key={grade}
                              type="button"
                              onClick={() => toggleBandGrade(band.key, grade)}
                              className={cn(
                                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                                selected
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-border bg-background text-muted-foreground hover:border-primary/40'
                              )}
                            >
                              {grade}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  <Button size="sm" variant="outline" onClick={addBand} className="gap-1">
                    <Plus className="h-4 w-4" /> Add band
                  </Button>

                  {(validation.unassigned.length > 0 || validation.duplicated.length > 0 || validation.emptyBands.length > 0) && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-1">
                      {validation.unassigned.length > 0 && (
                        <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>Unassigned grades: <strong>{validation.unassigned.join(', ')}</strong></span>
                        </div>
                      )}
                      {validation.duplicated.length > 0 && (
                        <div className="flex items-start gap-2 text-destructive">
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>Grades in multiple bands (blocks save): <strong>{validation.duplicated.join(', ')}</strong></span>
                        </div>
                      )}
                      {validation.emptyBands.length > 0 && (
                        <div className="flex items-start gap-2 text-destructive">
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>Empty bands (blocks save): <strong>{validation.emptyBands.join(', ')}</strong></span>
                        </div>
                      )}
                    </div>
                  )}
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {data.earlyReleaseDay ? (
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-1">
              <h3 className="text-sm font-semibold text-foreground">Early Release Day</h3>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{data.earlyReleaseDay}</span> — ends at <span className="font-medium text-foreground">{data.earlyReleaseEndTime || '(not set)'}</span>
                <button onClick={() => setStep(SETUP_STEPS.SCHOOL_INFO)} className="ml-2 text-primary hover:underline text-xs">Change in School Info →</button>
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">No early release day configured. <button onClick={() => setStep(SETUP_STEPS.SCHOOL_INFO)} className="text-primary hover:underline">Set one in School Info →</button></p>
            </div>
          )}

          {renderBands.map(band => (
            <div key={band.key} className="space-y-3 rounded-lg border border-border bg-background p-4">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-foreground">{band.label}</h3>
                {isStaggered && band.grades.length > 0 && (
                  <span className="text-xs text-muted-foreground">Grades: {band.grades.join(', ')}</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <FieldLabel className="text-xs" tooltip="Morning recess window — no specialist classes will be scheduled during this time.">AM Recess Start</FieldLabel>
                  <Input type="time" className="h-8 text-xs" value={config[band.key]?.amRecessStart || ''} onChange={(e) => updateConfig(band.key, 'amRecessStart', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <FieldLabel className="text-xs" tooltip="End of morning recess window">AM Recess End</FieldLabel>
                  <Input type="time" className="h-8 text-xs" value={config[band.key]?.amRecessEnd || ''} onChange={(e) => updateConfig(band.key, 'amRecessEnd', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <FieldLabel className="text-xs" tooltip="Lunch period start — the scheduler will avoid this window for specialist classes.">Lunch Start</FieldLabel>
                  <Input type="time" className="h-8 text-xs" value={config[band.key]?.lunchStart || ''} onChange={(e) => updateConfig(band.key, 'lunchStart', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <FieldLabel className="text-xs" tooltip="End of lunch period">Lunch End</FieldLabel>
                  <Input type="time" className="h-8 text-xs" value={config[band.key]?.lunchEnd || ''} onChange={(e) => updateConfig(band.key, 'lunchEnd', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <FieldLabel className="text-xs" tooltip="Afternoon recess window">PM Recess Start</FieldLabel>
                  <Input type="time" className="h-8 text-xs" value={config[band.key]?.pmRecessStart || ''} onChange={(e) => updateConfig(band.key, 'pmRecessStart', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <FieldLabel className="text-xs" tooltip="End of afternoon recess window">PM Recess End</FieldLabel>
                  <Input type="time" className="h-8 text-xs" value={config[band.key]?.pmRecessEnd || ''} onChange={(e) => updateConfig(band.key, 'pmRecessEnd', e.target.value)} />
                </div>
              </div>
              {data.earlyReleaseDay && (
                <div className="mt-2 pt-2 border-t border-border">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Early Release ({data.earlyReleaseDay}) Overrides <span className="text-muted-foreground/60">(optional)</span></p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <FieldLabel className="text-xs" tooltip="Adjusted AM recess start for early release day">AM Recess Start</FieldLabel>
                      <Input type="time" className="h-8 text-xs" value={config[band.key]?.earlyReleaseAmRecessStart || ''} onChange={(e) => updateConfig(band.key, 'earlyReleaseAmRecessStart', e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <FieldLabel className="text-xs" tooltip="Adjusted AM recess end for early release day">AM Recess End</FieldLabel>
                      <Input type="time" className="h-8 text-xs" value={config[band.key]?.earlyReleaseAmRecessEnd || ''} onChange={(e) => updateConfig(band.key, 'earlyReleaseAmRecessEnd', e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <FieldLabel className="text-xs" tooltip="Adjusted lunch start for early release day">Lunch Start</FieldLabel>
                      <Input type="time" className="h-8 text-xs" value={config[band.key]?.earlyReleaseLunchStart || ''} onChange={(e) => updateConfig(band.key, 'earlyReleaseLunchStart', e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <FieldLabel className="text-xs" tooltip="Adjusted lunch end for early release day">Lunch End</FieldLabel>
                      <Input type="time" className="h-8 text-xs" value={config[band.key]?.earlyReleaseLunchEnd || ''} onChange={(e) => updateConfig(band.key, 'earlyReleaseLunchEnd', e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <FieldLabel className="text-xs" tooltip="Adjusted PM recess start for early release day">PM Recess Start</FieldLabel>
                      <Input type="time" className="h-8 text-xs" value={config[band.key]?.earlyReleasePmRecessStart || ''} onChange={(e) => updateConfig(band.key, 'earlyReleasePmRecessStart', e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <FieldLabel className="text-xs" tooltip="Adjusted PM recess end for early release day">PM Recess End</FieldLabel>
                      <Input type="time" className="h-8 text-xs" value={config[band.key]?.earlyReleasePmRecessEnd || ''} onChange={(e) => updateConfig(band.key, 'earlyReleasePmRecessEnd', e.target.value)} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep(SETUP_STEPS.CALENDAR)}>Back</Button>
        <Button onClick={() => setStep(SETUP_STEPS.SPECIALISTS)}>Continue</Button>
      </div>
    </div>
  );
};

export default StepRecessLunch;
