import { useState, useRef, useEffect, useCallback } from 'react';
import { SaveStatusIndicator, type SaveStatus } from '@/components/setup/SaveStatusIndicator';
import { SETUP_STEPS } from '../stepIndex';
import { useFlushOnUnmount } from '@/hooks/useFlushOnUnmount';
import { useSetup } from '@/contexts/SetupContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field-label';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Plus, Trash2, Upload, Download, Loader2, ClipboardPaste, Check, Link as LinkIcon, ChevronDown, HelpCircle, Sparkles } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { saveRowsWithSchemaFallback } from '@/lib/supabaseSchemaFallback';
import { appleFormatHint, ROSTER_ACCEPT } from '@/lib/rosterFiles';
import { downloadTemplate } from '@/lib/templateDownload';
import { parseTeacherPaste, inferTeamFromGrade, type ParseResult, type ParsedTeacherRow } from '@/lib/parseTeacherPaste';
import { mapParsedTeachers } from '@/lib/setupImport';
import { aiErrorToast } from '@/lib/aiError';


interface Teacher {
  id: string;
  name: string;
  grade: string;
  room: string;
  phone: string;
  email: string;
  team: string;
  planningMinutes: number;
  weeklyPlanningMinutes: number;
  lunchMinutes: number;
  planningType: string;
  amPmPreference: string;
  dayPreference: string;
  comboPartnerId?: string | null;
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(current.trim()); current = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(current.trim()); current = '';
        if (row.some(c => c)) rows.push(row);
        row = [];
      } else { current += ch; }
    }
  }
  row.push(current.trim());
  if (row.some(c => c)) rows.push(row);
  return rows;
}

function rowsToTeachers(rows: ParsedTeacherRow[], defaultPlanning: number, defaultLunch: number): Teacher[] {
  return rows.map(r => ({
    id: crypto.randomUUID(),
    name: r.name,
    grade: r.grade,
    room: r.room,
    phone: r.phone,
    email: r.email,
    team: r.team || inferTeamFromGrade(r.grade),
    planningMinutes: defaultPlanning,
    weeklyPlanningMinutes: defaultPlanning * 5,
    lunchMinutes: defaultLunch,
    planningType: 'within_school',
    amPmPreference: '',
    dayPreference: '',
  }));
}


