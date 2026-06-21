import { SETUP_STEPS } from '../stepIndex';
import { useSetup } from '@/contexts/SetupContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field-label';
import { Wand2, ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';

const StepWelcome = () => {
  const { data, updateData, setStep } = useSetup();

  return (
    <div className="rounded-xl border border-border bg-card p-8">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Wand2 className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-card-foreground">Welcome to the Setup Wizard</h2>
          <p className="text-sm text-muted-foreground">
            Let's configure your school's scheduling data. You can complete the tabs in any order — click any tab above to jump to a section.
          </p>
        </div>

        <div className="text-left space-y-2">
          <FieldLabel htmlFor="schoolName" tooltip="Enter your school name to get started — this will appear on all exports.">School Name</FieldLabel>
          <Input
            id="schoolName"
            value={data.schoolName}
            onChange={(e) => updateData({ schoolName: e.target.value })}
            placeholder="e.g. Lincoln Elementary"
            className="text-center"
          />
        </div>
        <Button onClick={() => setStep(SETUP_STEPS.SCHOOL_INFO)} disabled={!data.schoolName.trim()} className="w-full">
          Get Started
        </Button>

        {/* Single home for the AI take-in template — used to be its own sidebar
         *  page that duplicated the wizard. Linking from here keeps the
         *  wizard as the one canonical setup path. */}
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-left">
          <div className="flex items-start gap-3">
            <ClipboardList className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Have a filled-in take-in template?</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Upload the coordinator prep sheet and AI will pre-fill the wizard for you.
              </p>
              <Button asChild variant="link" size="sm" className="h-auto p-0 mt-1 text-xs">
                <Link to="/app/coordinator-prep">Upload take-in template →</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StepWelcome;
