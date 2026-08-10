import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSetup } from '@/contexts/SetupContext';
import DraftRestoreBanner from '@/components/setup/DraftRestoreBanner';
import { CheckCircle2, ChevronDown, Circle, Lock, PlusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SETUP_STEPS, REQUIRED_STEP_ORDER, EXTRA_STEP_ORDER } from './stepIndex';
import StepWelcome from './steps/StepWelcome';
import StepSchoolInfo from './steps/StepSchoolInfo';
import StepCalendarUpload from './steps/StepCalendarUpload';
import StepRecessLunch from './steps/StepRecessLunch';
import StepSpecialists from './steps/StepSpecialists';
import StepTeachers from './steps/StepTeachers';
import StepContractualMinutes from './steps/StepContractualMinutes';
import StepAdminRotation from './steps/StepAdminRotation';
import StepClubs from './steps/StepClubs';
import StepEvents from './steps/StepEvents';
import StepConflict from './steps/StepConflict';
import StepReview from './steps/StepReview';
import WizardStepShell from '@/components/setup/WizardStepShell';

interface StepDef {
  /** Optional steps can be skipped — badged in the rail so a coordinator knows
   *  requiredness up front instead of discovering it at Review. */
  optional?: boolean;
  label: string;
  blurb: string;
  Component: React.ComponentType;
  why?: string;
  bullets?: { label: string; detail?: string }[];
}

const STEPS: StepDef[] = [
  {
    label: 'Welcome', blurb: 'Quick intro and what you’ll set up.', Component: StepWelcome,
    why: 'A 5-minute tour — 7 required steps, plus optional extras you can add any time.',
  },
  {
    label: 'School Info', blurb: 'Bell times, grades, planning minutes.', Component: StepSchoolInfo,
    why: 'Everything downstream — bell schedule, recess, conflicts — pivots off these numbers.',
    bullets: [
      { label: 'Bell times', detail: 'Bound the daily scheduling window' },
      { label: 'Grades served', detail: 'Drive teacher & recess groupings' },
      { label: 'Planning minutes', detail: 'Used for teacher prep guarantees' },
    ],
  },
  {
    label: 'Calendar', optional: true, blurb: 'Upload or paste your school calendar.', Component: StepCalendarUpload,
    why: 'Holidays and early-release days are pulled out automatically so the engine can skip them.',
    bullets: [{ label: 'AI parsing', detail: 'Upload PDF/image — events extracted for you' }],
  },
  {
    label: 'Recess & Lunch', blurb: 'Protected windows for meals and recess.', Component: StepRecessLunch,
    why: 'The scheduler treats these windows as off-limits for specialist classes.',
    bullets: [
      { label: 'Whole school vs staggered', detail: 'Pick one model — switch any time' },
      { label: 'Grade bands', detail: 'Group grades that lunch together' },
    ],
  },
  {
    label: 'Specialists', blurb: 'Music, Art, PE, etc.', Component: StepSpecialists,
    why: 'Each specialist is a constraint: their availability, subject, and travel time all shape the plan.',
    bullets: [{ label: 'AI upload', detail: 'Drop a roster spreadsheet — AI fills the table' }],
  },
  {
    label: 'Teachers', blurb: 'Classroom rosters and combo pairs.', Component: StepTeachers,
    why: 'Defines the class roster the scheduler is assigning blocks to.',
    bullets: [
      { label: 'Combo classes', detail: 'Pair classrooms that meet together' },
      { label: 'AI upload', detail: 'Spreadsheet → rows in one click' },
    ],
  },
  {
    label: 'Contractual Minutes', optional: true, blurb: 'Upload contract — AI extracts required minutes.', Component: StepContractualMinutes,
    why: 'Union/district contracts dictate weekly minutes per subject. AI reads the PDF so you don’t have to.',
  },
  {
    label: 'Admin Rotation', optional: true, blurb: 'PLC, admin duties, and other rotations.', Component: StepAdminRotation,
    why: 'Seeds the scheduler with non-teaching blocks (PLC, meetings) so they aren’t double-booked.',
  },
  {
    label: 'Clubs', optional: true, blurb: 'Lunch clubs and recurring activities.', Component: StepClubs,
    why: 'Recurring lunch/enrichment blocks. Can double as a relief valve for tough conflicts.',
    bullets: [{ label: 'AI import', detail: 'Describe clubs in plain English' }],
  },
  {
    label: 'Events', optional: true, blurb: 'One-off events and assemblies.', Component: StepEvents,
    why: 'One-off blocks (assemblies, picture day) that override the normal schedule on a date.',
    bullets: [{ label: 'AI import', detail: 'Describe events in plain English' }],
  },
  {
    label: 'Conflicts', blurb: 'How to handle scheduling conflicts.', Component: StepConflict,
    why: 'Tell the engine what to try first when two classes both need the same slot.',
    bullets: [{ label: 'AI recommend', detail: 'Get a strategy ranked by feasibility' }],
  },
  {
    label: 'Review', blurb: 'Final check before generating.', Component: StepReview,
    why: 'Final readiness check — missing data is flagged before you generate.',
  },
];