const StepTeachers = () => {
  const { setStep, schoolId, data, prefilledTeachers, setPrefilledTeachers } = useSetup();
  const defaultPlanningMin = data.planningMinutes || 45;
  const defaultLunchMin = data.lunchMinutes || 30;
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pastePreview, setPastePreview] = useState<ParseResult | null>(null);
  const [aiParsing, setAiParsing] = useState(false);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [pendingLargeImport, setPendingLargeImport] = useState<Teacher[] | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [view, setView] = useState<'by_grade' | 'flat'>(() => {
    if (typeof window === 'undefined') return 'by_grade';
    return (localStorage.getItem('teachers.view') as 'by_grade' | 'flat') || 'by_grade';
  });
  const [expandedGrade, setExpandedGrade] = useState<string | null>(null);
  const [gradePasteOpen, setGradePasteOpen] = useState<string | null>(null);
  const [gradePasteText, setGradePasteText] = useState('');
  const [gradePastePreview, setGradePastePreview] = useState<ParseResult | null>(null);
  const [comboDraftIds, setComboDraftIds] = useState<Set<string>>(new Set());
  const [comboErrors, setComboErrors] = useState<Record<string, string | null>>({});
  const toggleComboDraft = (id: string, on: boolean) => {
    setComboDraftIds(prev => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
    if (!on) update(id, 'comboPartnerId', '');
  };
  const setComboError = (id: string, msg: string | null) =>
    setComboErrors(prev => ({ ...prev, [id]: msg }));
  const fileRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const isLoaded = useRef(false);

  useEffect(() => {
    try { localStorage.setItem('teachers.view', view); } catch {}
  }, [view]);



  // Load existing teachers from DB on mount
  useEffect(() => {
    if (!schoolId) return;
    const load = async () => {
    const { data: dbData } = await supabase
        .from('classroom_teachers')
        .select('*')
        .eq('school_id', schoolId);
      if (dbData && dbData.length > 0) {
        setTeachers(dbData.map(t => ({
          id: t.id,
          name: t.name,
          grade: t.grade,
          room: t.room || '',
          phone: t.phone || '',
          email: t.email || '',
          team: t.team || '',
          planningMinutes: t.planning_minutes ?? defaultPlanningMin,
          weeklyPlanningMinutes: t.weekly_planning_minutes ?? 0,
          lunchMinutes: t.lunch_minutes ?? defaultLunchMin,
          planningType: t.planning_type || 'within_school',
          amPmPreference: t.am_pm_preference || '',
          dayPreference: t.day_preference || '',
          comboPartnerId: (t as any).combo_partner_id || null,
        })));
      } else if (prefilledTeachers.length > 0) {
        setTeachers(prefilledTeachers.map(t => ({
          id: crypto.randomUUID(),
          name: t.name,
          grade: t.grade,
          room: t.room,
          phone: t.phone || '',
          email: t.email || '',
          team: t.team || '',
          planningMinutes: defaultPlanningMin,
          weeklyPlanningMinutes: defaultPlanningMin * 5,
          lunchMinutes: defaultLunchMin,
          planningType: 'within_school',
          amPmPreference: '',
          dayPreference: '',
        })));
        setPrefilledTeachers([]);
      }
      isLoaded.current = true;
    };
    load();
  }, [schoolId]);

  // Auto-save with debounce
  const autoSave = useCallback(async (items: Teacher[]) => {
    if (!schoolId || !isLoaded.current) return;
    setSaveStatus('saving');
    try {
      const valid = items.filter(t => t.name.trim());
      // Only delete rows the user has actually removed from the list;
      // blank-name rows are preserved so partially-filled rows survive autosave.
      const keepIds = items.map(t => t.id);

      // Delete teachers no longer in the list
      const { data: existing } = await supabase
        .from('classroom_teachers')
        .select('id')
        .eq('school_id', schoolId);
      const existingIds = (existing || []).map(e => e.id);
      const toDelete = existingIds.filter(id => !keepIds.includes(id));
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase.from('classroom_teachers').delete().in('id', toDelete);
        if (delErr) throw delErr;
      }

      // Upsert remaining teachers (preserves existing UUIDs)
      const rows = valid.map(t => ({
        id: t.id,
        school_id: schoolId,
        name: t.name,
        grade: t.grade || 'K',
        room: t.room || null,
        phone: t.phone || null,
        email: t.email || null,
        team: (t.team && t.team.trim()) ? t.team : (inferTeamFromGrade(t.grade) || null),
        planning_minutes: t.planningMinutes,
        weekly_planning_minutes: t.weeklyPlanningMinutes,
        lunch_minutes: t.lunchMinutes,
        planning_type: t.planningType,
        am_pm_preference: t.amPmPreference || null,
        day_preference: t.dayPreference || null,
        combo_partner_id: t.comboPartnerId || null,
      } as any));
      if (rows.length > 0) {
        // Schema-tolerant: an un-migrated column costs that one field, not the
        // whole roster.
        const res = await saveRowsWithSchemaFallback<unknown>(
          'classroom_teachers',
          rows as Array<Record<string, unknown>>,
          (r) => supabase.from('classroom_teachers').upsert(r as never, { onConflict: 'id' }) as never,
          {
            onDrop: (col) => toast.warning(
              `Your database is missing the "${col}" teacher field — everything else was saved.`,
              { id: `schema-drift-teachers-${col}`, duration: 8000 },
            ),
          },
        );
        if (res.error) throw res.error;
      }
      setSaveError(null);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus((cur) => (cur === 'saved' ? 'idle' : cur)), 2000);
    } catch (err: any) {
      // A failed save must never look like a successful one — and must leave a
      // PERSISTENT trace ('idle' rendered nothing at all).
      console.error('Save teachers error:', err);
      toast.error(`Couldn't save teachers${err?.message ? ` — ${err.message}` : ''}. Check your connection and try again.`);
      setSaveError(err?.message ?? 'Save failed');
      setSaveStatus('error');
    }
  }, [schoolId]);

  const latestRef = useRef(teachers);
  latestRef.current = teachers;
  useFlushOnUnmount(saveTimer, () => { if (isLoaded.current) autoSave(latestRef.current); });

  useEffect(() => {
    if (!isLoaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => autoSave(teachers), 1000);
  }, [teachers, autoSave]);

  const add = (grade?: string) => setTeachers(prev => [...prev, {
    id: crypto.randomUUID(), name: '',
    grade: grade || '',
    room: '', phone: '', email: '',
    team: grade ? inferTeamFromGrade(grade) : '',
    planningMinutes: defaultPlanningMin, weeklyPlanningMinutes: defaultPlanningMin * 5,
    lunchMinutes: defaultLunchMin, planningType: 'within_school', amPmPreference: '', dayPreference: ''
  }]);

  const update = (id: string, field: string, value: string | number) => setTeachers(prev => prev.map(t => {
    if (t.id !== id) return t;
    const updated = { ...t, [field]: value };
    // Auto-calculate weekly planning when daily planning changes (assuming 5-day week)
    if (field === 'planningMinutes') {
      updated.weeklyPlanningMinutes = (value as number) * 5;
    }
    return updated;
  }));
  const remove = (id: string) => setTeachers(prev => prev.filter(t => t.id !== id));

  const runParse = (text: string): ParseResult | null => {
    if (!text.trim()) {
      toast.error('Nothing to import');
      return null;
    }
    try {
      return parseTeacherPaste(text);
    } catch (err) {
      console.error('[TeacherPaste]', err);
      toast.error("Couldn't parse — try formatting as 'Name, Grade, Room' per line");
      return null;
    }
  };

  const commitImport = (teachersToAdd: Teacher[]) => {
    setTeachers(prev => [...prev, ...teachersToAdd]);
    toast.success(`Added ${teachersToAdd.length} teachers`);
    setPasteText('');
    setShowPaste(false);
    setPastePreview(null);
    setWarningsOpen(false);
  };

  /** AI parse — for messy rosters the deterministic parser can't split (uses the
   *  parse-teacher-roster function on MODELS.fast, mapped through the shared
   *  mapper so the review table matches the parser contract). */
  const handleAiParse = async () => {
    if (!pasteText.trim() || aiParsing) return;
    setAiParsing(true);
    try {
      const { data, error } = await supabase.functions.invoke('parse-teacher-roster', { body: { text: pasteText } });
      if (error) throw error;
      const mapped = mapParsedTeachers(data?.teachers);
      if (mapped.length === 0) {
        toast.error("AI couldn't find any teachers in that text.");
        return;
      }
      const rows: ParsedTeacherRow[] = mapped.map((t) => ({
        name: t.name,
        grade: t.grade,
        room: t.room,
        phone: '',
        email: '',
        team: inferTeamFromGrade(t.grade),
      }) as ParsedTeacherRow);
      const warnings = mapped.filter((t) => t.preferences).map((t) => `${t.name}: note — ${t.preferences}`);
      setPastePreview({ rows, warnings, headerDetected: true });
      setWarningsOpen(warnings.length > 0);
    } catch (err: any) {
      console.error('[TeacherRoster AI]', err);
      aiErrorToast(err, { retry: handleAiParse, title: "Couldn't read that roster" });
    } finally {
      setAiParsing(false);
    }
  };

  const handlePreviewParse = () => {
    const result = runParse(pasteText);
    if (!result) return;
    if (result.rows.length === 0) {
      toast.error('No valid rows found');
      setPastePreview(result); // still show warnings
      return;
    }
    setPastePreview(result);
    setWarningsOpen(false);
  };

  const handleConfirmPreview = () => {
    if (!pastePreview) return;
    const newTeachers = rowsToTeachers(pastePreview.rows, defaultPlanningMin, defaultLunchMin);
    if (newTeachers.length > 200) {
      setPendingLargeImport(newTeachers);
      return;
    }
    commitImport(newTeachers);
  };

  const handleCancelPreview = () => {
    setPastePreview(null);
    setPasteText('');
    setShowPaste(false);
    setWarningsOpen(false);
  };

  const handleContainerPaste = (e: React.ClipboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    const text = e.clipboardData.getData('text');
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length >= 2) {
      e.preventDefault();
      const result = runParse(text);
      if (!result) return;
      setShowPaste(true);
      setPasteText(text);
      setPastePreview(result);
    }
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const appleHint = appleFormatHint(f.name);
    if (appleHint) {
      if (fileRef.current) fileRef.current.value = '';
      toast.error(appleHint, { duration: 10000 });
      setShowPaste(true);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = runParse(text);
      if (fileRef.current) fileRef.current.value = '';
      if (!result) return;
      if (result.rows.length === 0) {
        toast.error('CSV has no data rows');
        return;
      }
      setShowPaste(true);
      setPasteText(text);
      setPastePreview(result);
    };
    reader.readAsText(f);
  };

  const gradesServed = data.gradesServed || [];
  const canUseByGrade = gradesServed.length > 0;
  const effectiveView: 'by_grade' | 'flat' = canUseByGrade ? view : 'flat';

  const teachersByGrade = (() => {
    const map = new Map<string, Teacher[]>();
    for (const g of gradesServed) map.set(g, []);
    const misc: Teacher[] = [];
    for (const t of teachers) {
      if (t.grade && gradesServed.includes(t.grade)) {
        map.get(t.grade)!.push(t);
      } else {
        misc.push(t);
      }
    }
    return { map, misc };
  })();

  const handleGradePastePreview = (lockedGrade: string) => {
    const result = runParse(gradePasteText);
    if (!result) return;
    if (result.rows.length === 0) {
      toast.error('No valid rows found');
      setGradePastePreview(result);
      return;
    }
    // Lock grade
    const locked: ParseResult = {
      ...result,
      rows: result.rows.map(r => ({ ...r, grade: lockedGrade, team: r.team || inferTeamFromGrade(lockedGrade) })),
    };
    setGradePastePreview(locked);
  };

  const handleGradePasteImport = () => {
    if (!gradePastePreview) return;
    const newTeachers = rowsToTeachers(gradePastePreview.rows, defaultPlanningMin, defaultLunchMin);
    setTeachers(prev => [...prev, ...newTeachers]);
    toast.success(`Added ${newTeachers.length} teachers`);
    setGradePasteOpen(null);
    setGradePasteText('');
    setGradePastePreview(null);
  };

  const renderTeacherRow = (t: Teacher) => (
    <div key={t.id} className="rounded-lg border border-border/60 bg-background p-2.5 space-y-1.5">
      <div className="flex items-end gap-3">
        <div className="flex-[2] space-y-1">
          <FieldLabel className="text-xs" tooltip="Teacher's full name">Name</FieldLabel>
          <Input className="h-8 text-xs" value={t.name} onChange={(e) => update(t.id, 'name', e.target.value)} placeholder="Teacher name" />
        </div>
        <div className="flex-1 space-y-1">
          <FieldLabel className="text-xs" tooltip="Grade level taught (e.g. K, 1, 2)">Grade</FieldLabel>
          <Input className="h-8 text-xs" value={t.grade} onChange={(e) => update(t.id, 'grade', e.target.value)} placeholder="K" />
        </div>
        <div className="flex-1 space-y-1">
          <FieldLabel className="text-xs" tooltip="Classroom number or building location">Room</FieldLabel>
          <Input className="h-8 text-xs" value={t.room} onChange={(e) => update(t.id, 'room', e.target.value)} placeholder="101" />
        </div>
        <div className="flex-1 space-y-1">
          <FieldLabel className="text-xs text-muted-foreground" tooltip="Phone number (optional)">Phone (optional)</FieldLabel>
          <Input className="h-7 text-xs" value={t.phone} onChange={(e) => update(t.id, 'phone', e.target.value)} placeholder="555-0100" />
        </div>
        <div className="flex-1 space-y-1">
          <FieldLabel className="text-xs text-muted-foreground" tooltip="Email address (optional)">Email (optional)</FieldLabel>
          <Input className="h-7 text-xs" value={t.email} onChange={(e) => update(t.id, 'email', e.target.value)} placeholder="teacher@school.edu" />
        </div>
        <div className="flex-1 space-y-1">
          <FieldLabel className="text-xs text-muted-foreground" tooltip="Team grouping for this grade (e.g. Kinder Team, 2A)">Grade Team (optional)</FieldLabel>
          <Input className="h-7 text-xs" value={t.team} onChange={(e) => update(t.id, 'team', e.target.value)} placeholder="e.g. Kinder, 2A" />
          <p className="text-[10px] text-muted-foreground">Defaults to "Grade {'{N}'} Team" if blank.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => remove(t.id)}>
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </div>
      <div className="border-t border-border pt-2 space-y-2">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 items-end">
          <div className="space-y-1">
            <FieldLabel className="text-xs" tooltip="Time the classroom teacher is released while students are with a specialist.">Daily Plan (min)</FieldLabel>
            <Input className="h-8 text-xs" type="number" min={0} value={t.planningMinutes} onChange={(e) => update(t.id, 'planningMinutes', Math.max(0, Number(e.target.value)))} />
          </div>
          <div className="space-y-1">
            <FieldLabel className="text-xs" tooltip="Total weekly planning time this teacher is contractually guaranteed.">Weekly Plan (min)</FieldLabel>
            <Input className="h-8 text-xs" type="number" min={0} value={t.weeklyPlanningMinutes} onChange={(e) => update(t.id, 'weeklyPlanningMinutes', Math.max(0, Number(e.target.value)))} />
          </div>
          <div className="space-y-1">
            <FieldLabel className="text-xs" tooltip="Length of the duty-free lunch period for this teacher.">Lunch (min)</FieldLabel>
            <Input className="h-8 text-xs" type="number" min={0} value={t.lunchMinutes} onChange={(e) => update(t.id, 'lunchMinutes', Math.max(0, Number(e.target.value)))} />
          </div>
          <div className="space-y-1">
            <FieldLabel className="text-xs" tooltip="Choose whether this teacher prefers morning or afternoon specialist classes. Overrides global setting.">AM/PM Pref</FieldLabel>
            <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={t.amPmPreference} onChange={(e) => update(t.id, 'amPmPreference', e.target.value)}>
              <option value="">No Preference</option>
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
          <div className="space-y-1">
            <FieldLabel className="text-xs" tooltip="Preferred day(s) for specialist visits. Overrides the global setting from School Info.">Day Preference</FieldLabel>
            <Input className="h-8 text-xs" value={t.dayPreference} onChange={(e) => update(t.id, 'dayPreference', e.target.value)} placeholder="e.g. Mon, Wed" />
          </div>
        </div>
        <p className="text-[11px] italic text-muted-foreground">Sometimes planning is less for upper grades — adjust per teacher as needed.</p>
      </div>
      <div className="border-t border-border pt-2 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Checkbox
            id={`combo-${t.id}`}
            checked={!!t.comboPartnerId || comboDraftIds.has(t.id)}
            onCheckedChange={(v) => toggleComboDraft(t.id, !!v)}
          />
          <label htmlFor={`combo-${t.id}`} className="text-xs cursor-pointer">Combo class</label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="What is a combo class?">
                  <HelpCircle className="h-3 w-3 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Combo class = two grades or sections taught together by one teacher (common in small schools). The scheduler will treat both grades as a single block.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {(t.comboPartnerId || comboDraftIds.has(t.id)) && (
          <div className="space-y-1 pl-6">
            <FieldLabel className="text-xs">Combined with:</FieldLabel>
            <select
              className="h-8 w-full max-w-xs rounded-md border border-input bg-background px-2 text-xs"
              value={t.comboPartnerId || ''}
              onChange={(e) => {
                if (e.target.value === t.id) {
                  setComboError(t.id, "A teacher can't be combined with themselves.");
                  return;
                }
                setComboError(t.id, null);
                update(t.id, 'comboPartnerId', e.target.value);
              }}
            >
              <option value="">Choose a partner…</option>
              {teachers.filter(o => o.id !== t.id && o.name.trim()).map(o => (
                <option key={o.id} value={o.id}>{o.name}{o.grade ? ` (Grade ${o.grade})` : ''}</option>
              ))}
            </select>
            {comboErrors[t.id] && <p className="text-[10px] text-destructive">{comboErrors[t.id]}</p>}
            <p className="text-[10px] text-muted-foreground italic">Example: If you teach K and 1 together, check this and pick the other K-1 teacher as the partner.</p>
          </div>
        )}
      </div>
    </div>
  );

  const gradeLabel = (g: string) => g === 'K' ? 'Kindergarten' : g === 'Pre-K' ? 'Pre-K' : g === 'TK' ? 'TK' : `Grade ${g}`;

  const renderGradeCard = (g: string, items: Teacher[], opts: { allowPaste: boolean; warning?: string }) => {
    const expanded = expandedGrade === g;
    return (
      <div key={g} className="rounded-lg border border-border bg-background p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{gradeLabel(g)}</h3>
            <span className="text-[11px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {items.length} teacher{items.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {opts.allowPaste && (
              <Button size="sm" variant="outline" className="gap-1.5 h-7 px-2 text-xs" onClick={() => { setGradePasteOpen(g); setGradePasteText(''); setGradePastePreview(null); }}>
                <ClipboardPaste className="h-3 w-3" /> Paste
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setExpandedGrade(expanded ? null : g)}>
              {expanded ? 'Done' : 'Edit'}
            </Button>
            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => { add(opts.allowPaste ? g : undefined); setExpandedGrade(g); }}>
              Add
            </Button>
          </div>
        </div>
        {opts.warning && (
          <p className="text-xs text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1">{opts.warning}</p>
        )}
        {expanded ? (
          <div className="space-y-2">
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No teachers in {gradeLabel(g)} yet — click Paste or + Add.</p>
            ) : items.map(renderTeacherRow)}
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No teachers in {gradeLabel(g)} yet — click Paste or + Add.</p>
        ) : (
          <ul className="space-y-1">
            {items.map(t => (
              <li key={t.id} className="flex items-center justify-between text-xs">
                <span className="text-foreground">
                  {t.name || <em className="text-muted-foreground">(unnamed)</em>}
                  {t.room && <span className="text-muted-foreground"> — Room {t.room}</span>}
                  {!!t.comboPartnerId && <span className="ml-2 text-primary text-[10px]">⇄ combo</span>}
                </span>
                <button onClick={() => remove(t.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };



  return (
    <div ref={containerRef} onPaste={handleContainerPaste} className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-card-foreground">Classroom Teachers</h2>
          <p className="text-sm text-muted-foreground">Add your classroom teachers. Grade (e.g. K, 1, 2) · Room number or name · Grade Team (e.g. Kinder Team, Grade 2 Team)</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canUseByGrade && (
            <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setView('by_grade')}
                className={`px-2.5 py-1 rounded ${effectiveView === 'by_grade' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >By Grade</button>
              <button
                type="button"
                onClick={() => setView('flat')}
                className={`px-2.5 py-1 rounded ${effectiveView === 'flat' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >Flat List</button>
            </div>
          )}
          <SaveStatusIndicator status={saveStatus} errorMessage={saveError} onRetry={() => autoSave(teachers)} />

          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 border-accent text-accent hover:bg-accent/10"
            onClick={() => downloadTemplate('teachers', '/templates/teachers_template.csv')}
          >
            <Download className="h-3 w-3" /> Template
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3 w-3" /> CSV
          </Button>
          <input ref={fileRef} type="file" accept={ROSTER_ACCEPT} className="hidden" onChange={handleCSVUpload} />
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowPaste(!showPaste)}>
            <ClipboardPaste className="h-3 w-3" /> Paste
          </Button>
          
        </div>
      </div>

      {showPaste && (
        <div className="rounded-lg border border-border bg-background p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            One teacher per line — <strong className="text-foreground">name and grade is enough</strong>. You don't
            need to create any categories or headers; two columns works. Numbers or Excel: select the
            cells and copy. Free-form also works: 'Smith, K, 101' or 'Mrs. Smith teaches Kindergarten in room 101'.
          </p>
          <Textarea
            className="min-h-[100px] text-xs font-mono"
            placeholder={"Name\tGrade\tRoom\tTeam\nJane Doe\tK\t101\tKinder Team"}
            value={pasteText}
            onChange={(e) => { setPasteText(e.target.value); setPastePreview(null); }}
          />
          {pastePreview ? (
            <div className="rounded-md border border-border bg-card p-3 space-y-2">
              <p className="text-xs font-medium text-foreground">
                {pastePreview.rows.length} teacher{pastePreview.rows.length === 1 ? '' : 's'} detected
                {' — '}
                <span className={pastePreview.warnings.length > 0 ? 'text-amber-600' : 'text-muted-foreground'}>
                  {pastePreview.warnings.length} warning{pastePreview.warnings.length === 1 ? '' : 's'}
                </span>
                {pastePreview.headerDetected && <span className="text-muted-foreground"> · header row detected</span>}
              </p>
              {pastePreview.warnings.length > 0 && (
                <Collapsible open={warningsOpen} onOpenChange={setWarningsOpen}>
                  <CollapsibleTrigger className="flex items-center gap-1 text-xs text-amber-700 hover:underline">
                    <ChevronDown className={`h-3 w-3 transition-transform ${warningsOpen ? '' : '-rotate-90'}`} />
                    {warningsOpen ? 'Hide' : 'Show'} warnings
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-0.5">
                    {pastePreview.warnings.map((w, i) => (
                      <p key={i} className="text-xs text-amber-700">• {w}</p>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}
              <div className="flex gap-2 justify-end pt-1">
                <Button size="sm" variant="ghost" onClick={handleCancelPreview}>Cancel</Button>
                <Button size="sm" onClick={handleConfirmPreview} disabled={pastePreview.rows.length === 0}>
                  Import {pastePreview.rows.length > 0 ? `(${pastePreview.rows.length})` : ''}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={handleCancelPreview}>Cancel</Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={handleAiParse} disabled={!pasteText.trim() || aiParsing}>
                {aiParsing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Parse with AI
              </Button>
              <Button size="sm" onClick={handlePreviewParse} disabled={!pasteText.trim() || aiParsing}>Preview</Button>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={!!pendingLargeImport} onOpenChange={(o) => { if (!o) setPendingLargeImport(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>That's a lot — are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              You're about to import {pendingLargeImport?.length ?? 0} teachers. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingLargeImport(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (pendingLargeImport) commitImport(pendingLargeImport); setPendingLargeImport(null); }}>
              Yes, import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      {teachers.length === 0 && !showPaste && (
        <div className="text-center py-10 text-sm text-muted-foreground">No teachers added yet. Click <strong>Paste</strong> to bulk-import from a spreadsheet, or <strong>Add</strong> to enter one at a time.</div>
      )}

      {effectiveView === 'flat' && teachers.map(renderTeacherRow)}

      {effectiveView === 'by_grade' && (
        <div className="space-y-3">
          {gradesServed.map(g => renderGradeCard(g, teachersByGrade.map.get(g) || [], { allowPaste: true }))}
          {teachersByGrade.misc.length > 0 && renderGradeCard('__misc__', teachersByGrade.misc, {
            allowPaste: false,
            warning: 'These teachers have a grade not in your school\'s grade list. Fix the grade or add it under School Info.',
          })}
        </div>
      )}

      {/* Per-grade Paste modal */}
      <Dialog open={!!gradePasteOpen} onOpenChange={(o) => { if (!o) { setGradePasteOpen(null); setGradePasteText(''); setGradePastePreview(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {gradePasteOpen ? gradeLabel(gradePasteOpen) : ''} Teachers</DialogTitle>
            <DialogDescription>
              Paste names one per line. Optional: add Room after a tab or comma. Grade will be locked to <strong>{gradePasteOpen ? gradeLabel(gradePasteOpen) : ''}</strong>.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            className="min-h-[140px] text-xs font-mono"
            placeholder={"Jane Doe\nJohn Smith\tRoom 101"}
            value={gradePasteText}
            onChange={(e) => { setGradePasteText(e.target.value); setGradePastePreview(null); }}
          />
          {gradePastePreview && (
            <div className="rounded-md border border-border bg-card p-3 space-y-2">
              <p className="text-xs font-medium text-foreground">
                {gradePastePreview.rows.length} teacher{gradePastePreview.rows.length === 1 ? '' : 's'} detected
                {gradePastePreview.warnings.length > 0 && (
                  <span className="text-amber-600"> — {gradePastePreview.warnings.length} warning{gradePastePreview.warnings.length === 1 ? '' : 's'}</span>
                )}
              </p>
              {gradePastePreview.warnings.length > 0 && (
                <div className="space-y-0.5">
                  {gradePastePreview.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-700">• {w}</p>
                  ))}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => { setGradePasteOpen(null); setGradePasteText(''); setGradePastePreview(null); }}>Cancel</Button>
            {!gradePastePreview ? (
              <Button size="sm" disabled={!gradePasteText.trim()} onClick={() => gradePasteOpen && handleGradePastePreview(gradePasteOpen)}>Preview</Button>
            ) : (
              <Button size="sm" disabled={gradePastePreview.rows.length === 0} onClick={handleGradePasteImport}>
                Import ({gradePastePreview.rows.length})
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex justify-end pt-1">
        <Button size="sm" onClick={() => add()}>Add Teacher</Button>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={() => setStep(SETUP_STEPS.SPECIALISTS)}>Back</Button>
        <Button onClick={() => setStep(SETUP_STEPS.CONFLICTS)}>Continue</Button>
      </div>
    </div>
  );
};

export default StepTeachers;
