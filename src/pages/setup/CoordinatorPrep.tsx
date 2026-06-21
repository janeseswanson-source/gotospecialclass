import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useSchool } from '@/contexts/SchoolContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SaveStatusIndicator, SaveStatus } from '@/components/setup/SaveStatusIndicator';
import { useFlushOnUnmount } from '@/hooks/useFlushOnUnmount';
import { Download, FileText, ClipboardList, Wand2, Upload, Loader2, AlertTriangle, XCircle, Info } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import CoordinatorPrepDoc, { PrepRow } from '@/pdf/CoordinatorPrep';

interface PrepState {
  school_site_url: string;
  district_calendar_url: string;
  early_release_day: string;
  early_release_end_time: string;
  teacher_union_url: string;
  teacher_contract_url: string;
  grade_preference: string;
  day_preference: string[];
  am_pm_preference: string;
  specialist_count: number | null;
  cart_users: string;
  two_school_users: string;
  part_time_users: string;
  custom_grade_prefs: string;
  mostly_monday_holidays: boolean | null;
  holiday_notes: string;
  calendar_file_path: string;
  calendar_file_name: string;
  has_special_rotation: boolean | null;
  plus_mode: string; // '' | 'admin' | 'ai_auto_fit'
  plus_days: string[];
  plus_rationale: string;
  special_rotation_notes: string;
}

const empty: PrepState = {
  school_site_url: '',
  district_calendar_url: '',
  early_release_day: '',
  early_release_end_time: '',
  teacher_union_url: '',
  teacher_contract_url: '',
  grade_preference: '',
  day_preference: [],
  am_pm_preference: '',
  specialist_count: null,
  cart_users: '',
  two_school_users: '',
  part_time_users: '',
  custom_grade_prefs: '',
  mostly_monday_holidays: null,
  holiday_notes: '',
  calendar_file_path: '',
  calendar_file_name: '',
  has_special_rotation: null,
  plus_mode: '',
  plus_days: [],
  plus_rationale: '',
  special_rotation_notes: '',
};

const SECTIONS = [
  { id: 'school-info', label: 'School Info' },
  { id: 'teacher-links', label: 'Teacher Links' },
  { id: 'schedule-prefs', label: 'Schedule Preferences' },
  { id: 'specialists', label: 'Specialist Specifics' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'rotations', label: 'Special Rotations' },
];


const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function schedulingStyleLabel(v: string): string {
  if (v === 'keep_together') return 'Keep grades together';
  if (v === 'waterfall') return 'Waterfall (rolling rotation of mismatched lessons)';
  if (v === 'fixed_sequence') return 'Fixed Daily Sequence (K → 5)';
  return '';
}

function buildRows(p: PrepState, schoolName?: string): PrepRow[] {
  return [
    { question: 'School name', answer: schoolName },
    { question: 'School site URL', answer: p.school_site_url },
    { question: 'District calendar URL', answer: p.district_calendar_url },
    { question: 'Weekly early-release day', answer: p.early_release_day || 'None' },
    { question: 'Early-release end time', answer: p.early_release_end_time },
    { question: 'Teacher union link', answer: p.teacher_union_url },
    { question: 'Teacher contract link', answer: p.teacher_contract_url },
    { question: 'Specialist scheduling style', answer: schedulingStyleLabel(p.grade_preference) },
    { question: 'How many specialist teachers?', answer: p.specialist_count == null ? '' : String(p.specialist_count) },
    { question: 'Specialists using a teaching cart', answer: p.cart_users },
    { question: 'Specialists at two schools', answer: p.two_school_users },
    { question: 'Part-time specialists (with days)', answer: p.part_time_users },
    { question: 'Specialists with custom grade preferences', answer: p.custom_grade_prefs },
    { question: 'Calendar attached', answer: p.calendar_file_name || 'Not uploaded' },
    { question: 'Special additional rotation (PLUS)?', answer: p.has_special_rotation == null ? '' : p.has_special_rotation ? 'Yes' : 'No' },
    { question: 'PLUS handling', answer: p.plus_mode === 'admin' ? 'Admin-specified' : p.plus_mode === 'ai_auto_fit' ? 'AI auto-fit (no extra day)' : '—' },
    { question: 'PLUS day(s) selected', answer: p.plus_mode === 'admin' ? (p.plus_days.join(', ') || '—') : '—' },
    { question: 'PLUS rationale (why this day?)', answer: p.plus_mode === 'admin' ? p.plus_rationale : '' },
    { question: 'PLUS time block & grades', answer: p.plus_mode === 'admin' ? p.special_rotation_notes : '' },
  ];
}

