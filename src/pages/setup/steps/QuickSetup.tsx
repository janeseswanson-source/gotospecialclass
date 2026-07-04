// Quick Setup — the AI-first entry to the wizard. Drop a specialist roster + a
// teacher roster and (optionally) free-text notes; we create the school, fan the
// files out to the parsers IN PARALLEL with per-file status chips, prefill the
// matching steps (marked ✓), and drop the user into the wizard to review. The
// classic step-by-step path stays available on Welcome.
import { useRef, useState } from 'react';
import { useSchool } from '@/contexts/SchoolContext';
import { useSetup } from '@/contexts/SetupContext';
import { SETUP_STEPS } from '../stepIndex';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Upload, FileSpreadsheet, FileText, X, Loader2, CheckCircle2, AlertCircle, Sparkles, Users, Star, CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { aiErrorToast } from '@/lib/aiError';
import { mapParsedSpecialists, mapParsedTeachers } from '@/lib/setupImport';
import { useCalendarUpload } from '@/hooks/useCalendarUpload';

type Status = 'idle' | 'parsing' | 'done' | 'error';
interface Slot { file: File | null; status: Status; count: number; error?: string }
const emptySlot = (): Slot => ({ file: null, status: 'idle', count: 0 });

function parseCSV(text: string): string[][] {
  return text.split(/\r?\n/).filter(l => l.trim()).map(line => line.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
}

async function fileToRows(file: File): Promise<string[][]> {
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'csv') return parseCSV(await file.text());
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', blankrows: false }) as unknown as string[][];
}

interface Props {
  onCancel: () => void;
}

const ROSTER_ACCEPT = '.xlsx,.xls,.csv';

