import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSetup } from '@/contexts/SetupContext';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import StepWelcome from './steps/StepWelcome';
import StepSchoolInfo from './steps/StepSchoolInfo';
import StepCalendarUpload from './steps/StepCalendarUpload';
import StepRecessLunch from './steps/StepRecessLunch';
import StepSpecialists from './steps/StepSpecialists';
import StepTeachers from './steps/StepTeachers';
import StepAdminRotation from './steps/StepAdminRotation';
import StepClubs from './steps/StepClubs';
import StepEvents from './steps/StepEvents';
import StepConflict from './steps/StepConflict';
import StepReview from './steps/StepReview';

const stepLabels = [
  'Welcome', 'School Info', 'Calendar', 'Recess & Lunch',
  'Specialists', 'Teachers', 'Admin Rotation', 'Clubs', 'Events', 'Conflicts', 'Review'
];

const stepComponents = [
  StepWelcome, StepSchoolInfo, StepCalendarUpload, StepRecessLunch,
  StepSpecialists, StepTeachers, StepAdminRotation, StepClubs, StepEvents, StepConflict, StepReview
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
      if (Number.isInteger(n) && n >= 0 && n < stepComponents.length) {
        setStep(n);
      }
      if (anchor) {
        try { sessionStorage.setItem('setup.anchor', anchor); } catch {}
      }
      // Clear the query params so toggling tabs later doesn't re-trigger.
      const next = new URLSearchParams(searchParams);
      next.delete('step');
      next.delete('anchor');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const StepComponent = stepComponents[step];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Setup Wizard</h1>
        <p className="text-sm text-muted-foreground">Configure your school step by step.</p>
      </div>

      {/* Step navigation */}
      {isMobile ? (
        /* Mobile: compact dropdown */
        <Select value={String(step)} onValueChange={(v) => setStep(Number(v))}>
          <SelectTrigger className="w-full">
            <SelectValue>
              {step + 1}. {stepLabels[step]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {stepLabels.map((label, i) => {
              const isVisited = visitedSteps.has(i);
              return (
                <SelectItem key={i} value={String(i)}>
                  <span className="flex items-center gap-2">
                    {isVisited && i !== step && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                    <span>{i + 1}. {label}</span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      ) : (
        /* Desktop: binder-style tabs */
        <div className="relative">
          <div className="flex overflow-x-auto gap-0 rounded-t-lg bg-primary px-1 pt-1">
            {stepLabels.map((label, i) => {
              const isActive = i === step;
              const isVisited = visitedSteps.has(i);
              return (
                <button
                  key={i}
                  onClick={() => setStep(i)}
                  className={cn(
                    'relative shrink-0 px-3 py-2 text-[11px] font-medium transition-all rounded-t-lg border-t border-x cursor-pointer',
                    isActive
                      ? 'bg-accent text-accent-foreground border-accent z-10 -mb-px'
                      : isVisited
                      ? 'bg-primary/80 text-primary-foreground/90 border-primary/60 hover:bg-primary/70'
                      : 'bg-primary/50 text-primary-foreground/70 border-primary/40 hover:bg-primary/60'
                  )}
                >
                  <span className="flex items-center gap-1">
                    {isVisited && !isActive && <CheckCircle2 className="h-3 w-3" />}
                    <span>{i + 1}. {label}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="h-1 bg-primary rounded-b-sm" />
        </div>
      )}

      {/* Step content */}
      <div className="animate-slide-up" key={step}>
        <StepComponent />
      </div>
    </div>
  );
};

export default SetupWizardContent;
