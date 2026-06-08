import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Loader2, Sparkles } from 'lucide-react';
import { DEMO_CONFLICT_LABELS, type DemoConflictKind, type SeedDemoOptions } from '@/lib/seedDemoSchool';

const ALL_GRADES = ['K','1','2','3','4','5'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (options: SeedDemoOptions) => Promise<void> | void;
  submitting?: boolean;
}

export default function SeedDemoDialog({ open, onOpenChange, onSubmit, submitting }: Props) {
  const [teachersPerGrade, setTeachersPerGrade] = useState(2);
  const [specialistCount, setSpecialistCount] = useState(6);
  const [grades, setGrades] = useState<string[]>(ALL_GRADES);
  const [conflicts, setConflicts] = useState<DemoConflictKind[]>(['lunch_clubs','admin_rotation']);

  const toggleGrade = (g: string) =>
    setGrades(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g].sort((a,b) => ALL_GRADES.indexOf(a) - ALL_GRADES.indexOf(b)));

  const toggleConflict = (c: DemoConflictKind) =>
    setConflicts(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  const totalTeachers = teachersPerGrade * grades.length;

  const handleSubmit = async () => {
    await onSubmit({ teachersPerGrade, specialistCount, gradesServed: grades, conflicts });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Customize demo school</DialogTitle>
          <DialogDescription>
            Pick the size of the mock school and which conflicts you want to stress-test.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <div className="space-y-2">
            <Label>Teachers per grade: <span className="font-semibold">{teachersPerGrade}</span></Label>
            <Slider min={1} max={6} step={1} value={[teachersPerGrade]} onValueChange={v => setTeachersPerGrade(v[0])} />
          </div>

          <div className="space-y-2">
            <Label>Specialists: <span className="font-semibold">{specialistCount}</span></Label>
            <Slider min={3} max={10} step={1} value={[specialistCount]} onValueChange={v => setSpecialistCount(v[0])} />
          </div>

          <div className="space-y-2">
            <Label>Grades served</Label>
            <div className="flex flex-wrap gap-3">
              {ALL_GRADES.map(g => (
                <label key={g} className="flex items-center gap-2 rounded-md border px-3 py-1.5 cursor-pointer">
                  <Checkbox checked={grades.includes(g)} onCheckedChange={() => toggleGrade(g)} />
                  <span className="text-sm">Grade {g}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Conflicts to test</Label>
            <div className="grid sm:grid-cols-2 gap-2">
              {(Object.keys(DEMO_CONFLICT_LABELS) as DemoConflictKind[]).map(c => (
                <label key={c} className="flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/50">
                  <Checkbox checked={conflicts.includes(c)} onCheckedChange={() => toggleConflict(c)} className="mt-0.5" />
                  <span className="text-sm leading-snug">{DEMO_CONFLICT_LABELS[c]}</span>
                </label>
              ))}
            </div>
          </div>

          <p className="text-sm text-muted-foreground border-t pt-3">
            Will create <span className="font-semibold text-foreground">{totalTeachers}</span> teachers across{' '}
            <span className="font-semibold text-foreground">{grades.length}</span> grade{grades.length === 1 ? '' : 's'} with{' '}
            <span className="font-semibold text-foreground">{specialistCount}</span> specialist{specialistCount === 1 ? '' : 's'}.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || grades.length === 0}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {submitting ? 'Seeding…' : 'Generate demo school'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