const QuickSetup = ({ onCancel }: Props) => {
  const { workspaceId, selectedSchoolId } = useSchool();
  const {
    data, schoolId, setSchoolId, setStep, markStepVisited,
    setPrefilledSpecialists, setPrefilledTeachers, updateData,
    setCalendarEvents, setCalendarUploadId, setCalendarParsed, setCalendarFileName,
  } = useSetup();
  const { uploadAndParse } = useCalendarUpload(schoolId);

  const [specialists, setSpecialists] = useState<Slot>(emptySlot());
  const [teachers, setTeachers] = useState<Slot>(emptySlot());
  const [calendar, setCalendar] = useState<Slot>(emptySlot());
  const [notes, setNotes] = useState('');
  const [running, setRunning] = useState(false);
  const specRef = useRef<HTMLInputElement>(null);
  const teachRef = useRef<HTMLInputElement>(null);
  const calRef = useRef<HTMLInputElement>(null);

  const pick = (setSlot: (s: Slot) => void, maxBytes = 5_242_880) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > maxBytes) { toast.error(`File too large (max ${Math.round(maxBytes / 1_048_576)} MB).`); return; }
    setSlot({ file: f, status: 'idle', count: 0 });
  };

  const anyFile = !!specialists.file || !!teachers.file || !!calendar.file || !!notes.trim();

  /** Create the school row if we don't have one yet (Quick Setup runs pre-School-Info). */
  async function ensureSchool(): Promise<string | null> {
    if (schoolId) return schoolId;
    if (selectedSchoolId) { setSchoolId(selectedSchoolId); return selectedSchoolId; }
    if (!workspaceId || !data.schoolName.trim()) { toast.error('Enter a school name first.'); return null; }
    const { data: created, error } = await supabase
      .from('schools')
      .insert({ name: data.schoolName.trim(), workspace_id: workspaceId, setup_step: 1 } as any)
      .select('id')
      .single();
    if (error || !created) { toast.error('Could not create the school. Try the classic path.'); return null; }
    setSchoolId(created.id);
    return created.id;
  }

  async function parseSpecialists(): Promise<void> {
    if (!specialists.file) return;
    setSpecialists(s => ({ ...s, status: 'parsing' }));
    try {
      const rows = await fileToRows(specialists.file);
      const { data: res, error } = await supabase.functions.invoke('parse-specialist-template', { body: { rows } });
      if (error) throw error;
      const mapped = mapParsedSpecialists(res?.specialists);
      setPrefilledSpecialists(mapped.map(s => ({
        name: s.name, subject: s.subject, days: s.workingDays,
        planningMinutes: null, lunchMinutes: null,
        location: s.location, usesCart: false,
        twoSchools: s.twoSchools, secondSchoolName: s.secondSchoolName, secondLocation: '',
      })));
      if (mapped.length) markStepVisited(SETUP_STEPS.SPECIALISTS);
      setSpecialists(s => ({ ...s, status: 'done', count: mapped.length }));
    } catch (err: any) {
      setSpecialists(s => ({ ...s, status: 'error', error: 'parse failed' }));
      throw err;
    }
  }

  async function parseTeachers(): Promise<void> {
    if (!teachers.file) return;
    setTeachers(s => ({ ...s, status: 'parsing' }));
    try {
      const rows = await fileToRows(teachers.file);
      const { data: res, error } = await supabase.functions.invoke('parse-teacher-roster', { body: { rows } });
      if (error) throw error;
      const mapped = mapParsedTeachers(res?.teachers);
      setPrefilledTeachers(mapped.map(t => ({
        name: t.name, grade: t.grade, room: t.room, phone: '', email: '', team: '',
      })));
      if (mapped.length) markStepVisited(SETUP_STEPS.TEACHERS);
      setTeachers(s => ({ ...s, status: 'done', count: mapped.length }));
    } catch (err: any) {
      setTeachers(s => ({ ...s, status: 'error', error: 'parse failed' }));
      throw err;
    }
  }

  async function parseCalendar(id: string): Promise<void> {
    if (!calendar.file) return;
    setCalendar(s => ({ ...s, status: 'parsing' }));
    try {
      const res = await uploadAndParse({ file: calendar.file }, id);
      if (!res) throw new Error('Calendar parse failed');
      setCalendarEvents(res.events);
      setCalendarUploadId(res.uploadId);
      setCalendarParsed(true);
      setCalendarFileName(calendar.file.name);
      markStepVisited(SETUP_STEPS.CALENDAR);
      setCalendar(s => ({ ...s, status: 'done', count: res.events.length }));
    } catch (err: any) {
      setCalendar(s => ({ ...s, status: 'error', error: 'parse failed' }));
      throw err;
    }
  }

  async function run() {
    if (running) return;
    setRunning(true);
    const id = await ensureSchool();
    if (!id) { setRunning(false); return; }
    if (notes.trim()) updateData({ notes: notes.trim() });

    // Fan out to the parsers in PARALLEL; one failing doesn't sink the others.
    const attempted = (specialists.file ? 1 : 0) + (teachers.file ? 1 : 0) + (calendar.file ? 1 : 0);
    const results = await Promise.allSettled([parseSpecialists(), parseTeachers(), parseCalendar(id)]);
    const failed = results.filter(r => r.status === 'rejected');
    setRunning(false);

    if (failed.length > 0 && failed.length >= attempted) {
      aiErrorToast((failed[0] as PromiseRejectedResult).reason, { retry: run, title: 'AI setup hit a snag' });
      return;
    }
    if (failed.length) toast.warning('Some files needed a second pass — you can re-run them in their step.');
    else toast.success('Prefilled from your files — review each step and tweak as needed.');

    // Land the user in the wizard to confirm the AI-filled data.
    setStep(SETUP_STEPS.SCHOOL_INFO);
  }

  const chip = (label: string, slot: Slot, Icon: typeof Users) => (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
      slot.status === 'done' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        : slot.status === 'error' ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : slot.status === 'parsing' ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border bg-muted/40 text-muted-foreground',
    )}>
      {slot.status === 'parsing' ? <Loader2 className="h-3 w-3 animate-spin" />
        : slot.status === 'done' ? <CheckCircle2 className="h-3 w-3" />
          : slot.status === 'error' ? <AlertCircle className="h-3 w-3" />
            : <Icon className="h-3 w-3" />}
      {label}
      {slot.status === 'done' && ` · ${slot.count} ✓`}
      {slot.status === 'parsing' && ' · reading…'}
      {slot.status === 'error' && ' · retry in step'}
    </span>
  );

  const dropzone = (
    label: string, hint: string, slot: Slot, setSlot: (s: Slot) => void,
    ref: React.RefObject<HTMLInputElement>, onPick: (e: React.ChangeEvent<HTMLInputElement>) => void,
    accept = ROSTER_ACCEPT, FileIcon: typeof FileSpreadsheet = FileSpreadsheet,
  ) => (
    <div className="rounded-xl border-2 border-dashed border-border bg-muted/20 p-4">
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={onPick} disabled={running} />
      {slot.file ? (
        <div className="flex items-center gap-2">
          <FileIcon className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{slot.file.name}</span>
          {!running && <button type="button" onClick={() => setSlot(emptySlot())} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
        </div>
      ) : (
        <button type="button" onClick={() => ref.current?.click()} disabled={running} className="flex w-full items-center gap-3 text-left">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Upload className="h-4 w-4" /></span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">{label}</span>
            <span className="block text-xs text-muted-foreground">{hint}</span>
          </span>
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent"><Sparkles className="h-5 w-5" /></span>
        <div>
          <h3 className="text-base font-bold text-foreground">Set up with AI</h3>
          <p className="text-sm text-muted-foreground">Drop your rosters and we'll prefill the wizard. Everything stays editable.</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {dropzone('Specialist roster', 'Music, Art, PE… (.xlsx / .csv)', specialists, setSpecialists, specRef, pick(setSpecialists))}
        {dropzone('Teacher roster', 'Classroom teachers (.xlsx / .csv)', teachers, setTeachers, teachRef, pick(setTeachers))}
        {dropzone('School calendar', 'Holidays & early release (.pdf)', calendar, setCalendar, calRef, pick(setCalendar, 20 * 1024 * 1024), '.pdf', FileText)}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Anything else? (optional)</label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} disabled={running}
          placeholder="e.g. PE teacher is off Fridays; combo class 3A/3B; no specials before 9." />
      </div>

      {(specialists.status !== 'idle' || teachers.status !== 'idle' || calendar.status !== 'idle') && (
        <div className="flex flex-wrap gap-2">
          {specialists.file && chip('Specialists', specialists, Star)}
          {teachers.file && chip('Teachers', teachers, Users)}
          {calendar.file && chip('Calendar', calendar, CalendarDays)}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={running}>Prefer step-by-step?</Button>
        <Button onClick={run} disabled={!anyFile || running || !data.schoolName.trim()} className="gap-2">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {running ? 'Setting up…' : 'Set up with AI'}
        </Button>
      </div>
      {!data.schoolName.trim() && (
        <p className="text-right text-xs text-muted-foreground">Enter a school name above first.</p>
      )}
    </div>
  );
};

export default QuickSetup;
