import { useState, useRef, useEffect, useCallback } from 'react';
import { SaveStatusIndicator, type SaveStatus } from '@/components/setup/SaveStatusIndicator';
import { SETUP_STEPS } from '../stepIndex';
import { useFlushOnUnmount } from '@/hooks/useFlushOnUnmount';
import { useSetup } from '@/contexts/SetupContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field-label';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Upload, Download, Palette, Monitor, Dumbbell, FlaskConical, BookOpen, Sprout, Cog, Music, MoreHorizontal, Loader2, Check, ChevronDown, ChevronUp, HelpCircle, Sparkles } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { aiErrorToast } from '@/lib/aiError';
import { supabase } from '@/integrations/supabase/client';
import { downloadTemplate } from '@/lib/templateDownload';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import PlusRotationMatrix, { emptyPlusRotation, migrateLegacyGradeRotation, normalizePlusRotation, type PlusRotation } from './PlusRotationMatrix';
import { TEACHER_TYPES } from '@/lib/teacherTerminology';

export type AdditionalMinuteKind = 'setup' | 'travel' | 'other';
export interface AdditionalMinute {
  label: string;
  minutes: number;
  kind: AdditionalMinuteKind;
}
const MAX_ADDITIONAL_ROWS = 10;

// Forgiving parser for the working_days column.
// Returns canonical [Mon,Tue,Wed,Thu,Fri] order or null if any token is unrecognized.
function parseWorkingDays(raw: string): { days: string[] | null; reason?: string; defaulted?: boolean } {
  const ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const cleaned = (raw ?? '').replace(/^["'\s]+|["'\s]+$/g, '').trim();
  if (!cleaned) return { days: [...ORDER], defaulted: true };
  const lower = cleaned.toLowerCase();
  const ALL = new Set(['all', 'daily', 'weekdays', 'everyday', 'every day', 'm-f', 'mon-fri', 'monday-friday']);
  if (ALL.has(lower)) return { days: [...ORDER] };

  const NAME_MAP: Record<string, string> = {
    monday: 'Mon', mon: 'Mon', mo: 'Mon', m: 'Mon',
    tuesday: 'Tue', tues: 'Tue', tue: 'Tue', tu: 'Tue', t: 'Tue',
    wednesday: 'Wed', weds: 'Wed', wed: 'Wed', we: 'Wed', w: 'Wed',
    thursday: 'Thu', thurs: 'Thu', thur: 'Thu', thu: 'Thu', th: 'Thu', r: 'Thu',
    friday: 'Fri', fri: 'Fri', fr: 'Fri', f: 'Fri',
  };

  // Range form e.g. "mon-thu" / "t-f"
  const rangeMatch = lower.match(/^([a-z]+)\s*[-–—]\s*([a-z]+)$/);
  if (rangeMatch) {
    const start = NAME_MAP[rangeMatch[1]];
    const end = NAME_MAP[rangeMatch[2]];
    if (start && end) {
      const i = ORDER.indexOf(start);
      const j = ORDER.indexOf(end);
      if (i >= 0 && j >= 0 && i <= j) return { days: ORDER.slice(i, j + 1) };
    }
    return { days: null, reason: `Unrecognized range: "${cleaned}"` };
  }

  // Split on common separators
  let tokens = lower.split(/[\s,;|/]+/).filter(Boolean);

  // If single compact token like "MWF" or "MTWRF" — split into single chars
  if (tokens.length === 1 && /^[a-z]{2,7}$/.test(tokens[0]) && !NAME_MAP[tokens[0]]) {
    const compact = tokens[0];
    const charTokens = compact.split('');
    if (charTokens.every(c => NAME_MAP[c])) {
      tokens = charTokens;
    }
  }

  const out: string[] = [];
  for (const t of tokens) {
    const mapped = NAME_MAP[t];
    if (!mapped) return { days: null, reason: `Unrecognized day: "${t}" in "${cleaned}"` };
    if (!out.includes(mapped)) out.push(mapped);
  }
  if (out.length === 0) return { days: null, reason: `Could not parse: "${cleaned}"` };
  out.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return { days: out };
}

interface GradeRotationEntry {
  grades: string[];
  period: 'AM' | 'PM';
}

interface Specialist {
  id: string;
  name: string;
  phone: string;
  email: string;
  subject: string;
  workingDays: string[];
  planningMinutes: number;
  weeklyPlanningMinutes: number;
  planningType: string;
  lunchMinutes: number;
  extraMinutes: number;
  notes: string;
  twoSchools: boolean;
  secondSchoolName: string;
  usesCart: boolean;
  isPartTime: boolean;
  partTimePlanningMinutes: number;
  partTimeLunchMinutes: number;
  location: string;
  secondLocation: string;
  gradeRotation: Record<string, GradeRotationEntry>;
  plusRotation: PlusRotation;
  threeSchools: boolean;
  thirdSchoolName: string;
  thirdLocation: string;
  daysAtSecondSchool: string[];
  daysAtThirdSchool: string[];
  classDuration?: number | null;
  additionalMinutes: AdditionalMinute[];
}

const LOCATION_TYPES = ['Room', 'Library', 'Playground', 'Gym', 'Lab', 'Outdoor', 'Multiple', 'Other'] as const;
type LocationType = typeof LOCATION_TYPES[number];
const TYPES_NEEDING_VALUE = new Set<LocationType>(['Room', 'Lab', 'Other']);

function parseLocation(raw: string): { type: LocationType; value: string } {
  const str = (raw || '').trim();
  if (!str) return { type: 'Room', value: '' };
  const roomMatch = str.match(/^Room\s+(.+)$/i);
  if (roomMatch) return { type: 'Room', value: roomMatch[1].trim() };
  const labMatch = str.match(/^Lab\s+(.+)$/i);
  if (labMatch) return { type: 'Lab', value: labMatch[1].trim() };
  const exact = LOCATION_TYPES.find(t => t.toLowerCase() === str.toLowerCase());
  if (exact) return { type: exact, value: '' };
  return { type: 'Other', value: str };
}

function formatLocation(type: LocationType, value: string): string {
  const v = (value || '').trim();
  if (type === 'Room') return v ? `Room ${v}` : 'Room';
  if (type === 'Lab') return v ? `Lab ${v}` : 'Lab';
  if (type === 'Other') return v;
  return type;
}

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const subjects = ['Art', 'Music', 'PE', 'Library', 'Technology', 'Science Lab', 'Garden', 'STEAM', 'Other'];

const quickAddSubjects = [
  { label: 'Art', icon: Palette, color: 'bg-purple/10 text-purple border-purple/20', borderColor: 'border-l-purple', iconBg: 'bg-purple/10', iconText: 'text-purple' },
  { label: 'Technology', icon: Monitor, color: 'bg-primary/10 text-primary border-primary/20', borderColor: 'border-l-primary', iconBg: 'bg-primary/10', iconText: 'text-primary' },
  { label: 'PE', icon: Dumbbell, color: 'bg-success/10 text-success border-success/20', borderColor: 'border-l-success', iconBg: 'bg-success/10', iconText: 'text-success' },
  { label: 'Science Lab', icon: FlaskConical, color: 'bg-accent/10 text-accent border-accent/20', borderColor: 'border-l-accent', iconBg: 'bg-accent/10', iconText: 'text-accent' },
  { label: 'Library', icon: BookOpen, color: 'bg-warning/10 text-warning-foreground border-warning/20', borderColor: 'border-l-warning', iconBg: 'bg-warning/10', iconText: 'text-warning' },
  { label: 'Garden', icon: Sprout, color: 'bg-success/10 text-success border-success/20', borderColor: 'border-l-success', iconBg: 'bg-success/10', iconText: 'text-success' },
  { label: 'STEAM', icon: Cog, color: 'bg-primary/10 text-primary border-primary/20', borderColor: 'border-l-primary', iconBg: 'bg-primary/10', iconText: 'text-primary' },
  { label: 'Music', icon: Music, color: 'bg-purple/10 text-purple border-purple/20', borderColor: 'border-l-purple', iconBg: 'bg-purple/10', iconText: 'text-purple' },
  { label: 'Other', icon: MoreHorizontal, color: 'bg-muted text-muted-foreground border-border', borderColor: 'border-l-muted-foreground', iconBg: 'bg-muted', iconText: 'text-muted-foreground' },
];

const getSubjectMeta = (subject: string) =>
  quickAddSubjects.find(q => q.label === subject) || quickAddSubjects[quickAddSubjects.length - 1];

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

const defaultSpecialist = (subject = 'Art'): Specialist => ({
  id: crypto.randomUUID(), name: '', phone: '', email: '', subject,
  workingDays: [...days], planningMinutes: 45, weeklyPlanningMinutes: 225, planningType: 'during_rotations',
  lunchMinutes: 30, extraMinutes: 0, notes: '',
  twoSchools: false, secondSchoolName: '', usesCart: false,
  isPartTime: false, partTimePlanningMinutes: 30, partTimeLunchMinutes: 20,
  location: '', secondLocation: '',
  gradeRotation: {},
  plusRotation: emptyPlusRotation(),
  threeSchools: false, thirdSchoolName: '', thirdLocation: '',
  daysAtSecondSchool: [], daysAtThirdSchool: [],
  classDuration: null,
  additionalMinutes: [],
});

const StepSpecialists = () => {
  const { setStep, schoolId, data, prefilledSpecialists, setPrefilledSpecialists } = useSetup();
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [expandedRotation, setExpandedRotation] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const [parseErrorOpen, setParseErrorOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<{
    importedCount: number;
    blankDayCount: number;
    errors: { row: number; name: string; raw: string; reason: string }[];
  } | null>(null);
  const isLoaded = useRef(false);
  const [plusAutoFit, setPlusAutoFit] = useState<boolean>(false);

  const gradesServed = data.gradesServed || [];

  // Read schools.plus_auto_fit so we can hide the per-specialist PLUS matrix
  // when the coordinator chose "Let AI fit it in" on the prep sheet.
  useEffect(() => {
    if (!schoolId) return;
    (async () => {
      const { data: school } = await supabase
        .from('schools')
        .select('plus_auto_fit')
        .eq('id', schoolId)
        .maybeSingle();
      if (school) setPlusAutoFit(Boolean((school as any).plus_auto_fit));
    })();
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    const load = async () => {
      const { data: dbData } = await supabase
        .from('specialists')
        .select('*')
        .eq('school_id', schoolId);
      if (dbData && dbData.length > 0) {
        setSpecialists(dbData.map((s: any) => ({
          id: s.id,
          name: s.name,
          phone: (s as any).phone || '',
          email: (s as any).email || '',
          subject: s.subject,
          workingDays: s.working_days || [...days],
          planningMinutes: s.planning_minutes ?? 45,
          weeklyPlanningMinutes: s.weekly_planning_minutes ?? ((s.planning_minutes ?? 45) * (s.working_days || days).length),
          planningType: (s.planning_type === 'within_school' ? 'during_rotations' : (s.planning_type || 'during_rotations')),
          lunchMinutes: s.lunch_minutes ?? 30,
          extraMinutes: s.extra_minutes ?? 0,
          notes: s.notes || '',
          twoSchools: s.two_schools || false,
          secondSchoolName: s.second_school_name || '',
          usesCart: s.uses_cart || false,
          isPartTime: s.is_part_time || false,
          partTimePlanningMinutes: s.part_time_planning_minutes ?? 30,
          partTimeLunchMinutes: s.part_time_lunch_minutes ?? 20,
          location: s.location || '',
          secondLocation: s.second_location || '',
          gradeRotation: s.grade_rotation || {},
          plusRotation: s.plus_rotation && Object.keys(s.plus_rotation).length > 0
            ? normalizePlusRotation(s.plus_rotation)
            : migrateLegacyGradeRotation(s.grade_rotation),
          threeSchools: s.three_schools || false,
          thirdSchoolName: s.third_school_name || '',
          thirdLocation: s.third_location || '',
          daysAtSecondSchool: s.days_at_second_school || [],
          daysAtThirdSchool: s.days_at_third_school || [],
          classDuration: (s as any).class_duration ?? null,
          additionalMinutes: Array.isArray((s as any).additional_minutes) ? (s as any).additional_minutes : [],
        })));
      } else if (prefilledSpecialists.length > 0) {
        setSpecialists(prefilledSpecialists.map(s => ({
          ...defaultSpecialist(s.subject),
          name: s.name,
          workingDays: s.days,
          ...(s.planningMinutes != null ? { planningMinutes: s.planningMinutes } : {}),
          ...(s.lunchMinutes != null ? { lunchMinutes: s.lunchMinutes } : {}),
          ...(s.location ? { location: s.location } : {}),
          usesCart: s.usesCart || false,
          twoSchools: s.twoSchools || false,
          ...(s.secondSchoolName ? { secondSchoolName: s.secondSchoolName } : {}),
          ...(s.secondLocation ? { secondLocation: s.secondLocation } : {}),
        })));
        setPrefilledSpecialists([]);
      }
      isLoaded.current = true;
    };
    load();
  }, [schoolId]);

  // Per-card save architecture: each specialist card has its own debounced
  // upsert timer. Deletions ONLY happen via the explicit `remove()` handler.
  // This eliminates the "one save's stale items array deletes other rows"
  // race that dropped freshly-added specialists on Continue.
  const cardTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const inFlightSaves = useRef<Set<Promise<void>>>(new Set());

  const latestRef = useRef(specialists);
  latestRef.current = specialists;

  const buildRow = useCallback((s: Specialist) => ({
    id: s.id,
    school_id: schoolId,
    name: s.name.trim() ? s.name : '(Unnamed specialist)',
    phone: s.phone || null,
    email: s.email || null,
    subject: s.subject,
    working_days: s.workingDays,
    planning_minutes: s.planningMinutes,
    weekly_planning_minutes: s.weeklyPlanningMinutes,
    planning_type: s.planningType,
    lunch_minutes: s.lunchMinutes,
    extra_minutes: s.extraMinutes,
    notes: s.notes || null,
    two_schools: s.twoSchools,
    second_school_name: s.secondSchoolName || null,
    uses_cart: s.usesCart,
    is_part_time: s.isPartTime,
    part_time_planning_minutes: s.partTimePlanningMinutes,
    part_time_lunch_minutes: s.partTimeLunchMinutes,
    location: s.location || null,
    second_location: s.secondLocation || null,
    grade_rotation: Object.keys(s.gradeRotation).length > 0 ? s.gradeRotation : null,
    plus_rotation: s.plusRotation,
    three_schools: s.threeSchools,
    third_school_name: s.thirdSchoolName || null,
    third_location: s.thirdLocation || null,
    days_at_second_school: s.daysAtSecondSchool,
    days_at_third_school: s.daysAtThirdSchool,
    class_duration: s.classDuration ?? null,
    additional_minutes: s.additionalMinutes ?? [],
  } as any), [schoolId]);

  // Upsert a set of rows in a single request. Used by both per-card debounced
  // saves and bulk import. Never deletes.
  const persistRows = useCallback(async (rows: any[]) => {
    if (!schoolId || rows.length === 0) return;
    setSaveStatus('saving');
    const promise = (async () => {
      try {
        const { error } = await supabase.from('specialists').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (err: any) {
        console.error('Save specialists error:', err);
        toast.error(`Couldn't save specialists${err?.message ? ` — ${err.message}` : ''}. Check your connection and try again.`);
        setSaveStatus('idle');
      }
    })();
    inFlightSaves.current.add(promise);
    try { await promise; } finally { inFlightSaves.current.delete(promise); }
  }, [schoolId]);

  // Save one card immediately (used by addSpecialist and flush).
  const saveCard = useCallback(async (id: string) => {
    const spec = latestRef.current.find(s => s.id === id);
    if (!spec) return;
    // Cancel any pending debounce for this card — we're saving now.
    const t = cardTimers.current.get(id);
    if (t) { clearTimeout(t); cardTimers.current.delete(id); }
    await persistRows([buildRow(spec)]);
  }, [buildRow, persistRows]);

  // Schedule a debounced per-card save.
  const scheduleCardSave = useCallback((id: string) => {
    if (!isLoaded.current) return;
    const existing = cardTimers.current.get(id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      cardTimers.current.delete(id);
      const spec = latestRef.current.find(s => s.id === id);
      if (spec) persistRows([buildRow(spec)]);
    }, 800);
    cardTimers.current.set(id, t);
  }, [buildRow, persistRows]);

  // On any edit, re-schedule saves for every card that currently has a
  // pending timer (their content may have changed) plus the card whose id
  // is in the latest state but not yet timed. Simpler: whenever specialists
  // changes, walk the array and schedule a save for each currently-dirty
  // card. To keep this cheap we only re-schedule cards whose serialized
  // payload differs from what we last saw.
  const lastSerialized = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!isLoaded.current) return;
    const seen = new Set<string>();
    for (const s of specialists) {
      seen.add(s.id);
      const key = JSON.stringify(buildRow(s));
      if (lastSerialized.current.get(s.id) !== key) {
        lastSerialized.current.set(s.id, key);
        scheduleCardSave(s.id);
      }
    }
    // Drop entries for cards that no longer exist (they were deleted via
    // remove(), which also fired the DB delete).
    for (const id of Array.from(lastSerialized.current.keys())) {
      if (!seen.has(id)) {
        lastSerialized.current.delete(id);
        const t = cardTimers.current.get(id);
        if (t) { clearTimeout(t); cardTimers.current.delete(id); }
      }
    }
  }, [specialists, buildRow, scheduleCardSave]);

  // Flush on unmount: fire every pending debounced card save immediately.
  // In-flight promises are tracked on inFlightSaves and keep running to
  // completion even after the component is torn down.
  useEffect(() => {
    return () => {
      if (!isLoaded.current) return;
      const pendingIds = Array.from(cardTimers.current.keys());
      for (const id of pendingIds) {
        const t = cardTimers.current.get(id);
        if (t) clearTimeout(t);
        cardTimers.current.delete(id);
        const spec = latestRef.current.find(s => s.id === id);
        if (spec) persistRows([buildRow(spec)]);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addSpecialist = (subject = 'Art') => {
    const base = defaultSpecialist(subject);
    const seedSetup = Number(data.setupTime) > 0;
    if (seedSetup) {
      base.additionalMinutes = [{ label: 'Setup', minutes: Number(data.setupTime) || 5, kind: 'setup' }];
    }
    // Persist the new card to the DB immediately — do NOT rely on the
    // debounced autosave to insert it. This is what makes rapid Quick-Add
    // clicks reliable.
    setSpecialists(prev => [...prev, base]);
    if (isLoaded.current && schoolId) {
      // Fire-and-forget single-row upsert. Record it in lastSerialized so the
      // scheduling effect doesn't immediately re-fire.
      const row = buildRow(base);
      lastSerialized.current.set(base.id, JSON.stringify(row));
      persistRows([row]);
    }
  };

  const updateAdditionalRow = (specId: string, idx: number, patch: Partial<AdditionalMinute>) => {
    setSpecialists(prev => prev.map(s => {
      if (s.id !== specId) return s;
      const rows = [...s.additionalMinutes];
      const cur = rows[idx];
      if (!cur) return s;
      rows[idx] = {
        ...cur,
        ...patch,
        minutes: patch.minutes != null ? Math.max(0, Math.floor(Number(patch.minutes) || 0)) : cur.minutes,
      };
      return { ...s, additionalMinutes: rows };
    }));
  };

  const addAdditionalRow = (specId: string) => {
    setSpecialists(prev => prev.map(s => {
      if (s.id !== specId) return s;
      if (s.additionalMinutes.length >= MAX_ADDITIONAL_ROWS) return s;
      return { ...s, additionalMinutes: [...s.additionalMinutes, { label: '', minutes: 0, kind: 'other' as const }] };
    }));
  };

  const removeAdditionalRow = (specId: string, idx: number) => {
    setSpecialists(prev => prev.map(s => {
      if (s.id !== specId) return s;
      return { ...s, additionalMinutes: s.additionalMinutes.filter((_, i) => i !== idx) };
    }));
  };

  const update = (id: string, field: string, value: any) => {
    setSpecialists(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const remove = (id: string) => {
    // Cancel any pending debounced save for this card before we delete.
    const t = cardTimers.current.get(id);
    if (t) { clearTimeout(t); cardTimers.current.delete(id); }
    lastSerialized.current.delete(id);
    setSpecialists(prev => prev.filter(s => s.id !== id));
    if (isLoaded.current && schoolId) {
      // Explicit delete — the ONLY code path that removes from the DB.
      supabase.from('specialists').delete().eq('id', id).then(({ error }) => {
        if (error) {
          console.error('Delete specialist error:', error);
          toast.error(`Couldn't delete specialist — ${error.message}`);
        }
      });
    }
  };

  const toggleDay = (id: string, day: string) => {
    const spec = specialists.find(s => s.id === id);
    if (!spec) return;
    const wd = spec.workingDays.includes(day)
      ? spec.workingDays.filter(d => d !== day)
      : [...spec.workingDays, day];
    setSpecialists(prev => prev.map(s => s.id === id ? {
      ...s,
      workingDays: wd,
      weeklyPlanningMinutes: s.planningMinutes * wd.length,
      // Prune secondary/third assignments to remain a subset of workingDays
      daysAtSecondSchool: s.daysAtSecondSchool.filter(d => wd.includes(d)),
      daysAtThirdSchool: s.daysAtThirdSchool.filter(d => wd.includes(d)),
    } : s));
  };

  const toggleSiteDay = (id: string, site: 'second' | 'third', day: string) => {
    setSpecialists(prev => prev.map(s => {
      if (s.id !== id) return s;
      const key = site === 'second' ? 'daysAtSecondSchool' : 'daysAtThirdSchool';
      const current = s[key];
      const next = current.includes(day) ? current.filter(d => d !== day) : [...current, day];
      return { ...s, [key]: next };
    }));
  };

  const toggleRotationGrade = (specId: string, day: string, grade: string) => {
    const spec = specialists.find(s => s.id === specId);
    if (!spec) return;
    const rotation = { ...spec.gradeRotation };
    const entry = rotation[day] || { grades: [], period: 'AM' as const };
    const grades = entry.grades.includes(grade)
      ? entry.grades.filter(g => g !== grade)
      : [...entry.grades, grade];
    rotation[day] = { ...entry, grades };
    update(specId, 'gradeRotation', rotation);
  };

  const setRotationPeriod = (specId: string, day: string, period: 'AM' | 'PM') => {
    const spec = specialists.find(s => s.id === specId);
    if (!spec) return;
    const rotation = { ...spec.gradeRotation };
    const entry = rotation[day] || { grades: [], period: 'AM' as const };
    rotation[day] = { ...entry, period };
    update(specId, 'gradeRotation', rotation);
  };

  const toggleRotationExpanded = (id: string) => {
    setExpandedRotation(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const [aiParsing, setAiParsing] = useState(false);

  // Build header-detected rows from a 2D grid (CSV or XLSX). Returns
  // { imported, errors, blankDayCount, headerFound }. headerFound=false means
  // we couldn't locate a header row with a "name"/"subject" column, in which
  // case the caller should fall back to AI extraction.
  const buildSpecialistsFromGrid = (rows: string[][]) => {
    const errors: { row: number; name: string; raw: string; reason: string }[] = [];
    const imported: Specialist[] = [];
    let blankDayCount = 0;

    // Find the header row: first row containing a "name" cell AND a "subject" cell.
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const lower = rows[i].map(c => (c || '').toString().toLowerCase());
      if (lower.some(c => c.includes('name')) && lower.some(c => c.includes('subject'))) {
        headerIdx = i; break;
      }
    }
    if (headerIdx === -1) return { imported, errors, blankDayCount, headerFound: false };

    const header = rows[headerIdx].map(h => (h || '').toString().toLowerCase().replace(/\s+/g, ' ').trim());
    const findIdx = (...keys: string[]) => header.findIndex(h => keys.some(k => h.includes(k)));

    const nameIdx = findIdx('name');
    const phoneIdx = findIdx('phone');
    const emailIdx = findIdx('email');
    const subjectIdx = findIdx('subject');
    const locationIdx = header.findIndex(h => h === 'location' || h.includes('room') || h.startsWith('location'));
    const daysIdx = findIdx('working day', 'days_working', 'working_days', 'days at school', 'working');
    const twoSchoolsIdx = findIdx('two school', 'two_school', 'second site');
    const secondSchoolIdx = findIdx('second site name', 'second_school_name', 'second school');
    // Legacy CSV fields
    const planIdx = findIdx('planning');
    const lunchIdx = findIdx('lunch');
    const cartIdx = findIdx('cart');
    const secondLocIdx = findIdx('second_location', 'second loc');
    const partTimeIdx = findIdx('part_time', 'part time');
    const ptPlanIdx = findIdx('part_time_planning', 'pt_planning', 'pt planning');
    const ptLunchIdx = findIdx('part_time_lunch', 'pt_lunch', 'pt lunch');

    const yesValues = ['yes', 'true', '1', 'y', 'checked', '✓'];

    rows.slice(headerIdx + 1).forEach((row, idx) => {
      const rowNum = idx + headerIdx + 2;
      const cell = (i: number) => (i >= 0 ? (row[i] ?? '').toString().trim() : '');
      const name = cell(nameIdx);
      const subject = cell(subjectIdx);
      const location = cell(locationIdx);
      // Skip footer/decorative rows: drop rows with no name AND no subject AND no location.
      if (!name && !subject && !location) return;

      const raw = cell(daysIdx);
      const parsed = parseWorkingDays(raw);
      if (!parsed.days) {
        errors.push({
          row: rowNum,
          name: name || '(no name)',
          raw,
          reason: parsed.reason || 'Expected: Mon,Tue,Wed,Thu,Fri (or Mon-Fri, MWF, All, blank)',
        });
        return;
      }
      if (parsed.defaulted) blankDayCount++;

      // Normalize subject to known list when possible.
      const normalizedSubject = (() => {
        const s = subject.toLowerCase();
        if (!s) return 'Other';
        const match = subjects.find(opt => opt.toLowerCase() === s);
        if (match) return match;
        if (s.includes('phys') || s === 'pe' || s.includes('gym')) return 'PE';
        if (s.includes('comput') || s.includes('tech')) return 'Technology';
        if (s.includes('library') || s.includes('media')) return 'Library';
        if (s.includes('music')) return 'Music';
        if (s.includes('art')) return 'Art';
        if (s.includes('garden')) return 'Garden';
        if (s.includes('steam') || s.includes('stem')) return 'STEAM';
        if (s.includes('science') || s.includes('lab')) return 'Science Lab';
        return subject; // keep raw if unrecognized
      })();

      imported.push({
        ...defaultSpecialist(),
        name,
        phone: cell(phoneIdx),
        email: cell(emailIdx),
        subject: normalizedSubject,
        workingDays: parsed.days,
        planningMinutes: planIdx >= 0 ? Number(cell(planIdx)) || 45 : 45,
        lunchMinutes: lunchIdx >= 0 ? Number(cell(lunchIdx)) || 30 : 30,
        location,
        usesCart: cartIdx >= 0 ? yesValues.includes(cell(cartIdx).toLowerCase()) : false,
        twoSchools: twoSchoolsIdx >= 0 ? yesValues.includes(cell(twoSchoolsIdx).toLowerCase()) : false,
        secondSchoolName: cell(secondSchoolIdx),
        secondLocation: cell(secondLocIdx),
        isPartTime: partTimeIdx >= 0 ? yesValues.includes(cell(partTimeIdx).toLowerCase()) : false,
        partTimePlanningMinutes: ptPlanIdx >= 0 ? Number(cell(ptPlanIdx)) || 30 : 30,
        partTimeLunchMinutes: ptLunchIdx >= 0 ? Number(cell(ptLunchIdx)) || 20 : 20,
      });
    });

    return { imported, errors, blankDayCount, headerFound: true };
  };

  const runAiFallback = async (rows: string[][]) => {
    setAiParsing(true);
    try {
      const { data, error } = await supabase.functions.invoke('parse-specialist-template', { body: { rows } });
      if (error) throw error;
      const aiSpecs: any[] = data?.specialists || [];
      if (aiSpecs.length === 0) {
        toast.error("AI couldn't find any specialists in that file.");
        return;
      }
      const imported: Specialist[] = aiSpecs.map(s => ({
        ...defaultSpecialist(),
        name: s.name || '',
        phone: s.phone || '',
        email: s.email || '',
        subject: s.subject || 'Other',
        location: s.location || '',
        workingDays: Array.isArray(s.working_days) && s.working_days.length > 0 ? s.working_days : [...days],
        twoSchools: Boolean(s.two_schools),
        secondSchoolName: s.second_school_name || '',
      }));
      setSpecialists(prev => [...prev, ...imported]);
      if (isLoaded.current && schoolId) {
        const rows = imported.map(buildRow);
        rows.forEach((r, i) => lastSerialized.current.set(imported[i].id, JSON.stringify(r)));
        persistRows(rows);
      }
      toast.success(`AI auto-filled ${imported.length} specialist${imported.length === 1 ? '' : 's'} from your template.`);
    } catch (err: any) {
      console.error('AI parse error', err);
      aiErrorToast(err, { retry: () => runAiFallback(rows), title: "Couldn't read that template" });
    } finally {
      setAiParsing(false);
    }
  };

  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;

    const ext = f.name.toLowerCase().split('.').pop();
    if (!['csv', 'xlsx', 'xls'].includes(ext || '')) {
      toast.error('Upload a .xlsx, .xls, or .csv file.');
      return;
    }
    if (f.size > 5_242_880) {
      toast.error('File too large. Max 5 MB.');
      return;
    }

    try {
      let rows: string[][];
      if (ext === 'csv') {
        const text = await f.text();
        rows = parseCSV(text);
      } else {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', blankrows: false }) as any;
      }
      if (rows.length < 2) { setParseErrorOpen(true); return; }

      const { imported, errors, blankDayCount, headerFound } = buildSpecialistsFromGrid(rows);

      if (!headerFound || (imported.length === 0 && errors.length === 0)) {
        await runAiFallback(rows);
        return;
      }

      if (imported.length > 0) setSpecialists(prev => [...prev, ...imported]);
      setImportSummary({ importedCount: imported.length, blankDayCount, errors });

      // If most rows failed, also try AI as a recovery path.
      if (imported.length === 0 && errors.length > 0) {
        await runAiFallback(rows);
      }
    } catch (err) {
      console.error('Template parse error', err);
      setParseErrorOpen(true);
    }
  };


  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-5">
      {/* Save status */}
      <div className="flex items-center justify-between">
        <div />
        <SaveStatusIndicator status={saveStatus} />
      </div>

      {/* CSV Import */}
      <div className="rounded-lg border border-border bg-background p-5 space-y-3">
        <div>
          <h3 className="text-sm font-bold text-card-foreground uppercase tracking-wide">Spreadsheet Logistic Import</h3>
          <p className="text-xs text-accent mt-0.5 uppercase tracking-wide">Bulk deploy your specialist roster. Use our tactical template for fastest results.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5 border-accent text-accent hover:bg-accent/10" onClick={() => downloadTemplate('specialists', '/templates/specialists_template.xlsx')}>
            <Download className="h-3.5 w-3.5" /> Download Template
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()} disabled={aiParsing}>
            {aiParsing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {aiParsing ? 'AI is reading…' : 'Upload Filled Template'}
          </Button>
          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-accent" /> Accepts .xlsx or .csv — AI auto-fills the rest.
          </span>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleTemplateUpload} />
        </div>
      </div>


      {/* Quick Add */}
      <div className="rounded-lg border border-border bg-background p-5 space-y-3">
        <div>
          <h3 className="text-sm font-bold text-card-foreground uppercase tracking-wide">Manual Precision Entry</h3>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Quickly add specialists by role. Configure details in the cards below.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {quickAddSubjects.map(({ label, icon: Icon, color }) => (
            <button key={label} onClick={() => addSpecialist(label)} className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 w-16 transition-all hover:shadow-md ${color}`}>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-background/60">
                <Icon className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-medium">{label === 'Science Lab' ? 'Science' : label === 'Technology' ? 'Tech' : label}</span>
            </button>
          ))}
        </div>
      </div>

      {specialists.length === 0 && (
        <div className="text-center py-6 text-sm text-muted-foreground">No specialists added yet. Use the icons above or upload a CSV.</div>
      )}

      {/* Specialist Cards */}
      {specialists.map(s => {
        const meta = getSubjectMeta(s.subject);
        const SubjectIcon = meta.icon;
        return (
        <div key={s.id} className={`rounded-lg border border-border bg-background overflow-hidden border-l-4 ${meta.borderColor}`}>
          {/* Card Header: Icon + Name + Subject + Delete */}
          <div className="flex items-center gap-3 p-4 pb-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${meta.iconBg}`}>
              <SubjectIcon className={`h-5 w-5 ${meta.iconText}`} />
            </div>
            <div className="flex-1 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <FieldLabel className="text-xs" tooltip="Specialist teacher's full name">Name</FieldLabel>
                <Input className="h-8 text-xs" value={s.name} onChange={(e) => update(s.id, 'name', e.target.value)} placeholder="Teacher name" />
              </div>
              <div className="space-y-1">
                <FieldLabel className="text-xs" tooltip="Primary subject this specialist teaches">Subject</FieldLabel>
                <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={s.subject} onChange={(e) => update(s.id, 'subject', e.target.value)}>
                  {subjects.map(sub => <option key={sub} value={sub}>{sub}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <FieldLabel className="text-xs" tooltip="Optional. Used for contact only.">Phone</FieldLabel>
                <Input className="h-8 text-xs" value={s.phone} onChange={(e) => update(s.id, 'phone', e.target.value)} placeholder="(optional)" />
              </div>
              <div className="space-y-1">
                <FieldLabel className="text-xs" tooltip="Optional. Used for contact only.">Email</FieldLabel>
                <Input className="h-8 text-xs" type="email" value={s.email} onChange={(e) => update(s.id, 'email', e.target.value)} placeholder="(optional)" />
              </div>
            </div>
            <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setPendingDeleteId(s.id)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>

          {/* Body */}
          <div className="px-4 pb-4 space-y-3">
            {/* Planning, Lunch, Class Duration row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 items-end">
              <div className="space-y-1">
                <FieldLabel className="text-xs" tooltip="Daily planning time for this specialist between classes.">Daily Planning (min)</FieldLabel>
                <Input className="h-8 text-xs" type="number" min={0} max={180} value={s.planningMinutes} onChange={(e) => {
                  const raw = Number(e.target.value);
                  const daily = Math.max(0, Math.min(180, isNaN(raw) ? 0 : raw));
                  update(s.id, 'planningMinutes', daily);
                  update(s.id, 'weeklyPlanningMinutes', daily * s.workingDays.length);
                }} />
              </div>
              <div className="space-y-1">
                <FieldLabel className="text-xs" tooltip="Total weekly planning time — auto-calculated from daily, but editable.">Weekly Planning (min)</FieldLabel>
                <Input className="h-8 text-xs" type="number" min={0} value={s.weeklyPlanningMinutes} onChange={(e) => update(s.id, 'weeklyPlanningMinutes', Math.max(0, Number(e.target.value)))} />
              </div>
              <div className="space-y-1">
                <FieldLabel className="text-xs" tooltip="When this specialist's planning time occurs. Defaults to the school-wide setting from step 2.">Planning Time Occurs</FieldLabel>
                <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={s.planningType} onChange={(e) => update(s.id, 'planningType', e.target.value)}>
                  <option value="before_school">Before school</option>
                  <option value="during_rotations">During rotations</option>
                  <option value="after_school">After school</option>
                </select>
              </div>
              <div className="space-y-1">
                <FieldLabel className="text-xs" tooltip="Length of the duty-free lunch period for this specialist.">Lunch (min)</FieldLabel>
                <Input className="h-8 text-xs" type="number" min={0} value={s.lunchMinutes} onChange={(e) => update(s.id, 'lunchMinutes', Math.max(0, Number(e.target.value)))} />
              </div>
              <div className="space-y-1">
                <FieldLabel className="text-xs" tooltip="Length of each PLUS class. Leave blank to use the school-wide default from School Info.">Class Duration (min)</FieldLabel>
                <Input
                  className="h-8 text-xs"
                  type="number"
                  min={0}
                  max={180}
                  value={s.classDuration ?? ''}
                  placeholder={String((data as any).classDuration ?? 45)}
                  onChange={(e) => {
                    const v = e.target.value;
                    update(s.id, 'classDuration', v === '' ? null : Number(v));
                  }}
                />
              </div>
            </div>

            {/* Location + travel toggles row */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5 items-end">
              <div className="space-y-1 sm:col-span-2">
                <FieldLabel className="text-xs" tooltip="Room number, or where this specialist teaches (e.g. Library, Playground, Gym).">Room Number</FieldLabel>
                <Input
                  className="h-8 text-xs"
                  value={s.location}
                  placeholder="204"
                  onChange={(e) => update(s.id, 'location', e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3 pb-0.5 sm:col-span-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Switch checked={s.usesCart} onCheckedChange={(v) => update(s.id, 'usesCart', v)} id={`cart-${s.id}`} />
                  <FieldLabel htmlFor={`cart-${s.id}`} className="text-xs cursor-pointer" tooltip="Enable if this specialist moves between rooms with a cart (also called a Floating or Cart Teacher).">Traveling Teacher</FieldLabel>
                </div>
                <div className="flex items-center gap-1.5">
                  <Switch checked={s.twoSchools} onCheckedChange={(v) => update(s.id, 'twoSchools', v)} id={`two-${s.id}`} />
                  <FieldLabel htmlFor={`two-${s.id}`} className="text-xs cursor-pointer" tooltip={`${TEACHER_TYPES.itinerant.label}: ${TEACHER_TYPES.itinerant.description}`}>Itinerant (2 schools)</FieldLabel>
                </div>
                {s.twoSchools && (
                  <div className="flex items-center gap-1.5">
                    <Switch checked={s.threeSchools} onCheckedChange={(v) => update(s.id, 'threeSchools', v)} id={`three-${s.id}`} />
                    <FieldLabel htmlFor={`three-${s.id}`} className="text-xs cursor-pointer" tooltip={`${TEACHER_TYPES.itinerant.label} across three campuses.`}>Itinerant (3 schools)</FieldLabel>
                  </div>
                )}
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary" aria-label="Teacher type help">
                      <HelpCircle className="h-3.5 w-3.5" />
                      <span>What's this?</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 text-xs space-y-3">
                    <div className="font-semibold text-sm">Teacher Types</div>
                    {(Object.keys(TEACHER_TYPES) as Array<keyof typeof TEACHER_TYPES>).map((k) => {
                      const t = TEACHER_TYPES[k];
                      return (
                        <div key={String(k)} className="space-y-0.5">
                          <div className="font-medium text-card-foreground">{t.label}</div>
                          <div className="text-muted-foreground">{t.description}</div>
                          {t.synonyms.length > 0 && (
                            <div className="text-[10px] text-muted-foreground italic">Also called: {t.synonyms.join(', ')}</div>
                          )}
                        </div>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              </div>
            </div>


            {/* Conditional: Second school fields */}
            {s.twoSchools && (() => {
              const overlap = s.daysAtSecondSchool.filter(d => s.daysAtThirdSchool.includes(d));
              const total = s.daysAtSecondSchool.length + s.daysAtThirdSchool.length;
              const exceeds = total > s.workingDays.length;
              const primaryDays = s.workingDays.filter(d => !s.daysAtSecondSchool.includes(d) && !s.daysAtThirdSchool.includes(d));
              const primaryLabel = s.location || 'primary school';
              return (
                <div className="space-y-3 pl-4 border-l-2 border-primary/20">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <FieldLabel className="text-xs" tooltip="Name of the other campus">Second School Name</FieldLabel>
                      <Input className="h-8 text-xs" value={s.secondSchoolName} onChange={(e) => update(s.id, 'secondSchoolName', e.target.value)} placeholder="Other school name" />
                    </div>
                    <div className="space-y-1">
                      <FieldLabel className="text-xs" tooltip="Room at the other campus">Second Location</FieldLabel>
                      <Input className="h-8 text-xs" value={s.secondLocation} onChange={(e) => update(s.id, 'secondLocation', e.target.value)} placeholder="Room at other school" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <FieldLabel className="text-xs" tooltip="Which days is this specialist at the second school? Must be a subset of Days working.">Days at second school</FieldLabel>
                    <div className="flex flex-wrap gap-1.5">
                      {s.workingDays.map(d => {
                        const selected = s.daysAtSecondSchool.includes(d);
                        const conflict = selected && s.daysAtThirdSchool.includes(d);
                        return (
                          <button
                            key={d}
                            onClick={() => toggleSiteDay(s.id, 'second', d)}
                            title={conflict ? `Already assigned to ${s.thirdSchoolName || 'third school'} on this day.` : undefined}
                            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${conflict ? 'bg-destructive/20 text-destructive border border-destructive' : selected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {s.threeSchools && (
                    <>
                      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-dashed border-border">
                        <div className="space-y-1">
                          <FieldLabel className="text-xs" tooltip="Name of the third campus">Third School Name</FieldLabel>
                          <Input className="h-8 text-xs" value={s.thirdSchoolName} onChange={(e) => update(s.id, 'thirdSchoolName', e.target.value)} placeholder="Third school name" />
                        </div>
                        <div className="space-y-1">
                          <FieldLabel className="text-xs" tooltip="Room at the third campus">Third Location</FieldLabel>
                          <Input className="h-8 text-xs" value={s.thirdLocation} onChange={(e) => update(s.id, 'thirdLocation', e.target.value)} placeholder="Room at third school" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <FieldLabel className="text-xs" tooltip="Which days is this specialist at the third school? Must not overlap with second school days.">Days at third school</FieldLabel>
                        <div className="flex flex-wrap gap-1.5">
                          {s.workingDays.map(d => {
                            const selected = s.daysAtThirdSchool.includes(d);
                            const conflict = selected && s.daysAtSecondSchool.includes(d);
                            return (
                              <button
                                key={d}
                                onClick={() => toggleSiteDay(s.id, 'third', d)}
                                title={conflict ? `Already assigned to ${s.secondSchoolName || 'second school'} on this day.` : undefined}
                                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${conflict ? 'bg-destructive/20 text-destructive border border-destructive' : selected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}
                              >
                                {d}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}

                  {overlap.length > 0 && (
                    <div className="text-[11px] text-destructive bg-destructive/10 rounded px-2 py-1">
                      Day{overlap.length === 1 ? '' : 's'} {overlap.join(', ')} assigned to both second and third school. Pick one.
                    </div>
                  )}
                  {exceeds && (
                    <div className="text-[11px] text-destructive bg-destructive/10 rounded px-2 py-1">
                      You've assigned more days than this specialist works. Adjust Days working or unassign days.
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    At {primaryLabel}: {primaryDays.length > 0 ? primaryDays.join(', ') : '— (no days left for primary)'}
                  </p>
                </div>
              );
            })()}

            {/* Days on campus */}
            <div className="space-y-1.5">
              <div>
                <FieldLabel className="text-xs" tooltip="Days this specialist is on campus.">Days working</FieldLabel>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Select all days this specialist is on campus. Default: all 5 days.
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 italic">
                  Tip: Select fewer than 5 days for part-time specialists.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {days.map(d => (
                  <button key={d} onClick={() => toggleDay(s.id, d)} className={`rounded px-2 py-1 text-xs font-medium transition-colors ${s.workingDays.includes(d) ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Additional Minutes (Travel, Setup, etc.) */}
            <div className="border-t border-border pt-3">
              <Collapsible>
                <CollapsibleTrigger className="flex w-full items-center justify-between text-xs font-semibold text-card-foreground hover:text-primary [&[data-state=open]>svg]:rotate-180">
                  <span className="flex items-center gap-1.5">
                    Additional Minutes (Travel, Setup, etc.)
                    {s.additionalMinutes.length > 0 && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {s.additionalMinutes.reduce((sum, r) => sum + (r.minutes || 0), 0)} min
                      </span>
                    )}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 transition-transform" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 space-y-2">
                  {s.additionalMinutes.length === 0 && (
                    <p className="text-[11px] text-muted-foreground italic">
                      No extra minutes added. School default is {data.setupTime || 0} min setup / {data.passingTime || 0} min passing.
                    </p>
                  )}
                  {s.additionalMinutes.map((row, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        className="h-8 text-xs flex-1"
                        value={row.label}
                        placeholder="Travel to Annex"
                        onChange={(e) => updateAdditionalRow(s.id, idx, { label: e.target.value })}
                      />
                      <Input
                        type="number"
                        min={0}
                        className="h-8 text-xs w-20"
                        value={row.minutes}
                        onChange={(e) => updateAdditionalRow(s.id, idx, { minutes: Number(e.target.value) })}
                      />
                      <span className="text-[10px] text-muted-foreground">min</span>
                      <Select value={row.kind} onValueChange={(v) => updateAdditionalRow(s.id, idx, { kind: v as AdditionalMinuteKind })}>
                        <SelectTrigger className="h-8 w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="setup">Setup</SelectItem>
                          <SelectItem value="travel">Travel</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => removeAdditionalRow(s.id, idx)}
                        aria-label="Remove row"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => addAdditionalRow(s.id)}
                      disabled={s.additionalMinutes.length >= MAX_ADDITIONAL_ROWS}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add Row
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      {s.additionalMinutes.length >= MAX_ADDITIONAL_ROWS
                        ? `Max ${MAX_ADDITIONAL_ROWS} rows.`
                        : `Total: ${s.additionalMinutes.reduce((sum, r) => sum + (r.minutes || 0), 0)} min added to schedule`}
                    </span>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>

            {/* PLUS Rotation (replaces legacy Grade Rotation) */}
            <div className="border-t border-border pt-3">
              {plusAutoFit ? (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs space-y-1">
                  <div className="font-semibold text-foreground">PLUS handled automatically</div>
                  <p className="text-muted-foreground">
                    Per your Coordinator Prep setting, the scheduler will fit PLUS into the regular weekly rotation — no matrix needed here. Change this on the Coordinator Prep sheet → Special Rotations.
                  </p>
                </div>
              ) : (
                <PlusRotationMatrix
                  value={s.plusRotation}
                  workingDays={s.workingDays}
                  gradesServed={gradesServed}
                  defaultStartTime={data.rotationsStartTime || (data as any).startTime || ''}
                  defaultDuration={s.classDuration ?? (data as any).classDuration ?? 45}
                  passingTime={(data as any).passingTime ?? 5}
                  recessWindows={(() => {
                    const out: { start: string; end: string; label: string }[] = [];
                    const cfg = (data as any).n || {};
                    for (const band of Object.keys(cfg)) {
                      const c = cfg[band] || {};
                      const label = band === 'all' ? '' : ` (${band})`;
                      if (c.amRecessStart && c.amRecessEnd) out.push({ start: c.amRecessStart, end: c.amRecessEnd, label: `AM recess${label}` });
                      if (c.lunchStart && c.lunchEnd) out.push({ start: c.lunchStart, end: c.lunchEnd, label: `lunch${label}` });
                      if (c.pmRecessStart && c.pmRecessEnd) out.push({ start: c.pmRecessStart, end: c.pmRecessEnd, label: `PM recess${label}` });
                    }
                    return out;
                  })()}
                  onChange={(next) => update(s.id, 'plusRotation', next)}
                />
              )}
            </div>
          </div>
        </div>
        );
      })}

      {(() => {
        const hasSiteError = specialists.some(s => {
          if (!s.twoSchools) return false;
          const overlap = s.daysAtSecondSchool.some(d => s.daysAtThirdSchool.includes(d));
          const exceeds = (s.daysAtSecondSchool.length + s.daysAtThirdSchool.length) > s.workingDays.length;
          return overlap || exceeds;
        });
        return (
          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => setStep(SETUP_STEPS.RECESS_LUNCH)}>Back</Button>
            <div className="flex flex-col items-end gap-1">
              {hasSiteError && <span className="text-[11px] text-destructive">Resolve site-day conflicts to continue.</span>}
              <Button onClick={() => setStep(SETUP_STEPS.TEACHERS)} disabled={hasSiteError}>Continue</Button>
            </div>
          </div>
        );
      })()}

      {/* Parse-error modal (unreadable / non-template file) */}
      <AlertDialog open={parseErrorOpen} onOpenChange={setParseErrorOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>We couldn't read that file</AlertDialogTitle>
            <AlertDialogDescription>
              Make sure it's an .xlsx or .csv that matches the template. Download a fresh template?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => downloadTemplate('specialists', '/templates/specialists_template.xlsx')}
            >
              Download Template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import summary modal */}
      <AlertDialog open={!!importSummary} onOpenChange={(open) => !open && setImportSummary(null)}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Import summary</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" />
                  <span>
                    <strong>{importSummary?.importedCount ?? 0}</strong> specialist
                    {(importSummary?.importedCount ?? 0) === 1 ? '' : 's'} imported.
                  </span>
                </div>
                {!!importSummary?.blankDayCount && (
                  <div className="rounded border border-border bg-muted/40 p-2 text-xs">
                    {importSummary.blankDayCount} specialist{importSummary.blankDayCount === 1 ? '' : 's'} had blank days — defaulted to Mon–Fri.
                  </div>
                )}
                {!!importSummary?.errors.length && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-destructive">
                      {importSummary.errors.length} row{importSummary.errors.length === 1 ? '' : 's'} skipped:
                    </div>
                    <div className="max-h-60 overflow-auto rounded border border-destructive/30">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-destructive/10">
                          <tr>
                            <th className="px-2 py-1">Row</th>
                            <th className="px-2 py-1">Name</th>
                            <th className="px-2 py-1">days_working</th>
                            <th className="px-2 py-1">Expected</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importSummary.errors.map((e, i) => (
                            <tr key={i} className="border-t border-border">
                              <td className="px-2 py-1 align-top">{e.row}</td>
                              <td className="px-2 py-1 align-top">{e.name}</td>
                              <td className="px-2 py-1 align-top font-mono break-all">{e.raw || '(blank)'}</td>
                              <td className="px-2 py-1 align-top text-muted-foreground">{e.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setImportSummary(null)}>Done</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm delete specialist */}
      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this specialist?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const s = specialists.find(x => x.id === pendingDeleteId);
                const label = s?.name?.trim() || s?.subject || 'this specialist';
                return `"${label}" and all of its configuration (rotation, planning, locations) will be deleted. This cannot be undone.`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDeleteId) remove(pendingDeleteId);
                setPendingDeleteId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default StepSpecialists;