const CoordinatorPrep = () => {
  const { workspaceId, selectedSchoolId, selectedSchool } = useSchool();
  const [state, setState] = useState<PrepState>(empty);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [aiWarnings, setAiWarnings] = useState<Array<{ field: string; message: string; severity: string }>>([]);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const stateRef = useRef(state);
  stateRef.current = state;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setUploading(true);
      setAiWarnings([]);
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
      }
      const file_base64 = btoa(binary);
      const { data: fnData, error: fnError } = await supabase.functions.invoke('parse-coordinator-prep', {
        body: { file_base64, mime_type: f.type, school_name: selectedSchool?.name },
      });
      if (fnError) { toast.error(fnError.message || 'AI processing failed'); return; }
      if (fnData?.error) { toast.error(fnData.error); return; }
      const r = fnData as any;
      setState(prev => ({
        ...prev,
        school_site_url: r.school_site_url || prev.school_site_url,
        district_calendar_url: r.district_calendar_url || prev.district_calendar_url,
        early_release_day: r.early_release_day ?? prev.early_release_day,
        early_release_end_time: r.early_release_end_time || prev.early_release_end_time,
        teacher_union_url: r.teacher_union_url || prev.teacher_union_url,
        teacher_contract_url: r.teacher_contract_url || prev.teacher_contract_url,
        grade_preference: r.grade_preference || prev.grade_preference,
        day_preference: r.day_preference?.length ? r.day_preference : prev.day_preference,
        am_pm_preference: r.am_pm_preference || prev.am_pm_preference,
        specialist_count: r.specialist_count ?? prev.specialist_count,
        cart_users: r.cart_users || prev.cart_users,
        two_school_users: r.two_school_users || prev.two_school_users,
        part_time_users: r.part_time_users || prev.part_time_users,
        custom_grade_prefs: r.custom_grade_prefs || prev.custom_grade_prefs,
        mostly_monday_holidays: r.mostly_monday_holidays ?? prev.mostly_monday_holidays,
        holiday_notes: r.holiday_notes || prev.holiday_notes,
        has_special_rotation: r.has_special_rotation ?? prev.has_special_rotation,
        plus_mode: r.plus_mode || prev.plus_mode,
        plus_days: r.plus_days?.length ? r.plus_days : prev.plus_days,
        plus_rationale: r.plus_rationale || prev.plus_rationale,
        special_rotation_notes: r.special_rotation_notes || prev.special_rotation_notes,
      }));
      setAiWarnings(r.warnings || []);
      const warnCount = (r.warnings || []).length;
      toast.success(warnCount ? `Prep autofilled — ${warnCount} item(s) to review` : 'Prep autofilled from your sheet!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to process upload');
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const severityIcon = (sev: string) => {
    if (sev === 'error') return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
    if (sev === 'warning') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    return <Info className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
  };

  // Initial load
  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    (async () => {
      let q = supabase.from('coordinator_prep').select('*').eq('workspace_id', workspaceId);
      q = selectedSchoolId ? q.eq('school_id', selectedSchoolId) : q.is('school_id', null);
      const { data, error } = await q.maybeSingle();
      if (error && error.code !== 'PGRST116') {
        console.error('[CoordinatorPrep] load', error);
      }
      if (data) {
        setState({
          school_site_url: data.school_site_url ?? '',
          district_calendar_url: data.district_calendar_url ?? '',
          early_release_day: data.early_release_day ?? '',
          early_release_end_time: data.early_release_end_time ?? '',
          teacher_union_url: (data as any).teacher_union_url ?? '',
          teacher_contract_url: (data as any).teacher_contract_url ?? '',
          grade_preference: data.grade_preference ?? '',
          day_preference: data.day_preference ?? [],
          am_pm_preference: data.am_pm_preference ?? '',
          specialist_count: data.specialist_count,
          cart_users: data.cart_users ?? '',
          two_school_users: data.two_school_users ?? '',
          part_time_users: data.part_time_users ?? '',
          custom_grade_prefs: data.custom_grade_prefs ?? '',
          mostly_monday_holidays: data.mostly_monday_holidays,
          holiday_notes: data.holiday_notes ?? '',
          calendar_file_path: (data as any).calendar_file_path ?? '',
          calendar_file_name: (data as any).calendar_file_name ?? '',
          has_special_rotation: data.has_special_rotation,
          plus_mode: (data as any).plus_mode ?? '',
          plus_days: (data as any).plus_days ?? [],
          plus_rationale: (data as any).plus_rationale ?? '',
          special_rotation_notes: data.special_rotation_notes ?? '',
        });
      } else {
        setState(empty);
      }
      setLoading(false);
    })();
  }, [workspaceId, selectedSchoolId]);

  const persist = async (s: PrepState) => {
    if (!workspaceId) return;
    setSaveStatus('saving');
    try {
      // Manual upsert: try update first, insert on no rows.
      let query = supabase.from('coordinator_prep').select('id').eq('workspace_id', workspaceId);
      query = selectedSchoolId ? query.eq('school_id', selectedSchoolId) : query.is('school_id', null);
      const { data: existing } = await query.maybeSingle();

      const payload = {
        workspace_id: workspaceId,
        school_id: selectedSchoolId,
        school_site_url: s.school_site_url || null,
        district_calendar_url: s.district_calendar_url || null,
        early_release_day: s.early_release_day || null,
        early_release_end_time: s.early_release_end_time || null,
        teacher_union_url: s.teacher_union_url || null,
        teacher_contract_url: s.teacher_contract_url || null,
        grade_preference: s.grade_preference || null,
        day_preference: s.day_preference,
        am_pm_preference: s.am_pm_preference || null,
        specialist_count: s.specialist_count,
        cart_users: s.cart_users || null,
        two_school_users: s.two_school_users || null,
        part_time_users: s.part_time_users || null,
        custom_grade_prefs: s.custom_grade_prefs || null,
        mostly_monday_holidays: s.mostly_monday_holidays,
        holiday_notes: s.holiday_notes || null,
        calendar_file_path: s.calendar_file_path || null,
        calendar_file_name: s.calendar_file_name || null,
        has_special_rotation: s.has_special_rotation,
        plus_mode: s.plus_mode || null,
        plus_days: s.plus_days,
        plus_rationale: s.plus_rationale || null,
        special_rotation_notes: s.special_rotation_notes || null,
      };

      // Mirror plus_mode to schools.plus_auto_fit so the generator can branch on it.
      if (selectedSchoolId) {
        await supabase
          .from('schools')
          .update({ plus_auto_fit: s.plus_mode === 'ai_auto_fit' } as any)
          .eq('id', selectedSchoolId);
      }

      const { error } = existing
        ? await supabase.from('coordinator_prep').update(payload).eq('id', existing.id)
        : await supabase.from('coordinator_prep').insert(payload);

      if (error) throw error;
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(prev => (prev === 'saved' ? 'idle' : prev)), 1500);
    } catch (e) {
      console.error('[CoordinatorPrep] save', e);
      setSaveStatus('error');
      toast.error("Couldn't save your prep — try again");
    }
  };

  // Debounced autosave whenever state changes (after initial load)
  useEffect(() => {
    if (loading) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(stateRef.current), 1000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, loading]);

  useFlushOnUnmount(saveTimer, () => persist(stateRef.current));

  const set = <K extends keyof PrepState>(k: K, v: PrepState[K]) =>
    setState(prev => ({ ...prev, [k]: v }));

  // Scroll-spy: highlight the section currently in view
  useEffect(() => {
    if (loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActiveSection(visible.target.id);
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [loading]);

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const rows = buildRows(state, selectedSchool?.name);
      const blob = await pdf(<CoordinatorPrepDoc schoolName={selectedSchool?.name} rows={rows} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `coordinator-prep${selectedSchool?.name ? `-${selectedSchool.name.replace(/\s+/g, '-')}` : ''}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[CoordinatorPrep] pdf', e);
      toast.error('Could not generate PDF. Try again?');
    } finally {
      setDownloading(false);
    }
  };

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" />
            The Take-In Template
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Prefer paper to clicking through a wizard? Print this one sheet, fill it in by hand,
            then upload it — Claude reads your handwriting and fills in your whole setup for you.
            It's the same setup, the easy way.
          </p>
        </div>
        <SaveStatusIndicator status={saveStatus} />
      </div>

      {/* How it works — three plain steps */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { n: 1, icon: Download, title: 'Print the sheet', body: 'Download the PDF and print it (or fill it on screen below).' },
          { n: 2, icon: FileText, title: 'Fill it in', body: 'Write your answers by hand at school — no computer needed.' },
          { n: 3, icon: Wand2, title: 'Upload — we do the rest', body: 'Snap a photo or scan it. Claude fills in your setup automatically.' },
        ].map((s) => (
          <div key={s.n} className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">{s.n}</div>
            <div>
              <p className="font-medium text-card-foreground text-sm flex items-center gap-1.5"><s.icon className="h-3.5 w-3.5 text-primary" />{s.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap rounded-xl border border-primary/20 bg-primary/5 p-4">
        <Button onClick={() => uploadRef.current?.click()} disabled={uploading} size="lg">
          {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
          {uploading ? 'Reading your sheet…' : 'Upload my filled-in sheet'}
        </Button>
        <Button variant="outline" onClick={handleDownloadPdf} disabled={downloading}>
          <Download className="h-4 w-4 mr-2" />
          {downloading ? 'Preparing…' : 'Download blank template (PDF)'}
        </Button>
        <input
          ref={uploadRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleUpload}
        />
        <span className="text-xs text-muted-foreground flex-1 min-w-[12rem]">
          Rather click through it instead?{' '}
          <Link to="/app/setup" className="text-primary underline underline-offset-2 hover:opacity-80">Use the Setup Wizard</Link>.
        </span>
      </div>

      {aiWarnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:bg-amber-900/10 dark:border-amber-800 p-3 space-y-1.5">
          <p className="text-xs font-medium text-card-foreground">Review these items from your upload:</p>
          {aiWarnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5">
              {severityIcon(w.severity)}
              <span className="text-[11px] text-muted-foreground">
                <strong className="text-card-foreground">{w.field}:</strong> {w.message}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
        {/* Left rail */}
        <aside className="lg:sticky lg:top-4 self-start space-y-1">
          {SECTIONS.map(s => {
            const isActive = activeSection === s.id;
            return (
              <button
                key={s.id}
                onClick={() => { setActiveSection(s.id); scrollTo(s.id); }}
                aria-current={isActive ? 'true' : undefined}
                className={`relative block w-full text-left text-sm px-3 py-2 rounded-md transition-colors ${
                  isActive
                    ? 'bg-accent/20 text-foreground font-medium after:content-[""] after:absolute after:right-[-6px] after:top-1/2 after:-translate-y-1/2 after:border-y-[6px] after:border-y-transparent after:border-l-[6px] after:border-l-accent'
                    : 'text-muted-foreground hover:bg-accent/10 hover:text-foreground'
                }`}
              >
                {s.label}
              </button>
            );
          })}
          <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <FileText className="h-4 w-4 mb-1 text-primary" />
            Autosaves as you type. Safe to leave anytime.
          </div>
        </aside>

        {/* Form sections */}
        <div className="space-y-6">
          {/* School Info */}
          <section id="school-info" className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h2 className="font-semibold text-card-foreground">School Info</h2>

            <div className="space-y-2">
              <Label htmlFor="site">School Site URL</Label>
              <Input id="site" placeholder="https://school.district.org"
                value={state.school_site_url} onChange={(e) => set('school_site_url', e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cal">District Calendar URL</Label>
              <Input id="cal" placeholder="https://district.org/calendar.pdf"
                value={state.district_calendar_url} onChange={(e) => set('district_calendar_url', e.target.value)} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Weekly early-release day</Label>
                <Select value={state.early_release_day || 'none'} onValueChange={(v) => set('early_release_day', v === 'none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {DAYS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {state.early_release_day && (
                <div className="space-y-2">
                  <Label htmlFor="er-end">Early-release end time</Label>
                  <Input id="er-end" type="time"
                    value={state.early_release_end_time} onChange={(e) => set('early_release_end_time', e.target.value)} />
                </div>
              )}
            </div>
          </section>

          {/* Teacher Links */}
          <section id="teacher-links" className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h2 className="font-semibold text-card-foreground">Teacher Links <span className="text-xs font-normal text-muted-foreground ml-1">(optional)</span></h2>
            <p className="text-sm text-muted-foreground">
              Handy references for contract-driven scheduling rules. We don't share these — they just live on your prep sheet.
            </p>

            <div className="space-y-2">
              <Label htmlFor="union-url">Teacher union link</Label>
              <Input id="union-url" placeholder="https://localunion.org"
                value={state.teacher_union_url} onChange={(e) => set('teacher_union_url', e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contract-url">Teacher contract link</Label>
              <Input id="contract-url" placeholder="https://district.org/contract.pdf"
                value={state.teacher_contract_url} onChange={(e) => set('teacher_contract_url', e.target.value)} />
            </div>
          </section>


          {/* Schedule Preferences */}
          <section id="schedule-prefs" className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h2 className="font-semibold text-card-foreground">Schedule Preferences</h2>

            <div className="space-y-2">
              <Label>Specialist scheduling style</Label>
              <RadioGroup value={state.grade_preference} onValueChange={(v) => set('grade_preference', v)} className="gap-3">
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <RadioGroupItem value="keep_together" className="mt-0.5" />
                  <span><strong>Keep grades together as much as possible</strong> — minimize the spread across the day.</span>
                </label>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <RadioGroupItem value="waterfall" className="mt-0.5" />
                  <span>
                    <strong>Waterfall</strong> — same grade, same day, totally different lesson days in each time block
                    <span className="block text-xs text-muted-foreground mt-1">
                      e.g. Period 1 = 3A intro, Period 3 = 3B mid-unit, Period 5 = 3C wrap-up.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <RadioGroupItem value="fixed_sequence" className="mt-0.5" />
                  <span><strong>Fixed Daily Sequence</strong> — go K → 5 in order each day.</span>
                </label>
              </RadioGroup>
            </div>
          </section>


          {/* Specialist Specifics */}
          <section id="specialists" className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h2 className="font-semibold text-card-foreground">Specialist Specifics</h2>

            <div className="space-y-2 max-w-xs">
              <Label htmlFor="count">How many specialist teachers?</Label>
              <Input id="count" type="number" min={0} max={50}
                value={state.specialist_count ?? ''}
                onChange={(e) => set('specialist_count', e.target.value === '' ? null : Math.max(0, Math.min(50, Number(e.target.value))))} />
            </div>

            <PrepCheckbox
              label="Any specialists use a teaching cart?"
              placeholder="List names — e.g. Ms. Patel (Art), Mr. Lee (Music)"
              value={state.cart_users}
              onChange={(v) => set('cart_users', v)}
            />
            <PrepCheckbox
              label="Any specialists at two schools?"
              placeholder="List names and second school"
              value={state.two_school_users}
              onChange={(v) => set('two_school_users', v)}
            />
            <PrepCheckbox
              label="Any part-time specialists?"
              placeholder="List names + which days they work"
              value={state.part_time_users}
              onChange={(v) => set('part_time_users', v)}
            />
            <PrepCheckbox
              label="Any specialist with custom grade preferences?"
              placeholder="Free-text — who, and what preference"
              value={state.custom_grade_prefs}
              onChange={(v) => set('custom_grade_prefs', v)}
            />
          </section>

          {/* Calendar */}
          <section id="calendar" className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h2 className="font-semibold text-card-foreground">Calendar</h2>
            <p className="text-sm text-muted-foreground">
              Attach your district calendar (PDF or image). We'll pull holidays and special days from it during the Setup Wizard's Calendar step.
            </p>
            <CalendarAttach
              schoolId={selectedSchoolId}
              filePath={state.calendar_file_path}
              fileName={state.calendar_file_name}
              onChange={(path, name) => {
                setState(prev => ({ ...prev, calendar_file_path: path, calendar_file_name: name }));
              }}
            />
          </section>


          {/* Special Rotations */}
          <section id="rotations" className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h2 className="font-semibold text-card-foreground">Special Rotations (PLUS)</h2>

            <div className="space-y-2">
              <Label>Is there a special additional rotation beyond the normal routine?</Label>
              <RadioGroup
                value={state.has_special_rotation == null ? '' : state.has_special_rotation ? 'yes' : 'no'}
                onValueChange={(v) => set('has_special_rotation', v === 'yes')}
                className="flex gap-6"
              >
                <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="yes" /> Yes</label>
                <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="no" /> No</label>
              </RadioGroup>
            </div>

            {state.has_special_rotation && (
              <div className="space-y-4 border-t border-border pt-4">
                <div className="space-y-2">
                  <Label>How should we handle PLUS?</Label>
                  <RadioGroup
                    value={state.plus_mode}
                    onValueChange={(v) => set('plus_mode', v)}
                    className="gap-3"
                  >
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <RadioGroupItem value="admin" className="mt-0.5" />
                      <span>
                        <strong>I'll specify the day(s)</strong> — pick the day, time block, and grades. Use this when the admin already knows why PLUS lands where it does.
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <RadioGroupItem value="ai_auto_fit" className="mt-0.5" />
                      <span>
                        <strong>Let AI fit it in</strong> — no extra day. We'll absorb PLUS into the regular weekly rotation. If it can't fit, we'll warn you before generating.
                      </span>
                    </label>
                  </RadioGroup>
                </div>

                {state.plus_mode === 'admin' && (
                  <>
                    <div className="space-y-2">
                      <Label>PLUS day(s)</Label>
                      <div className="flex flex-wrap gap-3">
                        {DAYS.map(d => (
                          <label key={d} className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={state.plus_days.includes(d)}
                              onCheckedChange={() => setState(prev => ({
                                ...prev,
                                plus_days: prev.plus_days.includes(d)
                                  ? prev.plus_days.filter(x => x !== d)
                                  : [...prev.plus_days, d],
                              }))}
                            />
                            {d}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="rot-notes">Time block & grades involved</Label>
                      <Textarea id="rot-notes" rows={3} placeholder="e.g. 2:00–2:45, Grades 3–5"
                        value={state.special_rotation_notes} onChange={(e) => set('special_rotation_notes', e.target.value)} />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="rot-why">Why this day? <span className="text-muted-foreground font-normal">(optional)</span></Label>
                      <Textarea id="rot-why" rows={2} placeholder="e.g. PE coach only available Tuesdays; assembly day for upper grades."
                        value={state.plus_rationale} onChange={(e) => set('plus_rationale', e.target.value)} />
                    </div>
                  </>
                )}

                {state.plus_mode === 'ai_auto_fit' && (
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    Heads up: you can skip the PLUS Rotation Matrix in the Setup Wizard. We'll try to land PLUS inside the regular grid; you'll see a warning at generation time if it can't fit.
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

const PrepCheckbox = ({ label, placeholder, value, onChange }: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) => {
  const checked = value.length > 0;
  const [open, setOpen] = useState(checked);
  useEffect(() => { if (checked) setOpen(true); }, [checked]);

  return (
    <div className="space-y-2 border-t border-border pt-3 first:border-0 first:pt-0">
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <Checkbox
          checked={open}
          onCheckedChange={(c) => {
            const next = !!c;
            setOpen(next);
            if (!next) onChange('');
          }}
        />
        <span className="font-medium">{label}</span>
      </label>
      {open && (
        <Textarea rows={2} placeholder={placeholder}
          value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
};

const CalendarAttach = ({ schoolId, filePath, fileName, onChange }: {
  schoolId: string | null;
  filePath: string;
  fileName: string;
  onChange: (path: string, name: string) => void;
}) => {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    if (!schoolId) {
      toast.error('Pick a school first.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('File too large. Max 20 MB.');
      return;
    }
    setUploading(true);
    try {
      const path = `${schoolId}/prep_${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from('calendar-uploads').upload(path, file);
      if (error) throw error;
      onChange(path, file.name);
      toast.success('Calendar attached');
    } catch (e) {
      console.error('[CalendarAttach]', e);
      toast.error("Couldn't upload — try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRemove = async () => {
    if (filePath) {
      await supabase.storage.from('calendar-uploads').remove([filePath]).catch(() => {});
    }
    onChange('', '');
  };

  if (filePath) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
        <FileText className="h-4 w-4 text-primary shrink-0" />
        <span className="truncate flex-1" title={fileName}>{fileName || 'Calendar attached'}</span>
        <Button variant="ghost" size="sm" onClick={handleRemove}>Remove</Button>
      </div>
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
      <Button
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={uploading || !schoolId}
      >
        <Download className="h-4 w-4 mr-2 rotate-180" />
        {uploading ? 'Uploading…' : 'Attach calendar'}
      </Button>
      {!schoolId && (
        <p className="text-xs text-muted-foreground mt-2">Pick a school above to enable upload.</p>
      )}
    </div>
  );
};

export default CoordinatorPrep;
