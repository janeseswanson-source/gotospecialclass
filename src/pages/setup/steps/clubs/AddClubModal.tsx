import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field-label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, X, AlertCircle } from 'lucide-react';

export type DayKey = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
export interface ClubSession { day: DayKey | ''; time: string }

export interface ClubDraft {
  id: string;
  name: string;
  grades: string[];
  leadSpecialistId: string | null;
  sessions: ClubSession[];
}

interface SpecialistOption { id: string; name: string; subject?: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ClubDraft;
  availableGrades: string[];
  specialists: SpecialistOption[];
  defaultTimeForGrades: (grades: string[]) => string;
  onSave: (draft: ClubDraft) => Promise<void>;
}

const DAYS: DayKey[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const MAX_SESSIONS = 5;

const dayLabel: Record<DayKey, string> = {
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday',
};

export const AddClubModal = ({
  open, onOpenChange, initial, availableGrades, specialists, defaultTimeForGrades, onSave,
}: Props) => {
  const [draft, setDraft] = useState<ClubDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(initial.sessions.length === 0 ? { ...initial, sessions: [{ day: '', time: '' }] } : initial);
      setError(null);
    }
  }, [open, initial]);

  const duplicateIdx = useMemo(() => {
    const seen = new Map<string, number>();
    const dupes = new Set<number>();
    draft.sessions.forEach((s, i) => {
      if (!s.day) return;
      if (seen.has(s.day)) dupes.add(i);
      else seen.set(s.day, i);
    });
    return dupes;
  }, [draft.sessions]);

  const isValid =
    draft.name.trim().length > 0 &&
    !!draft.leadSpecialistId &&
    draft.grades.length > 0 &&
    draft.sessions.length > 0 &&
    draft.sessions.every(s => !!s.day) &&
    duplicateIdx.size === 0;

  const toggleGrade = (g: string) => {
    setDraft(d => {
      const grades = d.grades.includes(g) ? d.grades.filter(x => x !== g) : [...d.grades, g];
      // Auto-fill empty session times based on grades
      const auto = defaultTimeForGrades(grades);
      const sessions = d.sessions.map(s => (!s.time && auto ? { ...s, time: auto } : s));
      return { ...d, grades, sessions };
    });
  };

  const updateSession = (i: number, patch: Partial<ClubSession>) =>
    setDraft(d => ({ ...d, sessions: d.sessions.map((s, idx) => idx === i ? { ...s, ...patch } : s) }));

  const addSession = () => {
    if (draft.sessions.length >= MAX_SESSIONS) return;
    const auto = defaultTimeForGrades(draft.grades);
    setDraft(d => ({ ...d, sessions: [...d.sessions, { day: '', time: auto }] }));
  };

  const removeSession = (i: number) => {
    if (draft.sessions.length <= 1) return;
    setDraft(d => ({ ...d, sessions: d.sessions.filter((_, idx) => idx !== i) }));
  };

  const handleSave = async () => {
    if (!isValid) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message || 'Could not save the club. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a New Lunch Club</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <FieldLabel tooltip="Name of the lunch club or enrichment block">Club Name</FieldLabel>
            <Input value={draft.name} onChange={(e) => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Doodle Lunch Club" />
          </div>

          <div className="space-y-1.5">
            <FieldLabel tooltip="Who leads this club">Lead Specialist</FieldLabel>
            <Select value={draft.leadSpecialistId ?? ''} onValueChange={(v) => setDraft(d => ({ ...d, leadSpecialistId: v || null }))}>
              <SelectTrigger><SelectValue placeholder="Select specialist..." /></SelectTrigger>
              <SelectContent>
                {specialists.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No specialists yet — add them in the Specialists step.</div>}
                {specialists.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}{s.subject ? ` — ${s.subject}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <FieldLabel tooltip="Which grade levels can attend this club">Grades</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {availableGrades.map(g => (
                <button
                  key={g}
                  type="button"
                  onClick={() => toggleGrade(g)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium border transition-colors ${
                    draft.grades.includes(g)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-secondary/50 text-muted-foreground border-border hover:bg-primary/10'
                  }`}
                >{g}</button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <FieldLabel tooltip="Days and times this club meets. Add more days if it runs more than once a week.">Days & Times</FieldLabel>
            {draft.sessions.map((s, i) => {
              const isDup = duplicateIdx.has(i);
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] text-muted-foreground">What day?</label>
                      <Select value={s.day} onValueChange={(v) => updateSession(i, { day: v as DayKey })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick a day..." /></SelectTrigger>
                        <SelectContent>
                          {DAYS.map(d => <SelectItem key={d} value={d}>{dayLabel[d]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] text-muted-foreground">What time? (Optional)</label>
                      <Input className="h-8 text-xs" type="time" value={s.time} onChange={(e) => updateSession(i, { time: e.target.value })} />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => removeSession(i)}
                      disabled={draft.sessions.length <= 1}
                      aria-label="Remove day"
                    >
                      <X className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  {isDup && s.day && (
                    <p className="text-[11px] text-destructive pl-1">This club is already on {dayLabel[s.day as DayKey]}.</p>
                  )}
                </div>
              );
            })}
            {draft.sessions.length < MAX_SESSIONS && (
              <Button type="button" size="sm" variant="outline" onClick={addSession}>
                <Plus className="h-3 w-3 mr-1" /> Add another day
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={!isValid || saving}>
            {saving ? 'Saving…' : 'Got it!'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddClubModal;
