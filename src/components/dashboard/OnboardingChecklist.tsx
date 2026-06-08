import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useSchool } from '@/contexts/SchoolContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, Circle, ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface StepItem {
  label: string;
  done: boolean;
  path: string;
}

export default function OnboardingChecklist() {
  const { selectedSchoolId } = useSchool();
  const navigate = useNavigate();
  const [steps, setSteps] = useState<StepItem[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedSchoolId) {
      setSteps([
        { label: 'Create your school', done: false, path: '/app/setup' },
        { label: 'Add specialists', done: false, path: '/app/setup' },
        { label: 'Add teachers', done: false, path: '/app/setup' },
        { label: 'Configure schedule', done: false, path: '/app/setup' },
        { label: 'Generate schedule', done: false, path: '/app/prep' },
        { label: 'Export schedule', done: false, path: '/app/exports' },
      ]);
      setLoading(false);
      return;
    }
    loadProgress();
  }, [selectedSchoolId]);

  async function loadProgress() {
    const [schoolRes, specRes, teachRes, genRes, exportRes] = await Promise.all([
      supabase.from('schools').select('name, setup_complete, setup_step, grades_served').eq('id', selectedSchoolId!).single(),
      supabase.from('specialists').select('id').eq('school_id', selectedSchoolId!).limit(1),
      supabase.from('classroom_teachers').select('id').eq('school_id', selectedSchoolId!).limit(1),
      supabase.from('schedule_generations').select('id').eq('school_id', selectedSchoolId!).limit(1),
      supabase.from('export_records').select('id').eq('school_id', selectedSchoolId!).limit(1),
    ]);

    const school = schoolRes.data;
    const hasSchool = !!school?.name && (school.grades_served?.length ?? 0) > 0;
    const hasSpecs = (specRes.data?.length ?? 0) > 0;
    const hasTeachers = (teachRes.data?.length ?? 0) > 0;
    const hasConfig = (school?.setup_step ?? 0) >= 9;
    const hasGen = (genRes.data?.length ?? 0) > 0;
    const hasExport = (exportRes.data?.length ?? 0) > 0;

    setSteps([
      { label: 'Add school info & grades', done: hasSchool, path: '/app/setup' },
      { label: 'Add specialists', done: hasSpecs, path: '/app/setup' },
      { label: 'Add teachers', done: hasTeachers, path: '/app/setup' },
      { label: 'Configure schedule settings', done: hasConfig, path: '/app/setup' },
      { label: 'Generate schedule', done: hasGen, path: '/app/prep' },
      { label: 'Export schedule', done: hasExport, path: '/app/exports' },
    ]);
    setLoading(false);
  }

  if (loading || dismissed) return null;

  const completedCount = steps.filter(s => s.done).length;
  const allDone = completedCount === steps.length;
  if (allDone) return null;

  const progress = Math.round((completedCount / steps.length) * 100);
  const nextStep = steps.find(s => !s.done);

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Getting Started</CardTitle>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDismissed(true)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="space-y-1">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-muted-foreground">{completedCount} of {steps.length} completed</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {steps.map((step, i) => (
          <button
            key={i}
            onClick={() => !step.done && navigate(step.path)}
            className={`flex items-center gap-3 w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
              step.done ? 'text-muted-foreground' : 'hover:bg-primary/10 cursor-pointer'
            }`}
          >
            {step.done ? (
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span className={step.done ? 'line-through' : ''}>{step.label}</span>
            {!step.done && step === nextStep && <ArrowRight className="h-3.5 w-3.5 ml-auto text-primary" />}
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
