import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { SaveStatusIndicator, type SaveStatus } from '@/components/setup/SaveStatusIndicator';
import { SETUP_STEPS } from '../stepIndex';
import { useFlushOnUnmount } from '@/hooks/useFlushOnUnmount';
import { useSetup } from '@/contexts/SetupContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { FieldLabel } from '@/components/ui/field-label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { X, Info, AlertTriangle, XCircle, Sparkles, GripVertical, Eye, ChevronDown, Settings, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { getStrategyNote, getRecommendedStrategies, type StrategyContext } from '@/lib/strategyFeasibility';
import { toast } from '@/hooks/use-toast';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CONFLICT_STRATEGIES as strategies, getCategoryTheme } from '@/lib/conflictStrategies';
import { StrategyPreviewModal, getStrategyPreviewBlurb } from './conflicts/StrategyPreviewModal';

const allGrades = ['K', '1', '2', '3', '4', '5', '6'];



const BASE_ROTATION_KEYS = ['ab_week', 'aa_bb_week'];

interface TeacherRecord {
  id: string;
  name: string;
  grade: string;
  room: string | null;
  combo_partner_id?: string | null;
}


function SortableStrategyCard({ strategyKey, priority, onRemove, onPreview, strategyCtx, recommendedKeys }: {
  strategyKey: string;
  priority: number;
  onRemove: (key: string) => void;
  onPreview: (key: string) => void;
  strategyCtx: StrategyContext;
  recommendedKeys: string[];
}) {
  const s = strategies.find(s => s.key === strategyKey)!;
  const theme = getCategoryTheme(strategyKey);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: strategyKey });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined, opacity: isDragging ? 0.5 : 1 };
  const isRecommended = recommendedKeys.includes(strategyKey);

  return (
    <div ref={setNodeRef} style={style} className="space-y-0">
      <div className={cn('group flex w-full items-center gap-3 rounded-xl border border-l-4 p-4 text-left transition-all shadow-sm', theme.border, theme.topBorder, theme.bg)}>
        <button {...attributes} {...listeners} className="cursor-grab touch-none p-1 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical className="h-4 w-4" />
        </button>
        <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold', theme.badgeBg, theme.badgeText)}>
          {priority}
        </div>
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', theme.iconBg, theme.iconText)}>
          <s.icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm text-foreground">{s.title}</p>
            <span className={cn('text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md', theme.pillBg, theme.pillText)}>
              {theme.label}
            </span>
            {isRecommended && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-primary text-primary-foreground">
                Recommended
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
          {getStrategyPreviewBlurb(strategyKey) && (
            <p className="mt-1 text-xs italic text-foreground/70">
              <span className="font-medium not-italic text-foreground/80">Your week:</span> {getStrategyPreviewBlurb(strategyKey)}
            </p>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onPreview(strategyKey); }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0 px-1"
          aria-label="Preview strategy"
        >
          <Eye className="h-3 w-3" /> Preview
        </button>
        <button onClick={() => onRemove(strategyKey)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0">
          <X className="h-4 w-4" />
        </button>
      </div>
      <FeasibilityNote strategyKey={strategyKey} ctx={strategyCtx} />
    </div>
  );
}


function FeasibilityNote({ strategyKey, ctx }: { strategyKey: string; ctx: StrategyContext }) {
  const note = getStrategyNote(strategyKey, ctx);
  if (!note.note) return null;
  const Icon = note.severity === 'error' ? XCircle : note.severity === 'warning' ? AlertTriangle : Info;
  const color = note.severity === 'error' ? 'text-destructive' : note.severity === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground';
  const border = note.severity === 'error' ? 'border-l-destructive/50' : note.severity === 'warning' ? 'border-l-amber-400' : 'border-l-border';
  return (
    <div className={cn('flex items-start gap-2 border-l-2 pl-3 py-1 mt-1 ml-14', border)}>
      <Icon className={cn('h-3 w-3 mt-0.5 shrink-0', color)} />
      <p className={cn('text-xs', color)}>{note.note}</p>
    </div>
  );
}

function CombinedClassesSection({ teachers, onChanged }: { teachers: TeacherRecord[]; onChanged: () => void }) {
  const [aId, setAId] = useState<string>('');
  const [bId, setBId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  const byId = useMemo(() => Object.fromEntries(teachers.map(t => [t.id, t] as const)), [teachers]);

  // Build deduped pair list (only valid bidirectional pairs)
  const pairs = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ a: TeacherRecord; b: TeacherRecord }> = [];
    for (const t of teachers) {
      if (!t.combo_partner_id) continue;
      const partner = byId[t.combo_partner_id];
      if (!partner) continue;
      const key = [t.id, partner.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ a: t, b: partner });
    }
    return result;
  }, [teachers, byId]);

  const selfPair = aId && bId && aId === bId;
  const a = byId[aId];
  const b = byId[bId];
  const willOverwrite =
    (a?.combo_partner_id && a.combo_partner_id !== bId) ||
    (b?.combo_partner_id && b.combo_partner_id !== aId);

  const reset = () => { setAId(''); setBId(''); setConfirmOverwrite(false); };

  const savePair = async () => {
    if (!a || !b || selfPair) return;
    if (willOverwrite && !confirmOverwrite) { setConfirmOverwrite(true); return; }
    setSaving(true);
    try {
      // Clear any existing partners that point to a or b from other teachers
      const stale = teachers.filter(t =>
        (t.combo_partner_id === a.id || t.combo_partner_id === b.id) && t.id !== a.id && t.id !== b.id
      );
      for (const s of stale) {
        await supabase.from('classroom_teachers').update({ combo_partner_id: null }).eq('id', s.id);
      }
      await supabase.from('classroom_teachers').update({ combo_partner_id: b.id }).eq('id', a.id);
      await supabase.from('classroom_teachers').update({ combo_partner_id: a.id }).eq('id', b.id);
      reset();
      onChanged();
      toast({ title: 'Pair saved' });
    } catch (e) {
      toast({ title: "Couldn't save pair", variant: 'destructive' as any });
    } finally {
      setSaving(false);
    }
  };

  const removePair = async (x: TeacherRecord, y: TeacherRecord) => {
    await supabase.from('classroom_teachers').update({ combo_partner_id: null }).eq('id', x.id);
    await supabase.from('classroom_teachers').update({ combo_partner_id: null }).eq('id', y.id);
    onChanged();
  };

  return (
    <div className="rounded-lg border border-border bg-background p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Combined Classes</h3>
        <p className="text-xs text-muted-foreground mt-1">Pair two classroom teachers whose classes are combined for specials. Used by conflict resolution.</p>
      </div>

      {pairs.length > 0 && (
        <div className="space-y-1.5">
          {pairs.map(({ a, b }) => (
            <div key={a.id + b.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5">
              <span className="text-xs font-medium text-foreground flex-1">
                {a.name}{a.grade ? ` (${a.grade})` : ''} + {b.name}{b.grade ? ` (${b.grade})` : ''}
              </span>
              <button onClick={() => removePair(a, b)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <div className="space-y-1">
          <FieldLabel className="text-xs" tooltip="First teacher in the combined class">Teacher A</FieldLabel>
          <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs" value={aId} onChange={(e) => { setAId(e.target.value); setConfirmOverwrite(false); }}>
            <option value="">Select teacher…</option>
            {teachers.map(t => <option key={t.id} value={t.id}>{t.name}{t.grade ? ` (${t.grade})` : ''}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <FieldLabel className="text-xs" tooltip="Second teacher in the combined class">Teacher B</FieldLabel>
          <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs" value={bId} onChange={(e) => { setBId(e.target.value); setConfirmOverwrite(false); }}>
            <option value="">Select teacher…</option>
            {teachers.map(t => <option key={t.id} value={t.id}>{t.name}{t.grade ? ` (${t.grade})` : ''}</option>)}
          </select>
        </div>
        <Button size="sm" disabled={!aId || !bId || !!selfPair || saving} onClick={savePair}>
          {confirmOverwrite ? 'Confirm overwrite' : 'Add pair'}
        </Button>
      </div>

      {selfPair && (
        <p className="text-xs text-destructive">Pick two different teachers.</p>
      )}
      {!selfPair && willOverwrite && confirmOverwrite && (
        <p className="text-xs text-amber-600">
          {a?.combo_partner_id && a.combo_partner_id !== bId && <>{a?.name} is already paired with {byId[a!.combo_partner_id!]?.name || 'another teacher'}. </>}
          {b?.combo_partner_id && b.combo_partner_id !== aId && <>{b?.name} is already paired with {byId[b!.combo_partner_id!]?.name || 'another teacher'}. </>}
          Click again to overwrite.
        </p>
      )}
    </div>
  );
}

const StepConflict = () => {

  const { data, updateData, setStep, schoolId } = useSetup();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const isLoaded = useRef(false);

  const [teachers, setTeachers] = useState<TeacherRecord[]>([]);
  const [bigGroupGrade, setBigGroupGrade] = useState<string | null>(null);
  const [bigGroupSelected, setBigGroupSelected] = useState<string[]>([]);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const lastSavedStrategies = useRef<string[] | null>(null);

  const selected = data.conflictStrategies;
  const bigGroupConfig = data.bigGroupConfig;


  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Load teachers
  const reloadTeachers = useCallback(() => {
    if (!schoolId) return;
    supabase
      .from('classroom_teachers')
      .select('id, name, grade, room, combo_partner_id')
      .eq('school_id', schoolId)
      .then(({ data: t }) => { if (t) setTeachers(t as TeacherRecord[]); });
  }, [schoolId]);

  useEffect(() => { reloadTeachers(); }, [reloadTeachers]);


  // Load conflict data
  useEffect(() => {
    if (!schoolId) { isLoaded.current = true; return; }
    isLoaded.current = false;
    const load = async () => {
      const { data: school } = await supabase
        .from('schools')
        .select('conflict_strategies, conflict_strategy, conflict_grades, conflict_timing, big_group_config')
        .eq('id', schoolId)
        .single();
      if (school) {
        const strats = (school as any).conflict_strategies as string[] | null;
        const bgConfig = (school as any).big_group_config as Array<{ grade: string; teacherIds: string[] }> | null;
        // If the array column is empty but the legacy single-strategy column is set
        // (e.g. AB Week was chosen before this UI shipped), seed the list from it
        // so the user does not see an empty selection after refresh.
        let initialStrategies: string[] = strats && strats.length > 0 ? strats : [];
        if (initialStrategies.length === 0 && school.conflict_strategy && school.conflict_strategy !== 'standard') {
          initialStrategies = [school.conflict_strategy];
        }
        lastSavedStrategies.current = initialStrategies;
        updateData({
          conflictStrategies: initialStrategies,
          conflictStrategy: school.conflict_strategy || 'standard',
          conflictGrades: school.conflict_grades || [],
          conflictTiming: (school.conflict_timing as 'before' | 'after') || 'before',
          bigGroupConfig: bgConfig || [],
        });
      } else {
        lastSavedStrategies.current = [];
      }
      // Mark loaded on the next tick so the auto-save effect doesn't fire on the
      // same render that hydrated state — which previously overwrote the array
      // back to empty and reset conflict_strategy to 'standard'.
      setTimeout(() => { isLoaded.current = true; }, 0);
    };
    load();
  }, [schoolId]);

  // Auto-save
  const autoSave = useCallback(async () => {
    if (!schoolId || !isLoaded.current) return;
    const attempting = data.conflictStrategies;
    const previousSaved = lastSavedStrategies.current ?? [];
    setSaveStatus('saving');
    try {
      const { error } = await supabase.from('schools').update({
        conflict_strategies: data.conflictStrategies as any,
        conflict_strategy: (data.conflictStrategies.find(s => ['ab_week','aa_bb_week','quick_30','big_group','extra_rotation'].includes(s)) || 'standard') as any,
        conflict_grades: data.conflictGrades,
        conflict_timing: data.conflictTiming,
        big_group_config: data.bigGroupConfig as any,
      }).eq('id', schoolId);
      if (error) throw error;
      lastSavedStrategies.current = attempting;
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('idle');
      // Optimistic-revert strategy order on failure
      if (JSON.stringify(attempting) !== JSON.stringify(previousSaved)) {
        updateData({ conflictStrategies: previousSaved });
        toast({ title: "Couldn't save order — try again." });
      }
    }
  }, [schoolId, data.conflictStrategies, data.conflictGrades, data.conflictTiming, data.bigGroupConfig, updateData]);


  useFlushOnUnmount(saveTimer, () => { if (isLoaded.current) autoSave(); });

  useEffect(() => {
    if (!isLoaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => autoSave(), 1000);
  }, [autoSave]);

  const toggleStrategy = (key: string) => {
    const current = [...selected];
    const idx = current.indexOf(key);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      // Enforce mutual exclusion for base rotation strategies
      if (BASE_ROTATION_KEYS.includes(key)) {
        const otherBase = BASE_ROTATION_KEYS.find(k => k !== key);
        const otherIdx = otherBase ? current.indexOf(otherBase) : -1;
        if (otherIdx >= 0) current.splice(otherIdx, 1);
      }
      current.push(key);
    }
    updateData({ conflictStrategies: current });
  };

  const removeStrategy = (key: string) => {
    updateData({ conflictStrategies: selected.filter(s => s !== key) });
  };

  const toggleConflictGrade = (g: string) => {
    const current = data.conflictGrades;
    updateData({
      conflictGrades: current.includes(g) ? current.filter(x => x !== g) : [...current, g]
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = selected.indexOf(active.id as string);
      const newIndex = selected.indexOf(over.id as string);
      updateData({ conflictStrategies: arrayMove(selected, oldIndex, newIndex) });
    }
  };

  // Big Group helpers
  const gradeTeachers = bigGroupGrade ? teachers.filter(t => t.grade === bigGroupGrade) : [];

  const toggleBigGroupTeacher = (id: string) => {
    setBigGroupSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const addBigGroupSplit = () => {
    if (!bigGroupGrade || bigGroupSelected.length < 2) return;
    const updated = [...bigGroupConfig, { grade: bigGroupGrade, teacherIds: bigGroupSelected }];
    updateData({ bigGroupConfig: updated });
    setBigGroupGrade(null);
    setBigGroupSelected([]);
  };

  const removeBigGroupSplit = (idx: number) => {
    const updated = bigGroupConfig.filter((_, i) => i !== idx);
    updateData({ bigGroupConfig: updated });
  };

  const getTeacherName = (id: string) => teachers.find(t => t.id === id)?.name || 'Unknown';

  const grades = data.gradesServed.length > 0 ? data.gradesServed : allGrades;

  // Build strategy context for feasibility notes
  const [recessExists, setRecessExists] = useState(false);
  const [clubsCount, setClubsCount] = useState(0);
  const [specialistCount, setSpecialistCount] = useState(0);

  useEffect(() => {
    if (!schoolId) return;
    Promise.all([
      supabase.from('recess_lunch_config').select('id').eq('school_id', schoolId).limit(1),
      supabase.from('clubs').select('id').eq('school_id', schoolId),
      supabase.from('specialists').select('id').eq('school_id', schoolId),
    ]).then(([recessRes, clubsRes, specRes]) => {
      setRecessExists((recessRes.data?.length ?? 0) > 0);
      setClubsCount(clubsRes.data?.length ?? 0);
      setSpecialistCount(specRes.data?.length ?? 0);
    });
  }, [schoolId]);

  const strategyCtx: StrategyContext = useMemo(() => {
    const teachersByGrade: Record<string, number> = {};
    for (const t of teachers) {
      teachersByGrade[t.grade] = (teachersByGrade[t.grade] ?? 0) + 1;
    }
    return {
      conflictGrades: data.conflictGrades,
      gradesServed: grades,
      specialistCount,
      teachersByGrade,
      hasLunchConfig: recessExists,
      hasClubs: clubsCount > 0,
      classDuration: data.classDuration ?? 45,
      bigGroupConfig: bigGroupConfig,
    };
  }, [data.conflictGrades, grades, specialistCount, teachers, recessExists, clubsCount, data.classDuration, bigGroupConfig]);

  const recommendations = useMemo(() => getRecommendedStrategies(strategyCtx), [strategyCtx]);
  const recommendedKeys = useMemo(() => recommendations.map(r => r.key), [recommendations]);

  const handleAutoRecommend = () => {
    const recKeys = recommendations.map(r => r.key);
    // Set conflict grades for Quick 30 if recommended
    const youngGrades = grades.filter(g => g === 'K' || g === '1');
    const newConflictGrades = recKeys.includes('quick_30') ? [...new Set([...data.conflictGrades, ...youngGrades])] : data.conflictGrades;
    updateData({ conflictStrategies: recKeys, conflictGrades: newConflictGrades });
    toast({
      title: '✨ Strategies auto-selected',
      description: recommendations.map(r => `${strategies.find(s => s.key === r.key)?.title}: ${r.reason}`).join('\n'),
    });
  };

  const unselectedStrategies = strategies.filter(s => !selected.includes(s.key));

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-bold text-card-foreground">Scheduling Conflicts</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure how the scheduler resolves competing class needs
          </p>
        </div>
        <SaveStatusIndicator status={saveStatus} />
      </div>

      {/* ─── Section 1: Grade conflict chips ─── */}
      {grades.length > 0 && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Which grades have scheduling conflicts?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select grades where two or more teachers compete for the same specialist
            </p>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {grades.map(g => {
              const count = strategyCtx.teachersByGrade[g] ?? 0;
              const isSelected = data.conflictGrades.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => toggleConflictGrade(g)}
                  className={cn(
                    'flex flex-col items-center justify-center gap-0.5 rounded-xl border-2 py-2.5 px-2 transition-all',
                    isSelected
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:border-primary/40'
                  )}
                >
                  <span className="text-sm font-bold leading-none">{g}</span>
                  <span className="text-[10px] text-muted-foreground leading-none mt-1">
                    {count} tchr{count !== 1 ? 's' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Section 2: Strategy selection ─── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Conflict Resolution Strategies</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tried in priority order — drag to reorder. At least one required.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAutoRecommend}
            disabled={specialistCount === 0 && teachers.length === 0}
            className="gap-1.5 shrink-0"
          >
            <Sparkles className="h-3.5 w-3.5" /> Auto-recommend
          </Button>
        </div>

        {/* Selected strategies — DnD */}
        {selected.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Priority order</p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={selected} strategy={verticalListSortingStrategy}>
                <div className="space-y-3">
                  {selected.map((key, idx) => (
                    <div key={key} className="space-y-1">
                      <SortableStrategyCard
                        strategyKey={key}
                        priority={idx + 1}
                        onRemove={removeStrategy}
                        onPreview={setPreviewKey}
                        strategyCtx={strategyCtx}
                        recommendedKeys={recommendedKeys}
                      />
                      {key === 'lunch_clubs' && (
                        clubsCount > 0 ? (
                          <div className="ml-10 border-l-2 border-l-emerald-400 pl-3 py-1">
                            <p className="text-xs text-emerald-700 dark:text-emerald-300">
                              ✓ Will use {clubsCount} club{clubsCount === 1 ? '' : 's'} from Step 7.
                            </p>
                          </div>
                        ) : (
                          <div className="ml-10 border-l-2 border-l-amber-400 pl-3 py-1">
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                              No clubs yet —{' '}
                              <button
                                type="button"
                                onClick={() => setStep(SETUP_STEPS.CLUBS)}
                                className="font-semibold underline-offset-2 hover:underline"
                              >
                                add some on Step 7
                              </button>
                              .
                            </p>
                          </div>
                        )
                      )}
                    </div>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}

        {/* Available (unselected) strategies */}
        {unselectedStrategies.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {selected.length > 0 ? 'Add more' : 'Choose strategies'}
            </p>
            {unselectedStrategies.map(s => {
              const note = getStrategyNote(s.key, strategyCtx);
              const isDisabled = note.severity === 'error';
              const isRecommended = recommendedKeys.includes(s.key);
              const theme = getCategoryTheme(s.key);
              return (
                <div key={s.key} className="space-y-0">
                  <div
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border border-l-4 p-3.5 text-left transition-all shadow-sm bg-card',
                      theme.topBorder,
                      isDisabled ? 'border-border opacity-60 cursor-not-allowed' : cn(theme.border, 'hover:bg-muted/40')
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => !isDisabled && toggleStrategy(s.key)}
                      disabled={isDisabled}
                      className="flex flex-1 items-center gap-3 text-left disabled:cursor-not-allowed"
                    >
                      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', theme.iconBg, theme.iconText)}>
                        <s.icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm text-foreground">{s.title}</p>
                          <span className={cn('text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md', theme.pillBg, theme.pillText)}>
                            {theme.label}
                          </span>
                          {isRecommended && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-primary text-primary-foreground">
                              Recommended
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
                        {getStrategyPreviewBlurb(s.key) && (
                          <p className="mt-1 text-xs italic text-foreground/60">
                            <span className="font-medium not-italic text-foreground/75">Your week:</span> {getStrategyPreviewBlurb(s.key)}
                          </p>
                        )}
                      </div>
                      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setPreviewKey(s.key); }}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0 px-1"
                      aria-label="Preview strategy"
                    >
                      <Eye className="h-3 w-3" /> Preview
                    </button>
                  </div>
                  <FeasibilityNote strategyKey={s.key} ctx={strategyCtx} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Section 3: Advanced Options (collapsible) ─── */}
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <button
          type="button"
          onClick={() => setAdvancedOpen(o => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted/30 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            Advanced Options
          </span>
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', advancedOpen && 'rotate-180')} />
        </button>

        {advancedOpen && (
          <div className="border-t border-border px-4 pb-5 pt-4 space-y-5">
            {/* Conflict resolution timing */}
            <div className="space-y-2.5">
              <FieldLabel className="text-sm font-semibold text-foreground" tooltip="Controls whether strategies run automatically or require manual resolution after draft">
                When should conflicts be resolved?
              </FieldLabel>
              <RadioGroup
                value={data.conflictTiming}
                onValueChange={(v) => updateData({ conflictTiming: v as 'before' | 'after' })}
              >
                <div className="flex items-start space-x-2">
                  <RadioGroupItem value="before" id="timing-before" className="mt-0.5" />
                  <Label htmlFor="timing-before" className="text-sm cursor-pointer">
                    <span className="font-medium">Before generation</span>
                    <p className="text-xs text-muted-foreground">Set preferences first, then generate a conflict-free schedule</p>
                  </Label>
                </div>
                <div className="flex items-start space-x-2">
                  <RadioGroupItem value="after" id="timing-after" className="mt-0.5" />
                  <Label htmlFor="timing-after" className="text-sm cursor-pointer">
                    <span className="font-medium">After draft</span>
                    <p className="text-xs text-muted-foreground">Generate first, then resolve conflicts manually in the schedule view</p>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Quick 30 grade assignment */}
            {selected.includes('quick_30') && (
              <div className="space-y-2">
                <FieldLabel className="text-sm font-semibold text-foreground" tooltip="Selected grades get 30-min sessions; others keep the default duration">
                  Which grades get 30-minute sessions?
                </FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {grades.map(g => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => toggleConflictGrade(g)}
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-lg border-2 text-sm font-bold transition-all',
                        data.conflictGrades.includes(g)
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground hover:border-primary/30'
                      )}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Big group class splits */}
            {selected.includes('big_group') && (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Configure class splits</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Select a grade, then pick 2+ classes to combine.</p>
                </div>
                <div className="space-y-2">
                  <FieldLabel className="text-xs font-medium text-foreground" tooltip="Pick 2+ classes from the same grade to combine">Select grade:</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {grades.map(g => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => { setBigGroupGrade(g); setBigGroupSelected([]); }}
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-lg border-2 text-sm font-bold transition-all',
                          bigGroupGrade === g ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:border-primary/30'
                        )}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
                {bigGroupGrade && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">Select classes to combine (Grade {bigGroupGrade}):</p>
                    {gradeTeachers.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">No teachers found for Grade {bigGroupGrade}.</p>
                    ) : (
                      <div className="space-y-2">
                        {gradeTeachers.map(t => (
                          <label key={t.id} className="flex items-center gap-2 cursor-pointer">
                            <Checkbox checked={bigGroupSelected.includes(t.id)} onCheckedChange={() => toggleBigGroupTeacher(t.id)} />
                            <span className="text-sm text-foreground">{t.name}</span>
                            {t.room && <span className="text-xs text-muted-foreground">(Room {t.room})</span>}
                          </label>
                        ))}
                        <Button size="sm" onClick={addBigGroupSplit} disabled={bigGroupSelected.length < 2} className="mt-2">Add Split</Button>
                      </div>
                    )}
                  </div>
                )}
                {bigGroupConfig.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">Configured splits:</p>
                    {bigGroupConfig.map((split, idx) => (
                      <div key={idx} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
                        <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">Grade {split.grade}</span>
                        <span className="text-xs text-foreground flex-1">{split.teacherIds.map(id => getTeacherName(id)).join(' + ')}</span>
                        <button type="button" onClick={() => removeBigGroupSplit(idx)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <CombinedClassesSection teachers={teachers} onChanged={reloadTeachers} />
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={() => setStep(SETUP_STEPS.EVENTS)}>Back</Button>
        {selected.length === 0 ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button disabled>Continue</Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Pick at least one conflict resolution strategy.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Button onClick={() => setStep(SETUP_STEPS.REVIEW)}>Continue</Button>
        )}
      </div>

      <StrategyPreviewModal
        open={previewKey !== null}
        onOpenChange={(o) => { if (!o) setPreviewKey(null); }}
        strategyKey={previewKey}
      />
    </div>
  );
};


export default StepConflict;
