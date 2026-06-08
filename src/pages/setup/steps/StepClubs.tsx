import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SaveStatusIndicator, type SaveStatus } from '@/components/setup/SaveStatusIndicator';
import { SETUP_STEPS } from '../stepIndex';
import { useSetup } from '@/contexts/SetupContext';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Loader2, Check, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatTime } from '@/lib/utils';
import { AddClubModal, ClubDraft, ClubSession, DayKey } from './clubs/AddClubModal';

interface Club {
  id: string;
  name: string;
  grades: string[];
  leadSpecialistId: string | null;
  sessions: ClubSession[];
}

interface SpecialistOpt { id: string; name: string; subject?: string }

const suggestedClubs = [
  { name: 'Doodle Lunch Club', grades: ['K', '1', '2', '3'], label: 'Doodle Lunch Club (Gr K–3)' },
  { name: 'Art Apprentice Lunch Club', grades: ['4', '5', '6'], label: 'Art Apprentice Lunch Club (Gr 4–6)' },
  { name: 'Robotics Lunch Club', grades: ['3', '4', '5'], label: 'Robotics Lunch Club (Gr 3–5)' },
  { name: 'Yearbook Lunch Club', grades: ['4', '5', '6'], label: 'Yearbook Lunch Club (Gr 4–6)' },
  { name: 'Enrichment Block', grades: ['K', '1', '2'], label: 'Enrichment Block (Gr K–2)' },
  { name: 'Music Makers Lunch Club', grades: ['1', '2', '3'], label: 'Music Makers Lunch Club (Gr 1–3)' },
];

