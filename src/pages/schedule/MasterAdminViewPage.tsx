import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useSchool } from '@/contexts/SchoolContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Download, Printer, FileSpreadsheet } from 'lucide-react';
import logo from '@/assets/logo.png';
import { formatTime } from '@/lib/utils';
import { exportMasterAdminXlsx } from '@/lib/exportMasterAdminXlsx';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;

type Block = {
  id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  subject: string | null;
  grade: string | null;
  room: string | null;
  week_label: string | null;
  specialist_id: string | null;
  teacher_id: string | null;
};

type Specialist = { id: string; name: string; subject: string | null };
type Teacher = { id: string; name: string; grade: string | null };
type AdminRot = {
  day: string;
  startTime?: string;
  endTime?: string;
  grades?: string[];
  weekLabel?: 'A' | 'B' | null;
  rotationLabel?: string;
};

const isPlanningPrep = (s?: string | null) =>
  !!s && /planning|prep/i.test(s);
const isRecess = (s?: string | null) => !!s && /recess/i.test(s);
const isLunch = (s?: string | null) => !!s && /lunch/i.test(s);
const isDismissal = (s?: string | null) => !!s && /dismiss/i.test(s);
const isChrome = (s?: string | null) =>
  isPlanningPrep(s) || isRecess(s) || isLunch(s) || isDismissal(s);

