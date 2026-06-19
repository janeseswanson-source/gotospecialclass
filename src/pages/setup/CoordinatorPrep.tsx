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
import { Download, FileText, ClipboardList, Wand2 } from 'lucide-react';
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
    { question: 'Specialist scheduling style', answer: schedulingStyleLabel(p.grade_preference) },
    { question: 'How many specialist teachers?', answer: p.specialist_count == null ? '' : String(p.specialist_count) },
    { question: 'Specialists using a teaching cart', answer: p.cart_users },
    { question: 'Specialists at two schools', answer: p.two_school_users },
    { question: 'Part-time specialists (with days)', answer: p.part_time_users },
    { question: 'Specialists with custom grade preferences', answer: p.custom_grade_prefs },
    { question: 'Are most holidays on Mondays?', answer: p.mostly_monday_holidays == null ? '' : p.mostly_monday_holidays ? 'Yes' : 'No' },
    { question: 'Other notes about holidays / waiver / PD days', answer: p.holiday_notes },
    { question: 'Special additional rotation (PLUS)?', answer: p.has_special_rotation == null ? '' : p.has_special_rotation ? 'Yes' : 'No' },
    { question: 'PLUS rotation details (days, time, grades)', answer: p.special_rotation_notes },
  ];
}

const CoordinatorPrep = () => {
  const { workspaceId, selectedSchoolId, selectedSchool } = useSchool();
  const [state, setState] = useState<PrepState>(empty);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [downloading, setDownloading] = useState(false);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const stateRef = useRef(state);
  stateRef.current = state;

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
          has_special_rotation: data.has_special_rotation,
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
        has_special_rotation: s.has_special_rotation,
        special_rotation_notes: s.special_rotation_notes || null,
      };

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
            Coordinator Prep
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Gather these answers before sitting down to the Setup Wizard. They'll prefill the wizard where they match, and you can print this as a worksheet to fill out at school.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SaveStatusIndicator status={saveStatus} />
          <Button variant="outline" onClick={handleDownloadPdf} disabled={downloading}>
            <Download className="h-4 w-4 mr-2" />
            {downloading ? 'Preparing…' : 'Download Prep PDF'}
          </Button>
          <Button asChild>
            <Link to="/app/setup">
              <Wand2 className="h-4 w-4 mr-2" />
              Open Setup Wizard
            </Link>
          </Button>
        </div>
      </div>

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

          {/* Calendar & Holidays */}
          <section id="calendar" className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h2 className="font-semibold text-card-foreground">Calendar & Holidays</h2>

            <div className="space-y-2">
              <Label>Are most holidays on Mondays?</Label>
              <RadioGroup
                value={state.mostly_monday_holidays == null ? '' : state.mostly_monday_holidays ? 'yes' : 'no'}
                onValueChange={(v) => set('mostly_monday_holidays', v === 'yes')}
                className="flex gap-6"
              >
                <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="yes" /> Yes</label>
                <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="no" /> No</label>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="hol-notes">Other notes about holidays / waiver days / PD days</Label>
              <Textarea id="hol-notes" rows={3}
                value={state.holiday_notes} onChange={(e) => set('holiday_notes', e.target.value)} />
            </div>
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
              <div className="space-y-2">
                <Label htmlFor="rot-notes">Days, time block, and grades involved</Label>
                <Textarea id="rot-notes" rows={4} placeholder="e.g. Tuesdays 2:00–2:45, Grades 3–5"
                  value={state.special_rotation_notes} onChange={(e) => set('special_rotation_notes', e.target.value)} />
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

export default CoordinatorPrep;
