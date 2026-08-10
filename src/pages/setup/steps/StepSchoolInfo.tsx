import { useState, useEffect, useRef, useCallback } from 'react';
import { SaveStatusIndicator, type SaveStatus } from '@/components/setup/SaveStatusIndicator';
import { SETUP_STEPS } from '../stepIndex';
import { useFlushOnUnmount } from '@/hooks/useFlushOnUnmount';
import { useSetup } from '@/contexts/SetupContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field-label';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, ChevronDown, Check, Sparkles, Users2, Coffee, ListOrdered, Timer } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useBlurValidation } from '@/components/setup/useBlurValidation';
import { saveSchoolRow } from '@/lib/schoolSave';
import { FieldError } from '@/components/setup/FieldError';

const allGrades = ['K', '1', '2', '3', '4', '5', '6'];
const presets = [
  { label: 'K–5', grades: ['K', '1', '2', '3', '4', '5'] },
  { label: 'K–6', grades: ['K', '1', '2', '3', '4', '5', '6'] },
];

const StepSchoolInfo = () => {
  const { data, updateData, setStep, schoolId, setSchoolId } = useSetup();
  const { user } = useAuth();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const isLoaded = useRef(false);
  const workspaceIdRef = useRef<string | null>(null);

  // New params persisted directly (not yet in SetupContext to avoid a wide types churn).
  const [keepGradesTogether, setKeepGradesTogether] = useState<boolean>(true);
  const [suggestExtraPlt, setSuggestExtraPlt] = useState<boolean>(false);
  const [extraPltTargetMinutes, setExtraPltTargetMinutes] = useState<number | ''>('');
  // '' = no cap. DB default is 120 (migration 20260718000000).
  const [maxTeamOutMinutes, setMaxTeamOutMinutes] = useState<number | ''>(120);

  // Inline blur validation for the required / constrained fields.
  const v = useBlurValidation();
  const nameError = !data.schoolName.trim() ? 'School name is required.' : null;
  const endError = data.startTime && data.endTime && data.endTime <= data.startTime ? 'End time must be after the start time.' : null;
  const durationError = !data.classDuration || data.classDuration <= 0 ? 'Enter a class length in minutes.' : null;

  // Load existing school data from DB on mount
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data: membership } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (!membership) { isLoaded.current = true; return; }
      workspaceIdRef.current = membership.workspace_id;

      if (!schoolId) {
        const { data: existingSchool } = await supabase
          .from('schools')
          .select('*')
          .eq('workspace_id', membership.workspace_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existingSchool) {
          setSchoolId(existingSchool.id);
          updateData({
            schoolName: existingSchool.name || '',
            website: existingSchool.website || '',
            startTime: existingSchool.start_time || '08:00',
            endTime: existingSchool.end_time || '15:00',
            rotationsStartTime: (existingSchool as any).rotations_start_time || '',
            planningTimeWhen: (existingSchool as any).planning_time_when || 'during_rotations',
            classDuration: existingSchool.class_duration || 45,
            planningMinutes: existingSchool.planning_minutes || 45,
            lunchMinutes: existingSchool.lunch_minutes || 30,
            passingTime: existingSchool.passing_time || 5,
            setupTime: existingSchool.setup_time || 15,
            gradeTimeConfig: (existingSchool.grade_time_config as Record<string, { passingTime?: number; resetTime?: number }>) || {},
            schoolYear: existingSchool.school_year || '2025-2026',
            schoolYearStart: (existingSchool as any).school_year_start ? String((existingSchool as any).school_year_start).slice(0, 10) : '',
            schoolYearEnd: (existingSchool as any).school_year_end ? String((existingSchool as any).school_year_end).slice(0, 10) : '',
            gradesServed: existingSchool.grades_served || [],
            notes: existingSchool.notes || '',
            earlyReleaseDay: (existingSchool as any).early_release_day || '',
            earlyReleaseEndTime: (existingSchool as any).early_release_end_time || '',
            defaultAmPmPreference: (existingSchool as any).default_am_pm_preference || '',
            defaultDayPreference: (existingSchool as any).default_day_preference || '',
          });
          setKeepGradesTogether(existingSchool.keep_grades_together ?? true);
          setSuggestExtraPlt(existingSchool.suggest_extra_plt ?? false);
          setExtraPltTargetMinutes(existingSchool.extra_plt_target_minutes ?? '');
          setMaxTeamOutMinutes((existingSchool as { max_team_out_minutes?: number | null }).max_team_out_minutes ?? '');
        }
      } else {
        // Already have a school id — load just the new params.
        // `select('*')`: naming a column the live DB doesn't have yet 400s the
        // WHOLE row (and this call discards its error), so the step would load
        // blank defaults and then quietly overwrite good data on the next save.
        const { data: extras } = await supabase
          .from('schools')
          .select('*')
          .eq('id', schoolId)
          .maybeSingle();
        if (extras) {
          setKeepGradesTogether(extras.keep_grades_together ?? true);
          setSuggestExtraPlt(extras.suggest_extra_plt ?? false);
          setExtraPltTargetMinutes(extras.extra_plt_target_minutes ?? '');
          setMaxTeamOutMinutes((extras as { max_team_out_minutes?: number | null }).max_team_out_minutes ?? '');
        }
      }
      isLoaded.current = true;
    };
    load();
  }, [user]);

  // Auto-save with debounce
  const autoSave = useCallback(async () => {
    if (!isLoaded.current || !workspaceIdRef.current || !data.schoolName.trim()) return;
    setSaveStatus('saving');
    try {
      const schoolData: Record<string, any> = {
        name: data.schoolName,
        website: data.website || null,
        start_time: data.startTime,
        end_time: data.endTime,
        rotations_start_time: data.rotationsStartTime || null,
        planning_time_when: data.planningTimeWhen || 'during_rotations',
        class_duration: data.classDuration,
        planning_minutes: data.planningMinutes,
        lunch_minutes: data.lunchMinutes,
        passing_time: data.passingTime,
        setup_time: data.setupTime,
        grade_time_config: data.gradeTimeConfig,
        school_year: data.schoolYear,
        school_year_start: data.schoolYearStart || null,
        school_year_end: data.schoolYearEnd || null,
        grades_served: data.gradesServed,
        notes: data.notes || null,
        early_release_day: data.earlyReleaseDay || null,
        early_release_end_time: data.earlyReleaseEndTime || null,
        default_am_pm_preference: null,
        default_day_preference: null,
        keep_grades_together: keepGradesTogether,
        suggest_extra_plt: suggestExtraPlt,
        extra_plt_target_minutes: extraPltTargetMinutes === '' ? null : Number(extraPltTargetMinutes),
        max_team_out_minutes: maxTeamOutMinutes === '' ? null : Number(maxTeamOutMinutes),
        workspace_id: workspaceIdRef.current,
      };

      // Routed through saveSchoolRow so an unapplied migration (a column the
      // live DB doesn't have yet) costs that ONE setting instead of the whole
      // session — and so a brand-new school always ends up with a row, which
      // every later wizard step depends on.
      const outcome = await saveSchoolRow(supabase, schoolId, schoolData, (col) => {
        toast.warning(
          `Your database is missing the "${col}" setting — everything else was saved. Ask your admin to apply the pending migration.`,
          { id: `schema-drift-${col}`, duration: 8000 },
        );
      });
      if (outcome.schoolId && outcome.schoolId !== schoolId) setSchoolId(outcome.schoolId);
      if (!outcome.ok) throw new Error(outcome.error?.message ?? 'Save failed');

      // Mirror Daily sequence selection into coordinator_prep so the prep sheet stays in sync.
      if (data.gradePreference && workspaceIdRef.current) {
        const targetSchoolId = schoolId;
        let q = supabase.from('coordinator_prep').select('id').eq('workspace_id', workspaceIdRef.current);
        q = targetSchoolId ? q.eq('school_id', targetSchoolId) : q.is('school_id', null);
        const { data: existingPrep } = await q.maybeSingle();
        if (existingPrep?.id) {
          await supabase.from('coordinator_prep').update({ grade_preference: data.gradePreference } as any).eq('id', existingPrep.id);
        } else {
          await supabase.from('coordinator_prep').insert({
            workspace_id: workspaceIdRef.current,
            school_id: targetSchoolId,
            grade_preference: data.gradePreference,
          } as any);
        }
      }

      setSaveError(null);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus((cur) => (cur === 'saved' ? 'idle' : cur)), 2000);
    } catch (err: any) {
      // A failed save must never look like a successful one — and must leave a
      // PERSISTENT trace. 'idle' rendered nothing, so a coordinator kept typing
      // into a wizard that was saving nothing.
      console.error('School info save failed:', err);
      toast.error(`Couldn't save school info${err?.message ? ` — ${err.message}` : ''}. Check your connection and try again.`);
      setSaveError(err?.message ?? 'Save failed');
      setSaveStatus('error');
    }
  }, [data.schoolName, data.website, data.startTime, data.endTime, data.rotationsStartTime, data.planningTimeWhen, data.classDuration, data.planningMinutes, data.lunchMinutes, data.passingTime, data.setupTime, data.gradeTimeConfig, data.schoolYear, data.schoolYearStart, data.schoolYearEnd, data.gradesServed, data.notes, data.earlyReleaseDay, data.earlyReleaseEndTime, data.gradePreference, keepGradesTogether, suggestExtraPlt, extraPltTargetMinutes, maxTeamOutMinutes, schoolId]);

  useFlushOnUnmount(saveTimer, () => { if (isLoaded.current) autoSave(); });

  useEffect(() => {
    if (!isLoaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => autoSave(), 1500);
  }, [autoSave]);

  const toggleGrade = (g: string) => {
    const current = data.gradesServed;
    updateData({
      gradesServed: current.includes(g) ? current.filter(x => x !== g) : [...current, g]
    });
  };

  const applyPreset = (grades: string[]) => {
    updateData({ gradesServed: grades });
  };

  const rotationsBeforeSchool = Boolean(data.rotationsStartTime && data.startTime && data.rotationsStartTime < data.startTime);

  const handleContinue = () => {
    v.touchAll(['schoolName', 'endTime', 'classDuration']);
    if (!data.schoolName.trim()) { toast.error('Please enter a school name'); return; }
    if (data.gradesServed.length === 0) { toast.error('Please select at least one grade'); return; }
    if (rotationsBeforeSchool) { toast.error("Rotations can't start before school does."); return; }
    // Happy path skips the optional Calendar step — it lives in the Extras group.
    setStep(SETUP_STEPS.RECESS_LUNCH);
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-card-foreground">School Information</h2>
        <SaveStatusIndicator status={saveStatus} errorMessage={saveError} onRetry={() => autoSave()} />
      </div>
      {/* Grades Served — top of card */}
      <div className="mb-6 space-y-3">
        <div>
          <FieldLabel className="text-base font-semibold" tooltip="Select all grade levels at this school">Grades Served</FieldLabel>
          <p className="text-xs text-muted-foreground mt-0.5">Select the grade levels at this school.</p>
        </div>
        <div className="flex gap-2">
          {presets.map(p => (
            <Button
              key={p.label}
              size="sm"
              variant={JSON.stringify([...data.gradesServed].sort()) === JSON.stringify([...p.grades].sort()) ? 'default' : 'outline'}
              onClick={() => applyPreset(p.grades)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          {allGrades.map(g => (
            <button
              key={g}
              onClick={() => toggleGrade(g)}
              className={cn(
                'flex h-14 w-14 items-center justify-center rounded-xl border-2 text-lg font-bold transition-all',
                data.gradesServed.includes(g)
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/30'
              )}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <FieldLabel tooltip="Official school name used in reports and exports">School Name</FieldLabel>
          <Input
            value={data.schoolName}
            onChange={(e) => updateData({ schoolName: e.target.value })}
            onBlur={() => v.touch('schoolName')}
            aria-invalid={!!v.errorFor('schoolName', nameError)}
          />
          <FieldError error={v.errorFor('schoolName', nameError)} />
        </div>
        <div className="space-y-2">
          <FieldLabel tooltip="Used to fetch your school calendar if available">School Website (optional)</FieldLabel>
          <Input value={data.website} onChange={(e) => updateData({ website: e.target.value })} placeholder="https://" />
        </div>
        <div className="space-y-2">
          <FieldLabel tooltip="When the first bell rings — classes can be scheduled from this time">School Start Time</FieldLabel>
          <Input type="time" value={data.startTime} onChange={(e) => updateData({ startTime: e.target.value })} />
        </div>
        <div className="space-y-2">
          <FieldLabel tooltip="Optional. Leave blank if rotations begin at the school start time.">Specials rotations begin at (optional)</FieldLabel>
          <Input type="time" value={data.rotationsStartTime} onChange={(e) => updateData({ rotationsStartTime: e.target.value })} />
          <p className="text-xs text-muted-foreground">Leave blank if rotations start at the school start time.</p>
          {rotationsBeforeSchool && (
            <p className="text-xs text-destructive">Rotations can't start before school does.</p>
          )}
        </div>
        <div className="space-y-2">
          <FieldLabel tooltip="Latest dismissal time on a regular day">School End Time</FieldLabel>
          <Input
            type="time"
            value={data.endTime}
            onChange={(e) => updateData({ endTime: e.target.value })}
            onBlur={() => v.touch('endTime')}
            aria-invalid={!!v.errorFor('endTime', endError)}
          />
          <FieldError error={v.errorFor('endTime', endError)} />
        </div>
        <div className="space-y-2">
          <FieldLabel tooltip="Length of each specialist class in minutes (e.g. 45)">Class Duration (min)</FieldLabel>
          <Input
            type="number"
            value={data.classDuration}
            onChange={(e) => updateData({ classDuration: Number(e.target.value) })}
            onBlur={() => v.touch('classDuration')}
            aria-invalid={!!v.errorFor('classDuration', durationError)}
          />
          <FieldError error={v.errorFor('classDuration', durationError)} />
        </div>
        <div className="space-y-2">
          <FieldLabel tooltip="Time classroom teachers are released while students are with a specialist, per week.">Planning Minutes/Week</FieldLabel>
          <Input type="number" min={0} value={data.planningMinutes} onChange={(e) => updateData({ planningMinutes: Math.max(0, Number(e.target.value)) })} />
        </div>
        <div className="space-y-2">
          <FieldLabel tooltip="This sets the default. You can override it per specialist in the Specialists step.">When does planning time occur?</FieldLabel>
          <Select value={data.planningTimeWhen || 'during_rotations'} onValueChange={(v) => updateData({ planningTimeWhen: v })}>
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="before_school">Before school</SelectItem>
              <SelectItem value="during_rotations">During rotations</SelectItem>
              <SelectItem value="after_school">After school</SelectItem>
              <SelectItem value="mixed">Mixed (set per specialist)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <FieldLabel tooltip="Required duty-free lunch break length for all staff.">Contractual Lunch Minutes</FieldLabel>
          <Input type="number" min={0} value={data.lunchMinutes} onChange={(e) => updateData({ lunchMinutes: Math.max(0, Number(e.target.value)) })} />
        </div>
        <div className="space-y-2">
          <FieldLabel tooltip="Minutes between classes for students to transition in hallways.">Passing Time (min)</FieldLabel>
          <Input type="number" min={0} value={data.passingTime} onChange={(e) => updateData({ passingTime: Math.max(0, Number(e.target.value)) })} />
        </div>
        <div className="space-y-2">
          <FieldLabel tooltip="Minutes a specialist needs to reset the room between classes.">Reset Time (min)</FieldLabel>
          <Input type="number" min={0} value={data.setupTime} onChange={(e) => updateData({ setupTime: Math.max(0, Number(e.target.value)) })} />
        </div>
        <div className="space-y-2">
          <FieldLabel tooltip="Academic year label shown on exports (e.g. 2025–2026)">School Year</FieldLabel>
          <Input value={data.schoolYear} onChange={(e) => updateData({ schoolYear: e.target.value })} />
        </div>
        <div className="space-y-2">
          <FieldLabel tooltip="First instructional day. Anchors A/B and AA/BB week labels to the real calendar. Optional — we estimate from the school year if left blank.">First Day of School (optional)</FieldLabel>
          <Input type="date" value={data.schoolYearStart} onChange={(e) => updateData({ schoolYearStart: e.target.value })} />
        </div>
        <div className="space-y-2">
          <FieldLabel tooltip="Last instructional day. Bounds the week cycle. Optional — we estimate from the school year if left blank.">Last Day of School (optional)</FieldLabel>
          <Input type="date" value={data.schoolYearEnd} onChange={(e) => updateData({ schoolYearEnd: e.target.value })} />
        </div>
        <div className="space-y-2">
          <FieldLabel tooltip="Which weekday has early dismissal, if any">Early Release Day</FieldLabel>
          <Select value={data.earlyReleaseDay || 'none'} onValueChange={(v) => updateData({ earlyReleaseDay: v === 'none' ? '' : v })}>
            <SelectTrigger className="h-10">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="Mon">Monday</SelectItem>
              <SelectItem value="Tue">Tuesday</SelectItem>
              <SelectItem value="Wed">Wednesday</SelectItem>
              <SelectItem value="Thu">Thursday</SelectItem>
              <SelectItem value="Fri">Friday</SelectItem>
            </SelectContent>
          </Select>
        </div>
         {data.earlyReleaseDay && (
          <div className="space-y-2">
            <FieldLabel tooltip={`What time school ends on ${data.earlyReleaseDay}`}>Early Release End Time</FieldLabel>
            <Input type="time" value={data.earlyReleaseEndTime} onChange={(e) => updateData({ earlyReleaseEndTime: e.target.value })} />
          </div>
        )}
      </div>


      {data.gradesServed.length > 0 && (
        <Collapsible className="mt-4">
          <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-card-foreground hover:text-primary transition-colors">
            <ChevronDown className="h-4 w-4" />
            Per-Grade Time Overrides
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <p className="text-xs text-muted-foreground mb-3">Override passing time and reset time for specific grades. Leave blank to use school defaults.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data.gradesServed.map(grade => (
                <div key={grade} className="rounded-lg border border-border bg-background p-3 space-y-2">
                  <span className="text-xs font-semibold text-card-foreground">Grade {grade}</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <FieldLabel className="text-xs" tooltip="Override default passing time for this grade">Passing (min)</FieldLabel>
                      <Input
                        className="h-8 text-xs"
                        type="number"
                        placeholder={String(data.passingTime)}
                        value={data.gradeTimeConfig[grade]?.passingTime ?? ''}
                        onChange={(e) => {
                          const val = e.target.value ? Number(e.target.value) : undefined;
                          updateData({
                            gradeTimeConfig: {
                              ...data.gradeTimeConfig,
                              [grade]: { ...data.gradeTimeConfig[grade], passingTime: val },
                            },
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <FieldLabel className="text-xs" tooltip="Override default reset time for this grade">Reset (min)</FieldLabel>
                      <Input
                        className="h-8 text-xs"
                        type="number"
                        placeholder={String(data.setupTime)}
                        value={data.gradeTimeConfig[grade]?.resetTime ?? ''}
                        onChange={(e) => {
                          const val = e.target.value ? Number(e.target.value) : undefined;
                          updateData({
                            gradeTimeConfig: {
                              ...data.gradeTimeConfig,
                              [grade]: { ...data.gradeTimeConfig[grade], resetTime: val },
                            },
                          });
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="mt-6 rounded-lg border border-border bg-muted/20 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Scheduling preferences</h3>
        </div>

        {/* Row 1 — keep grades together */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Users2 className="h-4 w-4 text-muted-foreground" />
              <FieldLabel className="text-sm font-medium" tooltip="The scheduler will try to keep all sections of the same grade in adjacent or overlapping blocks. Disable for more flexibility.">
                Keep grade levels together
              </FieldLabel>
            </div>
            <p className="text-xs text-muted-foreground">All sections of a grade get specials at the same or adjacent times.</p>
          </div>
          <Switch checked={keepGradesTogether} onCheckedChange={setKeepGradesTogether} />
        </div>

        {/* Row 2 — Open time slot (was: Suggest extra PLT) */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Coffee className="h-4 w-4 text-muted-foreground" />
              <FieldLabel className="text-sm font-medium" tooltip="A shared free block in the week — used by the coordinator to discuss make-up time (e.g. lunch clubs counted toward instructional minutes).">
                Open time slot
              </FieldLabel>
            </div>
            <p className="text-xs text-muted-foreground">A common free slot per week. The coordinator uses it to track make-up teaching minutes (e.g. lunch clubs).</p>
          </div>
          <Switch checked={suggestExtraPlt} onCheckedChange={setSuggestExtraPlt} />
        </div>
        {suggestExtraPlt && (
          <div className="space-y-2 pl-6">
            <FieldLabel className="text-xs" tooltip="Target free minutes per week to reserve for make-up teaching">Target minutes / week</FieldLabel>
            <Input
              type="number"
              className="h-9 max-w-[160px]"
              placeholder="e.g. 30"
              value={extraPltTargetMinutes}
              onChange={(e) => setExtraPltTargetMinutes(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>
        )}

        {/* Row 2.6 — Teacher team out-of-class cap (PM: "no more than 90
            minutes together, or 120" — planning is before/after school, so a
            grade's teachers must not be pulled out all day). */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-muted-foreground" />
              <FieldLabel className="text-sm font-medium" tooltip="Longest stretch a grade's teachers may be out of their classrooms back-to-back (their classes at consecutive specials). Longer stretches get an advisory warning on the generated schedule.">
                Teacher out-of-class cap
              </FieldLabel>
            </div>
            <p className="text-xs text-muted-foreground">Warn when a grade's wheel keeps its teachers out longer than this, back-to-back.</p>
          </div>
          <div className="flex items-center gap-1.5">
            {[
              { v: '' as const, label: 'Off' },
              { v: 90, label: '90 min' },
              { v: 120, label: '120 min' },
            ].map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setMaxTeamOutMinutes(opt.v)}
                className={cn(
                  'rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                  maxTeamOutMinutes === opt.v
                    ? 'border-accent bg-accent/10 font-medium text-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/40',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 3 — Daily sequence */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ListOrdered className="h-4 w-4 text-muted-foreground" />
            <FieldLabel className="text-sm font-medium" tooltip="How the scheduler orders grades across the day.">
              Daily sequence
            </FieldLabel>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { v: 'keep_together', label: 'Keep grades together' },
              { v: 'waterfall', label: 'Waterfall' },
              { v: 'fixed_sequence', label: 'Fixed K → 5' },
            ].map(opt => {
              const active = data.gradePreference === opt.v;
              return (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => updateData({ gradePreference: opt.v as any })}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:border-primary/40',
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {data.gradePreference === 'waterfall' && 'Same grade, different blocks/days — e.g. 3A intro Period 1, 3B mid-unit Period 3.'}
            {data.gradePreference === 'fixed_sequence' && 'Walk K → 5 in order every day.'}
            {(data.gradePreference === 'keep_together' || !data.gradePreference) && 'Minimize the spread of each grade across the day.'}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <FieldLabel tooltip="Any special scheduling constraints or notes for the algorithm">Notes (optional)</FieldLabel>
        <Textarea value={data.notes} onChange={(e) => updateData({ notes: e.target.value })} placeholder="Any special scheduling notes..." rows={3} />
      </div>
      <div className="mt-6 flex justify-between">
        <Button variant="outline" onClick={() => setStep(SETUP_STEPS.WELCOME)}>Back</Button>
        <Button onClick={handleContinue} disabled={!data.schoolName.trim() || data.gradesServed.length === 0 || rotationsBeforeSchool}>
          Continue
        </Button>
      </div>
    </div>
  );
};

export default StepSchoolInfo;