export default function MasterAdminViewPage() {
  const { user } = useAuth();
  const { selectedSchoolId, schools, loading: schoolLoading } = useSchool();
  const [loading, setLoading] = useState(true);
  const [school, setSchool] = useState<any | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [genId, setGenId] = useState<string | null>(null);

  useEffect(() => {
    if (!user || schoolLoading || !selectedSchoolId) {
      setLoading(false);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedSchoolId, schoolLoading]);

  async function load() {
    setLoading(true);
    const [{ data: s }, { data: gen }, { data: sp }, { data: t }] =
      await Promise.all([
        supabase.from('schools').select('*').eq('id', selectedSchoolId!).maybeSingle(),
        supabase
          .from('schedule_generations')
          .select('id')
          .eq('school_id', selectedSchoolId!)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('specialists').select('id, name, subject').eq('school_id', selectedSchoolId!),
        supabase
          .from('classroom_teachers')
          .select('id, name, grade')
          .eq('school_id', selectedSchoolId!),
      ]);
    setSchool(s);
    setSpecialists((sp ?? []) as Specialist[]);
    setTeachers((t ?? []) as Teacher[]);
    if (gen?.id) {
      setGenId(gen.id);
      const { data: b } = await supabase
        .from('schedule_blocks')
        .select(
          'id, day_of_week, start_time, end_time, subject, grade, room, week_label, specialist_id, teacher_id'
        )
        .eq('generation_id', gen.id);
      setBlocks((b ?? []) as Block[]);
    } else {
      setBlocks([]);
    }
    setLoading(false);
  }

  const schoolName =
    school?.name ?? schools.find((x) => x.id === selectedSchoolId)?.name ?? '';
  const schoolYear =
    school?.school_year ?? new Date().getFullYear() + '–' + (new Date().getFullYear() + 1);
  const startTime = school?.start_time as string | undefined;
  const endTime = school?.end_time as string | undefined;
  const adminRotation = (school?.admin_rotation ?? []) as AdminRot[];

  // Build planning & prep cells per day from admin_rotation
  const planningPerDay: Record<string, AdminRot[]> = {};
  for (const day of DAYS) planningPerDay[day] = [];
  for (const ar of adminRotation) {
    const key = DAYS.find((d) => d.toLowerCase() === (ar.day || '').toLowerCase());
    if (key) planningPerDay[key].push(ar);
  }

  // Specialist rotation rows: group remaining blocks by start_time
  const rotationBlocks = blocks.filter((b) => !isChrome(b.subject));
  const slotKeys = Array.from(
    new Set(rotationBlocks.map((b) => `${b.start_time}|${b.end_time}`))
  ).sort();

  const chromeBlocks = blocks.filter((b) => isChrome(b.subject) && !isPlanningPrep(b.subject));

  // Group chrome (recess/lunch/dismissal) by their type bucket per day
  const chromeGrouped = chromeBlocks.reduce<Record<string, Block[]>>((acc, b) => {
    const key = isRecess(b.subject)
      ? 'RECESS'
      : isLunch(b.subject)
      ? 'LUNCH'
      : 'DISMISSAL';
    (acc[key] ??= []).push(b);
    return acc;
  }, {});

  const specialistName = (id: string | null) =>
    (id && specialists.find((s) => s.id === id)?.name) || '';
  const specialistSubject = (id: string | null) =>
    (id && specialists.find((s) => s.id === id)?.subject) || '';
  const teacherName = (id: string | null) =>
    (id && teachers.find((t) => t.id === id)?.name) || '';

  const blocksFor = (day: string, key: string) => {
    const [start, end] = key.split('|');
    return rotationBlocks
      .filter(
        (b) => b.day_of_week === day && b.start_time === start && b.end_time === end
      )
      .sort((a, b) => (a.grade ?? '').localeCompare(b.grade ?? ''));
  };

  const chromeFor = (day: string, kind: string) =>
    (chromeGrouped[kind] ?? []).filter((b) => b.day_of_week === day);

  async function handleXlsx() {
    if (!selectedSchoolId) return;
    try {
      await exportMasterAdminXlsx({ schoolId: selectedSchoolId, generationId: genId });
      toast.success('Master Admin XLSX downloaded');
    } catch (e: any) {
      toast.error(e?.message ?? 'Export failed');
    }
  }

  if (loading || schoolLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  if (!selectedSchoolId) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        Select a school to view the Master Admin Schedule.
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Toolbar (hidden when printing) */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Master Admin View</h1>
          <p className="text-sm text-muted-foreground">
            Weekly grid mirroring your printable Specialist Schedule Planner.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1.5" /> Print
          </Button>
          <Button size="sm" onClick={handleXlsx}>
            <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Download Master Admin XLSX
          </Button>
        </div>
      </div>

      {/* Planner card */}
      <div
        id="master-admin-print"
        className="rounded-xl border border-border bg-card text-foreground shadow-sm overflow-hidden print:rounded-none print:border-0 print:shadow-none"
      >
        {/* Branded header */}
        <div className="flex items-start justify-between gap-6 border-b-2 border-accent bg-card px-6 py-4">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Specialist Ops! logo" className="h-12 w-12 rounded-lg object-cover" />
            <div>
              <h2 className="text-2xl font-bold text-primary leading-tight">
                Specialist Schedule Planner
              </h2>
              <p className="text-[11px] tracking-wider text-muted-foreground uppercase">
                Weekly Master View · Specialist Ops!
              </p>
            </div>
          </div>
          <div className="text-xs space-y-1 min-w-[220px]">
            <div className="flex items-baseline gap-2">
              <span className="text-muted-foreground">School:</span>
              <span className="flex-1 border-b border-border text-foreground font-medium pb-0.5">
                {schoolName}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-muted-foreground">Year:</span>
              <span className="flex-1 border-b border-border text-foreground font-medium pb-0.5">
                {schoolYear}
              </span>
            </div>
          </div>
        </div>

        {/* Day header */}
        <div className="grid grid-cols-5 border-b border-border bg-secondary/60">
          {DAYS.map((d) => (
            <div
              key={d}
              className="px-3 py-2 text-center text-sm font-semibold text-primary border-r last:border-r-0 border-border"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Planning and Prep band */}
        <div className="bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary border-b border-border flex items-center gap-3">
          <span>Planning and Prep</span>
          {startTime && endTime && (
            <span className="text-muted-foreground font-normal">
              {formatTime(startTime)} – {formatTime(endTime)}
            </span>
          )}
        </div>
        <div className="grid grid-cols-5 border-b border-border min-h-[140px]">
          {DAYS.map((d) => (
            <div
              key={d}
              className="border-r last:border-r-0 border-border p-2 space-y-2 text-[11px]"
            >
              {planningPerDay[d].length === 0 ? (
                <div className="text-muted-foreground italic opacity-60">—</div>
              ) : (
                planningPerDay[d].map((ar, i) => (
                  <div key={i} className="rounded border border-border/60 bg-background/60 p-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-accent font-semibold">
                        {ar.rotationLabel || `Rotation ${i + 1}`}
                      </span>
                      {ar.weekLabel && (
                        <span className="text-[9px] font-bold uppercase rounded bg-accent/20 text-accent px-1.5 py-0.5">
                          {ar.weekLabel}
                        </span>
                      )}
                    </div>
                    {ar.startTime && ar.endTime && (
                      <div className="text-muted-foreground">
                        {formatTime(ar.startTime)} – {formatTime(ar.endTime)}
                      </div>
                    )}
                    <ul className="mt-1 space-y-0.5">
                      {specialists.slice(0, 4).map((s) => (
                        <li key={s.id} className="flex gap-1">
                          <span className="text-primary font-medium w-12 truncate">
                            {s.subject ?? ''}
                          </span>
                          <span className="text-foreground truncate">{s.name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>

        {/* Rotation slot rows */}
        {slotKeys.length === 0 ? (
          <div className="grid grid-cols-5 min-h-[120px]">
            {DAYS.map((d) => (
              <div key={d} className="border-r last:border-r-0 border-border p-3 text-[11px] text-muted-foreground italic">
                No generated rotations yet.
              </div>
            ))}
          </div>
        ) : (
          slotKeys.map((key) => {
            const [start, end] = key.split('|');
            return (
              <div key={key}>
                <div className="bg-muted/50 px-3 py-1 text-[11px] text-primary font-medium border-b border-border">
                  {formatTime(start)} – {formatTime(end)}
                </div>
                <div className="grid grid-cols-5 border-b border-border min-h-[88px]">
                  {DAYS.map((d) => {
                    const cellBlocks = blocksFor(d, key);
                    return (
                      <div
                        key={d}
                        className="border-r last:border-r-0 border-border p-2 space-y-1 text-[11px]"
                      >
                        {cellBlocks.length === 0 ? (
                          <div className="opacity-30">·</div>
                        ) : (
                          cellBlocks.map((b) => (
                            <div key={b.id} className="flex items-baseline gap-1.5">
                              {b.grade && (
                                <span className="text-accent font-semibold w-6 shrink-0">
                                  {b.grade}
                                </span>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-foreground font-medium truncate">
                                  {b.subject || specialistSubject(b.specialist_id)}
                                </div>
                                <div className="text-muted-foreground truncate">
                                  {specialistName(b.specialist_id)}
                                  {b.teacher_id ? ` · ${teacherName(b.teacher_id)}` : ''}
                                </div>
                              </div>
                              {b.week_label && (
                                <span className="text-[9px] font-bold uppercase rounded bg-accent/20 text-accent px-1 py-0.5">
                                  {b.week_label}
                                </span>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}

        {/* Chrome rows: Recess / Lunch / Dismissal */}
        {(['RECESS', 'LUNCH', 'DISMISSAL'] as const).map((kind) => {
          const anyData = DAYS.some((d) => chromeFor(d, kind).length > 0);
          if (!anyData) return null;
          return (
            <div key={kind}>
              <div className="bg-muted/70 px-3 py-1 text-[11px] font-semibold text-primary border-b border-border">
                {kind}
              </div>
              <div className="grid grid-cols-5 border-b border-border min-h-[60px]">
                {DAYS.map((d) => (
                  <div
                    key={d}
                    className="border-r last:border-r-0 border-border p-2 text-[11px] space-y-1 bg-muted/30"
                  >
                    {chromeFor(d, kind).map((b) => (
                      <div key={b.id}>
                        {b.grade && (
                          <div className="text-foreground font-medium">{b.grade} Graders</div>
                        )}
                        <div className="text-muted-foreground">
                          {formatTime(b.start_time)} – {formatTime(b.end_time)}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Footer band */}
        <div className="bg-secondary/40 border-t-2 border-accent px-6 py-3 grid grid-cols-3 items-center text-[11px] text-primary">
          <a
            href="https://www.GoToSpecialClass.com"
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            www.GoToSpecialClass.com
          </a>
          <div className="text-center text-muted-foreground">
            Next Specials Class
            <span className="mx-2 text-accent">♥</span>
            Generated by Specialist Ops!
          </div>
          <a
            href="mailto:info@GoToSpecialClass.com"
            className="text-right hover:underline"
          >
            info@GoToSpecialClass.com
          </a>
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          @page { size: landscape; margin: 0.5in; }
          body * { visibility: hidden !important; }
          #master-admin-print, #master-admin-print * { visibility: visible !important; }
          #master-admin-print { position: absolute; inset: 0; width: 100%; }
        }
      `}</style>
    </div>
  );
}
