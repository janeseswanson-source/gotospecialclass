import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSetup } from '@/contexts/SetupContext';
import { CheckCircle2, Circle, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

interface StepDef {
  label: string;
  blurb: string;
  Component: React.ComponentType;
}

const STEPS: StepDef[] = [
  { label: 'Welcome', blurb: 'Quick intro and what you’ll set up.', Component: StepWelcome },
  { label: 'School Info', blurb: 'Bell times, grades, planning minutes.', Component: StepSchoolInfo },
  { label: 'Calendar', blurb: 'Upload or paste your school calendar.', Component: StepCalendarUpload },
  { label: 'Recess & Lunch', blurb: 'Protected windows for meals and recess.', Component: StepRecessLunch },
  { label: 'Specialists', blurb: 'Music, Art, PE, etc.', Component: StepSpecialists },
  { label: 'Teachers', blurb: 'Classroom rosters and combo pairs.', Component: StepTeachers },
  { label: 'Contractual Minutes', blurb: 'Upload contract — AI extracts required minutes.', Component: StepContractualMinutes },
  { label: 'Admin Rotation', blurb: 'PLC, admin duties, and other rotations.', Component: StepAdminRotation },
  { label: 'Clubs', blurb: 'Lunch clubs and recurring activities.', Component: StepClubs },
  { label: 'Events', blurb: 'One-off events and assemblies.', Component: StepEvents },
  { label: 'Conflicts', blurb: 'How to handle scheduling conflicts.', Component: StepConflict },
  { label: 'Review', blurb: 'Final check before generating.', Component: StepReview },
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
  const completedCount = Array.from(visitedSteps).filter(i => i < step).length;
  const progressPct = Math.round(((step) / (STEPS.length - 1)) * 100);

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Setup Wizard</h1>
          <p className="text-sm text-muted-foreground">
            Step {step + 1} of {STEPS.length} — {current.label}
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

      {isMobile ? (
        <div className="space-y-4">
          <Select value={String(step)} onValueChange={(v) => setStep(Number(v))}>
            <SelectTrigger className="w-full">
              <SelectValue>
                {step + 1}. {current.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STEPS.map((s, i) => {
                const isVisited = visitedSteps.has(i);
                return (
                  <SelectItem key={i} value={String(i)}>
                    <span className="flex items-center gap-2">
                      {isVisited && i !== step && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                      <span>{i + 1}. {s.label}</span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <div className="animate-slide-up" key={step}>
            <StepComponent />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-6">
          {/* Vertical stepper rail */}
          <nav aria-label="Setup steps" className="sticky top-4 self-start">
            <ol className="space-y-0.5 rounded-xl border border-border bg-card p-2">
              {STEPS.map((s, i) => {
                const isActive = i === step;
                const isVisited = visitedSteps.has(i);
                const isDone = isVisited && i < step;
                const isLocked = !isVisited && i > step;
                return (
                  <li key={s.label}>
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
                        <span className={cn('block text-sm font-medium leading-tight', isActive && 'text-foreground')}>
                          {s.label}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{s.blurb}</span>
                      </span>
                    </button>
                  </li>
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
              <StepComponent />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SetupWizardContent;