const gradeOrder = ['Pre-K', 'K', '1', '2', '3', '4', '5', '6', '7', '8'];
const DAY_ORDER: DayKey[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const parseGradesStr = (g: string | null | undefined): string[] => {
  if (!g) return [];
  if (g.includes(',')) return g.split(',').map(s => s.trim()).filter(Boolean);
  const m = g.match(/^(\S+)[–-](\S+)$/);
  if (m) {
    const s = gradeOrder.indexOf(m[1]);
    const e = gradeOrder.indexOf(m[2]);
    if (s >= 0 && e >= 0) return gradeOrder.slice(Math.min(s, e), Math.max(s, e) + 1);
  }
  return [g];
};

const StepClubs = () => {
  const { setStep, schoolId, data } = useSetup();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [specialists, setSpecialists] = useState<SpecialistOpt[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [initialDraft, setInitialDraft] = useState<ClubDraft | null>(null);
  const isLoaded = useRef(false);

  const availableGrades = useMemo(() => (
    data.gradesServed.length > 0
      ? [...data.gradesServed].sort((a, b) => gradeOrder.indexOf(a) - gradeOrder.indexOf(b))
      : gradeOrder.slice(0, 7)
  ), [data.gradesServed]);

  const defaultTimeForGrades = useCallback((grades: string[]): string => {
    if (!grades.length) return '';
    const cfg = data.recessConfig;
    const testGrade = grades[0];
    for (const [band, times] of Object.entries(cfg)) {
      if (band === 'all') return times.lunchStart || '';
      const m = band.match(/^(\S+)[–-](\S+)$/);
      if (m) {
        const s = gradeOrder.indexOf(m[1]);
        const e = gradeOrder.indexOf(m[2]);
        const g = gradeOrder.indexOf(testGrade);
        if (s >= 0 && e >= 0 && g >= s && g <= e) return times.lunchStart || '';
      }
    }
    const first = Object.keys(cfg)[0];
    return first ? cfg[first].lunchStart || '' : '';
  }, [data.recessConfig]);

  useEffect(() => {
    if (!schoolId) return;
    const load = async () => {
      const [{ data: rows }, { data: specRows }] = await Promise.all([
        supabase.from('clubs').select('*').eq('school_id', schoolId),
        supabase.from('specialists').select('id, name, subject').eq('school_id', schoolId),
      ]);
      if (rows) {
        setClubs(rows.map((c: any) => {
          let sessions: ClubSession[] = Array.isArray(c.sessions) ? c.sessions : [];
          if (sessions.length === 0 && c.day_of_week) {
            sessions = [{ day: c.day_of_week as DayKey, time: c.start_time || '' }];
          }
          return {
            id: c.id,
            name: c.name || '',
            grades: parseGradesStr(c.grades),
            leadSpecialistId: c.lead_specialist_id ?? null,
            sessions,
          };
        }));
      }
      if (specRows) setSpecialists(specRows as SpecialistOpt[]);
      isLoaded.current = true;
    };
    load();
  }, [schoolId]);

  const persistClub = useCallback(async (draft: ClubDraft) => {
    if (!schoolId) throw new Error('Missing school');
    // Sort sessions by day for consistent display
    const sortedSessions = [...draft.sessions]
      .filter(s => s.day)
      .sort((a, b) => DAY_ORDER.indexOf(a.day as DayKey) - DAY_ORDER.indexOf(b.day as DayKey));
    const firstSession = sortedSessions[0];
    const row = {
      id: draft.id,
      school_id: schoolId,
      name: draft.name.trim(),
      grades: draft.grades.join(','),
      lead_specialist_id: draft.leadSpecialistId,
      sessions: sortedSessions as any,
      // Keep legacy columns in sync with first session for back-compat
      day_of_week: firstSession?.day || null,
      start_time: firstSession?.time || null,
      end_time: null,
    };
    setSaveStatus('saving');
    const { error } = await supabase.from('clubs').upsert(row, { onConflict: 'id' });
    if (error) {
      setSaveStatus('idle');
      throw error;
    }
    setClubs(prev => {
      const exists = prev.some(c => c.id === draft.id);
      const next: Club = {
        id: draft.id,
        name: draft.name.trim(),
        grades: draft.grades,
        leadSpecialistId: draft.leadSpecialistId,
        sessions: sortedSessions,
      };
      return exists ? prev.map(c => c.id === draft.id ? next : c) : [...prev, next];
    });
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 1500);
  }, [schoolId]);

  const removeClub = async (id: string) => {
    if (!schoolId) return;
    setClubs(prev => prev.filter(c => c.id !== id));
    await supabase.from('clubs').delete().eq('id', id);
  };

  const openAdd = (preset?: { name: string; grades: string[] }) => {
    setEditingId(null);
    setInitialDraft({
      id: crypto.randomUUID(),
      name: preset?.name || '',
      grades: preset?.grades?.filter(g => availableGrades.includes(g)) || [],
      leadSpecialistId: null,
      sessions: [{ day: '', time: defaultTimeForGrades(preset?.grades || []) }],
    });
    setModalOpen(true);
  };

  const openEdit = (club: Club) => {
    setEditingId(club.id);
    setInitialDraft({
      id: club.id,
      name: club.name,
      grades: club.grades,
      leadSpecialistId: club.leadSpecialistId,
      sessions: club.sessions.length ? club.sessions : [{ day: '', time: '' }],
    });
    setModalOpen(true);
  };

  const specialistName = (id: string | null) => specialists.find(s => s.id === id)?.name || '—';

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-card-foreground">Lunch Clubs (Optional)</h2>
          <p className="text-sm text-muted-foreground">Add lunch clubs or enrichment blocks that run during recess/lunch. A club can run on more than one day.</p>
        </div>
        <SaveStatusIndicator status={saveStatus} />
      </div>

      <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs text-card-foreground">
        <span className="font-semibold">Tip:</span>{' '}
        Lunch clubs can also help resolve specialist scheduling conflicts. If a grade can't fit into the normal rotation, the scheduler can use a club slot to make up the time. Configure this in{' '}
        <button
          type="button"
          onClick={() => setStep(SETUP_STEPS.CONFLICTS)}
          className="font-semibold text-accent underline-offset-2 hover:underline"
        >
          Step 10: Conflicts
        </button>{' '}
        by enabling the <span className="font-semibold">Lunch Clubs</span> strategy.
      </div>


      <div className="flex flex-wrap gap-2">
        {suggestedClubs.map(s => (
          <button
            key={s.name}
            onClick={() => openAdd({ name: s.name, grades: s.grades })}
            disabled={clubs.some(c => c.name === s.name)}
            className="rounded-full border border-border bg-secondary/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-40"
          >
            + {s.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {clubs.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No clubs yet. Use a suggestion above or click "Add Lunch Club".</p>
        )}
        {clubs.map(c => {
          const sessionsLine = c.sessions
            .map(s => `${s.day}${s.time ? ' ' + formatTime(s.time) : ''}`)
            .join(', ');
          return (
            <div key={c.id} className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 space-y-2">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-card-foreground">{c.name || 'Untitled club'}</span>
                    <span className="text-xs text-muted-foreground">· Led by {specialistName(c.leadSpecialistId)}</span>
                  </div>
                  {c.grades.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {[...c.grades].sort((a, b) => gradeOrder.indexOf(a) - gradeOrder.indexOf(b)).map(g => (
                        <span key={g} className="rounded-md bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 text-[10px] font-medium">{g}</span>
                      ))}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {sessionsLine || <span className="italic">No sessions set</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(c)} aria-label="Edit">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeClub(c.id)} aria-label="Delete">
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Button size="sm" variant="outline" onClick={() => openAdd()}>
        <Plus className="h-3 w-3 mr-1" /> Add Lunch Club
      </Button>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={() => setStep(SETUP_STEPS.ADMIN_ROTATION)}>Back</Button>
        <Button onClick={() => setStep(SETUP_STEPS.EVENTS)}>Continue</Button>
      </div>

      {initialDraft && (
        <AddClubModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          initial={initialDraft}
          availableGrades={availableGrades}
          specialists={specialists}
          defaultTimeForGrades={defaultTimeForGrades}
          onSave={persistClub}
        />
      )}
    </div>
  );
};

export default StepClubs;
