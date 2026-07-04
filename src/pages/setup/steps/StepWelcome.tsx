import { useState } from 'react';
import { SETUP_STEPS } from '../stepIndex';
import { useSetup } from '@/contexts/SetupContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field-label';
import { Wand2, ClipboardList, Sparkles, ListChecks, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import QuickSetup from './QuickSetup';

const StepWelcome = () => {
  const { data, updateData, setStep } = useSetup();
  const [mode, setMode] = useState<'choose' | 'ai'>('choose');

  return (
    <div className="rounded-xl border border-border bg-card p-8">
      <div className="mx-auto max-w-lg space-y-6">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Wand2 className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-card-foreground">Welcome to the Setup Wizard</h2>
          <p className="text-sm text-muted-foreground">
            Let's configure your school's scheduling data — the fast way with AI, or step by step.
          </p>
        </div>

        <div className="space-y-2 text-left">
          <FieldLabel htmlFor="schoolName" tooltip="Enter your school name to get started — this will appear on all exports.">School Name</FieldLabel>
          <Input
            id="schoolName"
            value={data.schoolName}
            onChange={(e) => updateData({ schoolName: e.target.value })}
            placeholder="e.g. Lincoln Elementary"
            className="text-center"
          />
        </div>

        {mode === 'ai' ? (
          <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
            <QuickSetup onCancel={() => setMode('choose')} />
          </div>
        ) : (
          <div className="grid gap-3">
            {/* AI-first (recommended) */}
            <button
              type="button"
              onClick={() => setMode('ai')}
              className={cn(
                'flex items-start gap-3 rounded-xl border-2 border-primary/40 bg-primary/5 p-4 text-left transition-colors hover:border-primary',
              )}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary"><Sparkles className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  Set up with AI <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">Recommended</span>
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">Drop your specialist & teacher rosters — we prefill the wizard for you.</span>
              </span>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            </button>

            {/* Classic step-by-step */}
            <button
              type="button"
              onClick={() => setStep(SETUP_STEPS.SCHOOL_INFO)}
              disabled={!data.schoolName.trim()}
              className="flex items-start gap-3 rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-primary/40 disabled:opacity-50"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><ListChecks className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">Set up step by step</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">Fill each section yourself — full control, in any order.</span>
              </span>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </div>
        )}

        {/* Take-in template shortcut */}
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-left">
          <div className="flex items-start gap-3">
            <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Have a filled-in take-in template?</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Upload the coordinator prep sheet and AI will pre-fill the wizard for you.
              </p>
              <Button asChild variant="link" size="sm" className="mt-1 h-auto p-0 text-xs">
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
