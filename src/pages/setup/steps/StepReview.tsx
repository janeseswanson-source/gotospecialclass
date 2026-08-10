import { useState, useEffect, useRef } from 'react';
import { SETUP_STEPS } from '../stepIndex';
import { useSetup } from '@/contexts/SetupContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Rocket, Loader2, School, Users, Star, Calendar, Cog, AlertTriangle, CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logActivity } from '@/lib/activityLogger';
import { track } from '@/lib/observability';
import { generateBestSchedule } from '@/lib/generateBestSchedule';
import { progressLabel } from '@/lib/genJobProgress';
import { getStrategyTitle } from '@/lib/conflictStrategies';
import { analyzeContractFeasibility } from '@/lib/contractFeasibility';
import { cn } from '@/lib/utils';
import { SafeSection } from '@/components/SafeSection';

const BUILD_MESSAGES = [
  'Reading your school setup...',
  'Trying thousands of schedule layouts...',
  'Working around recess, lunch, and planning time...',
  'Polishing the best version...',
  'Double-checking every class is covered...',
  'Almost there...',
];

const StepReview = () => {
  const { data, setStep, schoolId, clearDraft } = useSetup();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [building, setBuilding] = useState(false);
  const [clubCount, setClubCount] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [teacherCount, setTeacherCount] = useState(0);
  const [teacherRows, setTeacherRows] = useState<any[]>([]);
  const [specialistRows, setSpecialistRows] = useState<any[]>([]);
  const [progressMsg, setProgressMsg] = useState(BUILD_MESSAGES[0]);
  const [genProgress, setGenProgress] = useState('');
  const msgIdxRef = useRef(0);

  useEffect(() => {
    if (!schoolId) return;
    supabase.from('clubs').select('id', { count: 'exact', head: true }).eq('school_id', schoolId)
      .then(({ count }) => setClubCount(count || 0));
    supabase.from('special_events').select('id', { count: 'exact', head: true }).eq('school_id', schoolId)
      .then(({ count }) => setEventCount(count || 0));
    supabase.from('classroom_teachers').select('id, name, grade').eq('school_id', schoolId)
      .then(({ data: rows }) => { setTeacherRows(rows || []); setTeacherCount((rows || []).length); });
    supabase.from('specialists').select('*').eq('school_id', schoolId)
      .then(({ data: rows }) => setSpecialistRows(rows || []));
  }, [schoolId]);

  useEffect(() => {
    if (!building) { msgIdxRef.current = 0; setProgressMsg(BUILD_MESSAGES[0]); return; }
    const iv = setInterval(() => {
      msgIdxRef.current = (msgIdxRef.current + 1) % BUILD_MESSAGES.length;
      setProgressMsg(BUILD_MESSAGES[msgIdxRef.current]);
    }, 3500);
    return () => clearInterval(iv);
  }, [building]);

  const specialistCount = specialistRows.length;
  const hasAnyRecessOrLunch = Object.values(data.recessConfig).some(
    (c: any) => (c.amRecessStart && c.amRecessEnd) || (c.lunchStart && c.lunchEnd) || (c.pmRecessStart && c.pmRecessEnd)
  );

  const checks = [
    { ok: !!data.schoolName, label: 'School name set (School Info)' },
    { ok: data.gradesServed.length > 0, label: 'At least 1 grade (School Info)' },
    { ok: specialistCount > 0, label: 'At least 1 specialist (Specialists)' },
    { ok: teacherCount > 0, label: 'At least 1 classroom teacher (Teachers)' },
    { ok: hasAnyRecessOrLunch, label: 'Recess or lunch configured (Recess & Lunch)' },
    { ok: data.conflictStrategies.length > 0, label: 'Conflict strategy selected (Conflicts)' },
  ];
  const missing = checks.filter(c => !c.ok);
  const okCount = checks.length - missing.length;

  // Pre-flight feasibility (reuses the shared contractFeasibility lib). Error-level
  // notes are HARD gaps that block Generate; warnings are advisory.
  const feasibilityNotes = analyzeContractFeasibility(
    {
      start_time: data.startTime,
      end_time: data.endTime,
      class_duration: data.classDuration,
      passing_time: data.passingTime,
      grades_served: data.gradesServed,
    },
    specialistRows,
    teacherRows,
  );
  const feasibilityErrors = feasibilityNotes.filter(n => n.level === 'error');
  const feasibilityWarnings = feasibilityNotes.filter(n => n.level === 'warning');
  // Generate is blocked by the basic checks OR any hard feasibility gap.
  const blockingReasons = [
    ...missing.map(m => m.label),
    ...feasibilityErrors.map(n => n.suggestion || n.message),
  ];

  const checkSteps = [
    SETUP_STEPS.SCHOOL_INFO,
    SETUP_STEPS.SCHOOL_INFO,
    SETUP_STEPS.SPECIALISTS,
    SETUP_STEPS.TEACHERS,
    SETUP_STEPS.RECESS_LUNCH,
    SETUP_STEPS.CONFLICTS,
  ];

  const complexity = teacherCount * specialistCount;
  const complexityLabel = complexity === 0 ? 'No data yet' : complexity < 20 ? 'Simple' : complexity < 50 ? 'Moderate' : 'Complex';
  const complexityDesc = complexity === 0 ? 'Add specialists and teachers first' : 'We keep trying for the best possible schedule (up to a few minutes), then AI polishes it.';
  const complexityColor = complexity === 0 ? 'text-muted-foreground' : complexity < 20 ? 'text-emerald-600 dark:text-emerald-400' : complexity < 50 ? 'text-amber-600 dark:text-amber-400' : 'text-destructive';

  const handleBuild = async () => {
    if (!user || !schoolId) {
      toast.error('Missing school or user info');
      return;
    }
    setBuilding(true);
    setGenProgress('');
    try {
      await supabase.from('schools').update({
        grades_served: data.gradesServed,
        schedule_type: data.scheduleType as any,
        // Conflict strategy fields are owned by StepConflict's auto-save (writes the
        // full ordered conflict_strategies array). Don't overwrite here with the stale
        // scalar — that was collapsing multi-strategy choices back to 'standard'.
        setup_complete: true,
        setup_step: 10,
      }).eq('id', schoolId);

      for (const [band, config] of Object.entries(data.recessConfig)) {
        await supabase.from('recess_lunch_config').upsert({
          school_id: schoolId,
          grade_band: band,
          am_recess_start: config.amRecessStart || null,
          am_recess_end: config.amRecessEnd || null,
          lunch_start: config.lunchStart || null,
          lunch_end: config.lunchEnd || null,
          pm_recess_start: config.pmRecessStart || null,
          pm_recess_end: config.pmRecessEnd || null,
        }, { onConflict: 'school_id,grade_band' });
      }

      // Keep generating independent schedules until we hit 99%+, then let Claude
      // polish the winner. Many short calls (each well under the Edge CPU limit)
      // instead of one long server run — so no CPU errors even over a few minutes.
      try {
        const result = await generateBestSchedule({
          schoolId,
          onProgress: (p) => setGenProgress(progressLabel(p)),
        });
        track('schedule_generated', { via: 'setup_wizard', quality: result.quality, attempts: result.attemptsRun, reached_target: result.reachedTarget, fallback: result.fallbackUsed });
      } catch (genErr: any) {
        console.error('Generate error:', genErr);
        toast.error(genErr?.message || 'Schedule generation had an issue, but your data is saved.');
      }
      logActivity('setup_completed', { school_name: data.schoolName });
      track('setup_completed');
      // Setup is committed to the database — stop offering the local draft.
      clearDraft();
      navigate('/app/schedule-success');
    } catch (err: any) {
      console.error('Build error:', err);
      toast.error('Something went wrong. Please try again.');
    } finally {
      setBuilding(false);
      setGenProgress('');
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-5">
        {/* Admin rotation advisory */}
        {(() => {
          const autoCount = (data.adminRotation || []).filter((e: any) => e.autoSchedule).length;
          if (autoCount === 0) return null;
          return (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <p className="text-xs">
                {autoCount} admin rotation block{autoCount === 1 ? '' : 's'} will be auto-scheduled.{' '}
                <button type="button" onClick={() => setStep(SETUP_STEPS.ADMIN_ROTATION)} className="underline hover:text-foreground font-semibold">Review</button>
              </p>
            </div>
          );
        })()}

        {/* ─── "Your school at a glance" metrics card ─── */}
        <SafeSection label="school at a glance">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <p className="text-sm font-bold text-card-foreground">Your school at a glance</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { icon: School, label: 'School', value: data.schoolName || 'Not set', missing: !data.schoolName, step: SETUP_STEPS.SCHOOL_INFO },
                { icon: Calendar, label: 'Hours', value: `${data.startTime}–${data.endTime}`, missing: false, step: SETUP_STEPS.SCHOOL_INFO },
                { icon: Users, label: 'Grades', value: data.gradesServed.length > 0 ? data.gradesServed.join(', ') : 'None', missing: data.gradesServed.length === 0, step: SETUP_STEPS.SCHOOL_INFO },
                { icon: Users, label: 'Teachers', value: teacherCount === 0 ? 'None yet' : String(teacherCount), missing: teacherCount === 0, step: SETUP_STEPS.TEACHERS },
                { icon: Cog, label: 'Specialists', value: specialistCount === 0 ? 'None yet' : String(specialistCount), missing: specialistCount === 0, step: SETUP_STEPS.SPECIALISTS },
                { icon: Star, label: 'Clubs', value: `${clubCount} club${clubCount !== 1 ? 's' : ''}, ${eventCount} event${eventCount !== 1 ? 's' : ''}`, missing: false, step: SETUP_STEPS.CLUBS },
              ].map(({ icon: Icon, label, value, missing: isMissing, step }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setStep(step)}
                  className={cn(
                    'flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-muted/40',
                    isMissing ? 'border-destructive/50 bg-destructive/5' : 'border-border bg-background'
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon className={cn('h-3.5 w-3.5 shrink-0', isMissing ? 'text-destructive' : 'text-muted-foreground')} />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
                  </div>
                  <span className={cn('text-xs font-semibold truncate', isMissing ? 'text-destructive' : 'text-foreground')}>
                    {value}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </SafeSection>

        {/* ─── Setup checklist ─── */}
        <SafeSection label="setup checklist">
          <div className="rounded-xl border border-border bg-card p-5 space-y-1.5">
            <p className="text-sm font-bold text-card-foreground mb-3">
              Setup checklist{' '}
              <span className="text-xs font-normal text-muted-foreground ml-1">
                {okCount}/{checks.length} complete
              </span>
            </p>
            {checks.map((check, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-0.5">
                <div className="flex items-center gap-2">
                  {check.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                  )}
                  <span className={cn('text-sm', check.ok ? 'text-foreground' : 'text-destructive')}>
                    {check.label}
                  </span>
                </div>
                {!check.ok && (
                  <button
                    type="button"
                    onClick={() => setStep(checkSteps[i])}
                    className="flex items-center gap-0.5 text-xs text-primary font-semibold hover:underline shrink-0"
                  >
                    Fix <ArrowRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </SafeSection>

        {/* ─── Feasibility pre-flight (shared contractFeasibility lib) ─── */}
        {(feasibilityErrors.length > 0 || feasibilityWarnings.length > 0) && (
          <SafeSection label="feasibility">
            <div className="rounded-xl border border-border bg-card p-5 space-y-2">
              <p className="text-sm font-bold text-card-foreground">Before you generate</p>
              {feasibilityErrors.map((n, i) => (
                <div key={`e${i}`} className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-destructive">{n.message}</p>
                    {n.suggestion && <p className="text-xs text-muted-foreground mt-0.5">{n.suggestion}</p>}
                  </div>
                </div>
              ))}
              {feasibilityWarnings.map((n, i) => (
                <div key={`w${i}`} className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{n.message}</p>
                    {n.suggestion && <p className="text-xs text-muted-foreground mt-0.5">{n.suggestion}</p>}
                  </div>
                </div>
              ))}
            </div>
          </SafeSection>
        )}

        {/* ─── "What will be generated" + generate button ─── */}
        <SafeSection label="generate">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <p className="text-sm font-bold text-card-foreground">What will be generated</p>

            {/* Strategies */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Strategies (in priority order)</p>
              {data.conflictStrategies.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {data.conflictStrategies.map((k, i) => (
                    <span key={k} className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary text-xs font-semibold px-2 py-0.5">
                      <span className="text-[10px] opacity-60">{i + 1}.</span> {getStrategyTitle(k)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-destructive">
                  No strategies selected.{' '}
                  <button type="button" onClick={() => setStep(SETUP_STEPS.CONFLICTS)} className="underline font-semibold">Add one in the Conflicts step</button>.
                </p>
              )}
            </div>

            {/* Complexity estimate */}
            <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Estimated complexity</p>
                <p className={cn('text-sm font-semibold mt-0.5', complexityColor)}>{complexityLabel}</p>
              </div>
              <p className="text-xs text-muted-foreground text-right max-w-[140px]">{complexityDesc}</p>
            </div>

            {/* Generate button */}
            <div className="pt-1">
              {blockingReasons.length > 0 && !building ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="block w-full">
                      <Button className="w-full gap-2" disabled>
                        <Rocket className="h-4 w-4" />
                        Save &amp; Build Schedule
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <p className="text-xs font-medium mb-1">Fix these first:</p>
                    <ul className="text-xs list-disc pl-4 space-y-0.5">
                      {blockingReasons.map((m, i) => <li key={i}>{m}</li>)}
                    </ul>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Button onClick={handleBuild} className="w-full gap-2" disabled={building}>
                  {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  {building ? (genProgress || progressMsg) : 'Save & Build Schedule'}
                </Button>
              )}
            </div>
          </div>
        </SafeSection>

        {/* Navigation */}
        <div className="flex justify-between pt-1">
          <Button variant="outline" onClick={() => setStep(SETUP_STEPS.CONFLICTS)}>Back</Button>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default StepReview;
