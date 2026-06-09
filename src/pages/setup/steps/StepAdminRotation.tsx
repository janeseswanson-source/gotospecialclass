import { useEffect, useRef, useCallback, useState } from 'react';
import { useFlushOnUnmount } from '@/hooks/useFlushOnUnmount';
import { useSetup } from '@/contexts/SetupContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field-label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, CalendarClock, AlertTriangle, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { SETUP_STEPS } from '../stepIndex';
import { SaveStatusIndicator, type SaveStatus } from '@/components/setup/SaveStatusIndicator';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const StepAdminRotation = () => {
  const { data, updateData, schoolId, markStepVisited, setStep } = useSetup();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const loadedRef = useRef(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  useEffect(() => {
    if (!schoolId || loadedRef.current) return;
    (async () => {
      const { data: school } = await supabase
        .from('schools')
        .select('admin_rotation')
        .eq('id', schoolId)
        .single() as any;
      if (school?.admin_rotation) {
        updateData({ adminRotation: school.admin_rotation as any });
      }
      loadedRef.current = true;
    })();
  }, [schoolId, updateData]);

  const persist = useCallback(async (rotation: typeof data.adminRotation) => {
    if (!schoolId || !loadedRef.current) return;
    setSaveStatus('saving');
    const { error } = await supabase
      .from('schools')
      .update({ admin_rotation: rotation as any } as any)
      .eq('id', schoolId);
    if (error) {
      toast.error('Failed to save admin rotation');
      setSaveStatus('idle');
    } else {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  }, [schoolId]);

  const save = useCallback((rotation: typeof data.adminRotation) => {
    if (!schoolId || !loadedRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveStatus('saving');
    debounceRef.current = setTimeout(() => persist(rotation), 1000);
  }, [schoolId, persist]);

  const latestRef = useRef(data.adminRotation);
  latestRef.current = data.adminRotation;
  useFlushOnUnmount(debounceRef, () => { if (loadedRef.current) persist(latestRef.current); });

  useEffect(() => { markStepVisited(SETUP_STEPS.ADMIN_ROTATION); }, [markStepVisited]);

  const entries = Array.isArray(data.adminRotation) ? data.adminRotation : [];

  const update = (idx: number, patch: Partial<typeof entries[0]>) => {
    const next = entries.map((e, i) => i === idx ? { ...e, ...patch } : e);
    updateData({ adminRotation: next });
    save(next);
  };

  const addEntry = () => {
    const next = [...entries, { day: 'Tuesday', startTime: '08:00', endTime: '08:45', grades: [], autoSchedule: true, durationMinutes: 45 }];
    updateData({ adminRotation: next });
    save(next);
  };

  const removeEntry = (idx: number) => {
    const next = entries.filter((_, i) => i !== idx);
    updateData({ adminRotation: next });
    save(next);
  };

  const toggleGrade = (idx: number, grade: string) => {
    const current = entries[idx].grades;
    const next = current.includes(grade) ? current.filter(g => g !== grade) : [...current, grade];
    update(idx, { grades: next });
  };

  const grades = data.gradesServed || [];

  return (
    <Card>
      <CardContent className="pt-6 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" />
              Additional Admin Rotation
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Request a special weekly time block for an extra class — e.g. for PLC meetings.
              This will be flagged separately in the generated schedule.
            </p>
          </div>
          <SaveStatusIndicator status={saveStatus} className="mt-1" />
        </div>

        {!schoolId && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 flex items-start gap-2 text-xs text-warning-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              School not initialized yet. Visit <button onClick={() => setStep(SETUP_STEPS.SCHOOL_INFO)} className="underline">School Info</button> first
              so changes here can be saved.
            </span>
          </div>
        )}

        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 flex items-start gap-2 text-xs text-foreground">
          <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
          <span>Tip: Let us pick the time slot when you don't have a specific time in mind. We'll find an open block that fits.</span>
        </div>

        {entries.length === 0 && (
          <div className="text-center py-8 border-2 border-dashed border-muted rounded-lg">
            <CalendarClock className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground mb-3">No admin rotation blocks configured yet.</p>
            <Button variant="outline" size="sm" onClick={addEntry}>
              <Plus className="h-4 w-4 mr-1" /> Add Rotation Block
            </Button>
          </div>
        )}

        {entries.map((entry, idx) => {
          const invalidRange = entry.startTime && entry.endTime && entry.startTime >= entry.endTime;
          return (
          <Card key={idx} className="border-l-4 border-l-primary bg-muted/30">
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Block {idx + 1}</span>
                <Button variant="ghost" size="icon" onClick={() => removeEntry(idx)} className="h-8 w-8 text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center justify-between rounded-md border border-border bg-background/50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Let the scheduler pick the time</span>
                </div>
                <Switch
                  checked={entry.autoSchedule === true}
                  onCheckedChange={(checked) =>
                    update(idx, checked
                      ? { autoSchedule: true, durationMinutes: entry.durationMinutes ?? 45 }
                      : { autoSchedule: false })
                  }
                />
              </div>

              {entry.autoSchedule ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel className="text-xs" tooltip="Which day this admin rotation block occurs">Day of Week</FieldLabel>
                    <Select value={entry.day} onValueChange={(v) => update(idx, { day: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {WEEKDAYS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel className="text-xs" tooltip="How long the block should be — the scheduler will find an open slot of this length">Block duration (minutes)</FieldLabel>
                    <Input
                      type="number"
                      min={5}
                      max={240}
                      value={entry.durationMinutes ?? 45}
                      onChange={(e) => update(idx, { durationMinutes: Math.min(240, Math.max(5, parseInt(e.target.value, 10) || 45)) })}
                    />
                  </div>
                  <p className="sm:col-span-2 text-xs text-muted-foreground italic">
                    Will be scheduled within {entry.day}'s available time slots.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <FieldLabel className="text-xs" tooltip="Which day this admin rotation block occurs">Day of Week</FieldLabel>
                      <Select value={entry.day} onValueChange={(v) => update(idx, { day: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {WEEKDAYS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <FieldLabel className="text-xs" tooltip="Time window for the admin rotation block">Start Time</FieldLabel>
                      <Input
                        type="time"
                        value={entry.startTime}
                        onChange={(e) => update(idx, { startTime: e.target.value })}
                        className={invalidRange ? 'border-destructive' : ''}
                      />
                    </div>
                    <div>
                      <FieldLabel className="text-xs" tooltip="End of the admin rotation block">End Time</FieldLabel>
                      <Input
                        type="time"
                        value={entry.endTime}
                        onChange={(e) => update(idx, { endTime: e.target.value })}
                        className={invalidRange ? 'border-destructive' : ''}
                      />
                    </div>
                  </div>

                  {invalidRange && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> End time must be after start time.
                    </p>
                  )}
                </>
              )}

              <div>
                <FieldLabel className="text-xs mb-2 block" tooltip="Which grades are included in this rotation">Grade Levels for this block</FieldLabel>
                {grades.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {grades.map(g => (
                      <button
                        key={g}
                        onClick={() => toggleGrade(idx, g)}
                        className={cn(
                          'px-3 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer',
                          entry.grades.includes(g)
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                        )}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Set grades served in School Info first.</p>
                )}
              </div>
            </CardContent>
          </Card>
        );})}

        {entries.length > 0 && (
          <Button variant="outline" size="sm" onClick={addEntry}>
            <Plus className="h-4 w-4 mr-1" /> Add Another Block
          </Button>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={() => setStep(SETUP_STEPS.CONTRACTUAL_MINUTES)}>Back</Button>
          <Button onClick={() => setStep(SETUP_STEPS.CLUBS)}>Continue</Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default StepAdminRotation;