const SetupWizardContent = () => {
  const { step, setStep, visitedSteps } = useSetup();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const stepParam = searchParams.get('step');
    const anchor = searchParams.get('anchor');
    if (stepParam !== null) {
      const n = Number(stepParam);
      if (Number.isInteger(n) && n >= 0 && n < STEPS.length) {
        setStep(n);
      }
      if (anchor) {
        try { sessionStorage.setItem('setup.anchor', anchor); } catch { /* ignore */ }
      }
      const next = new URLSearchParams(searchParams);
      next.delete('step');
      next.delete('anchor');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = STEPS[step] ?? STEPS[0];
  const StepComponent = current.Component;

  const isExtraStep = EXTRA_STEP_ORDER.includes(step);
  const requiredPos = isExtraStep
    ? REQUIRED_STEP_ORDER.indexOf(SETUP_STEPS.CONFLICTS) // extras sit between Teachers and Conflicts
    : Math.max(0, REQUIRED_STEP_ORDER.indexOf(step));
  // Progress reflects the REQUIRED journey only — skipping extras never stalls it.
  const progressPct = Math.round((requiredPos / (REQUIRED_STEP_ORDER.length - 1)) * 100);

  // Rail display order: the required path, with the Extras group between
  // Teachers and Conflicts. Step INDICES are untouched — this is presentation.
  const conflictsPos = REQUIRED_STEP_ORDER.indexOf(SETUP_STEPS.CONFLICTS);
  const displayOrder = [
    ...REQUIRED_STEP_ORDER.slice(0, conflictsPos),
    ...EXTRA_STEP_ORDER,
    ...REQUIRED_STEP_ORDER.slice(conflictsPos),
  ];
  const posOf = (i: number) => displayOrder.indexOf(i);
  const curPos = posOf(step);
  const extrasVisitedCount = EXTRA_STEP_ORDER.filter(i => visitedSteps.has(i)).length;
  const [extrasOpen, setExtrasOpen] = useState(false);
  useEffect(() => { if (isExtraStep) setExtrasOpen(true); }, [isExtraStep]);

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Setup Wizard</h1>
          <p className="text-sm text-muted-foreground">
            {isExtraStep
              ? <>Extras (optional) — {current.label}</>
              : <>Step {requiredPos + 1} of {REQUIRED_STEP_ORDER.length} — {current.label}</>}
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-3">
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{progressPct}%</span>
        </div>
      </div>

      <DraftRestoreBanner />

      {isMobile ? (
        <div className="space-y-4">
          <Select value={String(step)} onValueChange={(v) => setStep(Number(v))}>
            <SelectTrigger className="w-full">
              <SelectValue>
                {isExtraStep ? current.label : `${requiredPos + 1}. ${current.label}`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {REQUIRED_STEP_ORDER.map((i, n) => {
                  const isVisited = visitedSteps.has(i);
                  return (
                    <SelectItem key={i} value={String(i)}>
                      <span className="flex items-center gap-2">
                        {isVisited && i !== step && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                        <span>{n + 1}. {STEPS[i].label}</span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">Extras (optional)</SelectLabel>
                {EXTRA_STEP_ORDER.map((i) => {
                  const isVisited = visitedSteps.has(i);
                  return (
                    <SelectItem key={i} value={String(i)}>
                      <span className="flex items-center gap-2">
                        {isVisited && i !== step && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                        <span>{STEPS[i].label}</span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div className="animate-slide-up" key={step}>
            <WizardStepShell
              title={current.label}
              blurb={current.blurb}
              why={current.why}
              bullets={current.bullets}
            >
              <StepComponent />
            </WizardStepShell>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-6">
          {/* Vertical stepper rail */}
          <nav aria-label="Setup steps" className="sticky top-4 self-start">
            <ol className="space-y-0.5 rounded-xl border border-border bg-card p-2">
              {REQUIRED_STEP_ORDER.map((i) => {
                const s = STEPS[i];
                const isActive = i === step;
                const isVisited = visitedSteps.has(i);
                const isDone = isVisited && posOf(i) < curPos;
                const isLocked = !isVisited && posOf(i) > curPos;
                return (
                  <Fragment key={s.label}>
                    {/* The Extras group lives between Teachers and Conflicts. */}
                    {i === SETUP_STEPS.CONFLICTS && (
                      <li>
                        <button
                          type="button"
                          onClick={() => setExtrasOpen((o) => !o)}
                          aria-expanded={extrasOpen}
                          className="group flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                        >
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-background text-muted-foreground">
                            <PlusCircle className="h-3 w-3" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-sm font-medium leading-tight">
                              Extras
                              <span className="rounded bg-muted px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Optional</span>
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {extrasVisitedCount > 0
                                ? `${extrasVisitedCount} of ${EXTRA_STEP_ORDER.length} visited`
                                : 'Calendar, contracts, PLC, clubs, events.'}
                            </span>
                          </span>
                          <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 transition-transform', extrasOpen && 'rotate-180')} />
                        </button>
                        {extrasOpen && (
                          <ol className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2">
                            {EXTRA_STEP_ORDER.map((j) => {
                              const e = STEPS[j];
                              const eActive = j === step;
                              const eDone = visitedSteps.has(j) && !eActive;
                              return (
                                <li key={e.label}>
                                  <button
                                    type="button"
                                    onClick={() => setStep(j)}
                                    className={cn(
                                      'group flex w-full items-start gap-3 rounded-lg px-3 py-1.5 text-left transition-colors',
                                      eActive
                                        ? 'bg-primary/10 text-foreground'
                                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                                        eActive
                                          ? 'border-primary bg-primary text-primary-foreground'
                                          : eDone
                                          ? 'border-primary/60 bg-primary/15 text-primary'
                                          : 'border-border bg-background text-muted-foreground',
                                      )}
                                    >
                                      {eDone ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Circle className="h-2.5 w-2.5" />}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className={cn('block text-[13px] font-medium leading-tight', eActive && 'text-foreground')}>{e.label}</span>
                                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{e.blurb}</span>
                                    </span>
                                  </button>
                                </li>
                              );
                            })}
                          </ol>
                        )}
                      </li>
                    )}
                    <li>
                      <button
                        type="button"
                        onClick={() => setStep(i)}
                        className={cn(
                          'group flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                          isActive
                            ? 'bg-primary/10 text-foreground'
                            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
                            isActive
                              ? 'border-primary bg-primary text-primary-foreground'
                              : isDone
                              ? 'border-primary/60 bg-primary/15 text-primary'
                              : 'border-border bg-background text-muted-foreground',
                          )}
                        >
                          {isDone ? <CheckCircle2 className="h-3 w-3" /> : isLocked ? <Lock className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn('flex items-center gap-1.5 text-sm font-medium leading-tight', isActive && 'text-foreground')}>
                            {s.label}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{s.blurb}</span>
                        </span>
                      </button>
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          </nav>

          {/* Step content */}
          <div className="min-w-0">
            <div className="mb-4 hidden sm:block">
              <h2 className="text-xl font-semibold text-foreground">{current.label}</h2>
              <p className="text-sm text-muted-foreground">{current.blurb}</p>
            </div>
            <div className="animate-slide-up" key={step}>
              <WizardStepShell
                title={current.label}
                blurb={current.blurb}
                why={current.why}
                bullets={current.bullets}
              >
                <StepComponent />
              </WizardStepShell>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SetupWizardContent;
