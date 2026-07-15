import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useSchool } from '@/contexts/SchoolContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Printer, FileSpreadsheet, CalendarPlus, Sun, Utensils, Cloud, LogOut } from 'lucide-react';
import logo from '@/assets/logo.png';
import { formatTime } from '@/lib/utils';
import { BRAND } from '@/brand/brand';
import PageHeader from '@/components/layout/PageHeader';
import WeekCyclePicker from '@/components/schedule/WeekCyclePicker';
import { buildWeekCycle, type WeekStrategy } from '@/lib/weekCycle';
import { friendlyBandLabel, bandLabelMapFromStored } from '@/lib/scheduleGrid';
import { gradeRank, formatGradeOrdinal } from '@/lib/gradeOrdinal';
import { getGradeAccentTextClass } from '@/lib/gradeColors';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;
const DAY_SHORT: Record<string, typeof DAYS[number]> = {
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday',
};

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

type Rotation = {
  id: string;
  school_id: string;
  specialist_id: string | null;
  teacher_id: string | null;
  grade: string | null;
  week_label: string | null;
  day_of_week: string | null;
  slot_index: number;
  rotation_type: string | null;
  notes: string | null;
};

type Specialist = { id: string; name: string; subject: string | null };
type Teacher = { id: string; name: string; grade: string | null };
type RecessRow = {
  id: string;
  grade_band: string;
  am_recess_start: string | null; am_recess_end: string | null;
  lunch_start: string | null; lunch_end: string | null;
  pm_recess_start: string | null; pm_recess_end: string | null;
};
type AdminRot = {
  day: string;
  startTime?: string;
  endTime?: string;
  grades?: string[];
  weekLabel?: 'A' | 'B' | null;
  rotationLabel?: string;
};

const isPlanningPrep = (s?: string | null) =>
  !!s && /planning|prep|plc/i.test(s);
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
  const [rotations, setRotations] = useState<Rotation[]>([]);
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [recess, setRecess] = useState<RecessRow[]>([]);
  const [genId, setGenId] = useState<string | null>(null);
  const [weekFilter, setWeekFilter] = useState<string>('all');

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
    const [{ data: s }, { data: gen }, { data: sp }, { data: t }, { data: rot }, { data: rc }] =
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
        supabase.from('class_rotations').select('*').eq('school_id', selectedSchoolId!),
        supabase.from('recess_lunch_config').select('*').eq('school_id', selectedSchoolId!),
      ]);
    setSchool(s);
    setSpecialists((sp ?? []) as Specialist[]);
    setTeachers((t ?? []) as Teacher[]);
    setRotations((rot ?? []) as Rotation[]);
    setRecess((rc ?? []) as RecessRow[]);
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
      setGenId(null);
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

  const specialistById = new Map(specialists.map((s) => [s.id, s]));
  const teacherById = new Map(teachers.map((t) => [t.id, t]));

  // Infer the week strategy from the labels present, then build the DATED cycle so
  // this print-truth screen renders the SAME dated labels as the Master Schedule.
  const weekLabelSet = new Set(blocks.map((b) => b.week_label).filter(Boolean) as string[]);
  const strategy: WeekStrategy =
    weekLabelSet.has('AA') || weekLabelSet.has('BB') ? 'aa_bb_week'
      : weekLabelSet.has('A') || weekLabelSet.has('B') ? 'ab_week'
        : 'standard';
  const hasWeekCycle = strategy !== 'standard';
  const weekCycle = buildWeekCycle({
    strategy,
    startDate: (school as { school_year_start?: string | null })?.school_year_start ?? null,
    endDate: (school as { school_year_end?: string | null })?.school_year_end ?? null,
    schoolYear: school?.school_year ?? null,
  });
  // Visible under the current week filter: no label (every week) or the chosen one.
  const weekVisible = (label?: string | null) => weekFilter === 'all' || !label || label === weekFilter;

  // ── Planning & Prep band (live from class_rotations grouped by day+slot) ──
  // Falls back to school.admin_rotation labels when class_rotations is empty.
  const planningPerDay: Record<string, { label: string; weekLabel?: string; pairs: { specialist: string; teacher: string; grade: string; subject: string }[] }[]> = {};
  for (const day of DAYS) planningPerDay[day] = [];

  // Group rotations by long-day name + slot_index. class_rotations stores day_of_week
  // as 'Mon', 'Tue' etc; normalize to long form.
  const rotByDaySlot = new Map<string, Rotation[]>();
  for (const r of rotations) {
    const dayLong = DAY_SHORT[r.day_of_week as keyof typeof DAY_SHORT] ?? (DAYS.find((d) => d.toLowerCase() === (r.day_of_week ?? '').toLowerCase()) ?? null);
    if (!dayLong) continue;
    const key = `${dayLong}|${r.slot_index ?? 0}|${r.week_label ?? ''}`;
    (rotByDaySlot.get(key) ?? rotByDaySlot.set(key, []).get(key)!).push(r);
  }

  for (const day of DAYS) {
    // Find all slot keys for this day, sorted by slot_index.
    const dayKeys = [...rotByDaySlot.keys()]
      .filter((k) => k.startsWith(`${day}|`))
      .sort((a, b) => {
        const ai = parseInt(a.split('|')[1], 10);
        const bi = parseInt(b.split('|')[1], 10);
        return ai - bi;
      });
    for (const key of dayKeys) {
      const slot = rotByDaySlot.get(key)!;
      const weekLabel = slot[0]?.week_label ?? undefined;
      const slotIdx = parseInt(key.split('|')[1], 10);
      const label = `Rotation ${slotIdx + 1}`;
      const pairs = slot
        .map((r) => ({
          specialist: r.specialist_id ? specialistById.get(r.specialist_id)?.name ?? '—' : '—',
          subject: r.specialist_id ? specialistById.get(r.specialist_id)?.subject ?? '' : '',
          teacher: r.teacher_id ? teacherById.get(r.teacher_id)?.name ?? '' : '',
          grade: r.grade ?? '',
        }))
        .slice(0, 6);
      planningPerDay[day].push({ label, weekLabel: weekLabel ?? undefined, pairs });
    }
    // Layer in school.admin_rotation labels (the user-defined rotation labels with A/B and times).
    for (const ar of adminRotation) {
      if ((ar.day || '').toLowerCase() !== day.toLowerCase()) continue;
      // Only add a "label-only" entry if class_rotations is empty for this day.
      if (planningPerDay[day].length === 0) {
        planningPerDay[day].push({
          label: ar.rotationLabel || 'Planning Block',
          weekLabel: ar.weekLabel ?? undefined,
          pairs: [],
        });
      } else if (ar.rotationLabel) {
        // Replace generic "Rotation N" label with user-defined label if available.
        const idx = adminRotation.filter((x) => (x.day || '').toLowerCase() === day.toLowerCase()).indexOf(ar);
        if (planningPerDay[day][idx]) {
          planningPerDay[day][idx].label = ar.rotationLabel;
          if (ar.weekLabel) planningPerDay[day][idx].weekLabel = ar.weekLabel;
        }
      }
    }
  }

  // ── Specialist rotation rows: group by unique time slot, stable-sorted by start time ──
  const rotationBlocks = blocks.filter((b) => !isChrome(b.subject));
  const slotKeys = Array.from(
    new Set(rotationBlocks.map((b) => `${b.start_time}|${b.end_time}`))
  ).sort();

  // ── Chrome rows from recess_lunch_config (source of truth) ──
  // Merge same-window entries across grade bands into ONE banner per window,
  // instead of repeating the kind ("AM Recess · AM Recess · ...") per column.
  // recess_grade_bands is stored as an ARRAY of {key,label,grades} — it must be
  // converted (casting it as a map silently dropped every real label).
  const bandLabels = bandLabelMapFromStored(school?.recess_grade_bands);
  type ChromeRow = { key: string; kind: string; groups: string[]; time: string };
  const chromeRowsFor = (kind: 'RECESS' | 'LUNCH' | 'DISMISSAL'): ChromeRow[] => {
    if (kind === 'DISMISSAL') {
      if (!endTime) return [];
      // Early release ("School ends 1:15 Wed else 2:00") must show on the
      // office's print-truth page, not just the setup wizard.
      const erDay = (school?.early_release_day as string | null | undefined) ?? null;
      const erEnd = (school?.early_release_end_time as string | null | undefined) ?? null;
      const time = erDay && erEnd
        ? `${formatTime(endTime)} (${formatTime(erEnd)} ${erDay.slice(0, 3)})`
        : formatTime(endTime);
      return [{ key: 'dismissal', kind: 'Dismissal', groups: [], time }];
    }
    const drafts = new Map<string, ChromeRow & { seen: Set<string> }>();
    const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    const push = (subKind: string, start: string, end: string, band: string) => {
      const time = `${formatTime(start)}–${formatTime(end)}`;
      const k = `${subKind}|${time}`;
      let d = drafts.get(k);
      if (!d) { d = { key: k, kind: subKind, groups: [], time, seen: new Set() }; drafts.set(k, d); }
      const clean = band.trim().replace(/\s+/g, ' ');
      if (!clean) return;
      const norm = normalize(clean);
      if (norm === normalize(subKind)) return;
      if (d.seen.has(norm)) return;
      d.seen.add(norm);
      d.groups.push(clean);
    };
    for (const r of recess) {
      const band = friendlyBandLabel(r.grade_band, bandLabels);
      if (kind === 'RECESS') {
        if (r.am_recess_start && r.am_recess_end) push('AM Recess', r.am_recess_start, r.am_recess_end, band);
        if (r.pm_recess_start && r.pm_recess_end) push('PM Recess', r.pm_recess_start, r.pm_recess_end, band);
      } else if (kind === 'LUNCH') {
        if (r.lunch_start && r.lunch_end) push('Lunch', r.lunch_start, r.lunch_end, band);
      }
    }
    return Array.from(drafts.values()).map(({ key, kind, groups, time }) => ({ key, kind, groups, time }));
  };


  const specialistName = (id: string | null) =>
    (id && specialistById.get(id)?.name) || '';
  const specialistSubject = (id: string | null) =>
    (id && specialistById.get(id)?.subject) || '';
  const teacherName = (id: string | null) =>
    (id && teacherById.get(id)?.name) || '';

  const blocksFor = (day: string, key: string) => {
    const [start, end] = key.split('|');
    const dayShort = day.slice(0, 3); // Monday -> Mon
    return rotationBlocks
      .filter(
        (b) =>
          (b.day_of_week === day || b.day_of_week === dayShort) &&
          b.start_time === start &&
          b.end_time === end &&
          weekVisible(b.week_label)
      )
      .sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade));
  };

  async function handleXlsx() {
    if (!selectedSchoolId) return;
    try {
      const { exportMasterAdminXlsx } = await import('@/lib/exportMasterAdminXlsx');
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

  const hasAnyData = blocks.length > 0 || rotations.length > 0;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Toolbar (hidden when printing) */}
      <div className="print:hidden">
        <PageHeader
          title="Master Admin View"
          subtitle="The coordinator's print-truth screen — the full week, every specialist, one page."
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!hasAnyData}>
                <Printer className="h-4 w-4 mr-1.5" /> Print
              </Button>
              <Button size="sm" onClick={handleXlsx} disabled={!hasAnyData}>
                <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Download Master Admin XLSX
              </Button>
            </>
          }
        />
        {hasAnyData && hasWeekCycle && (
          <div className="mt-3">
            <WeekCyclePicker cycle={weekCycle} value={weekFilter} onChange={setWeekFilter} />
          </div>
        )}
      </div>

      {!hasAnyData ? (
        <div className="rounded-xl border-2 border-dashed border-border bg-card p-12 text-center">
          <CalendarPlus className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold text-foreground mb-1">No schedule yet</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Generate a schedule from the Master Schedule page to populate this branded weekly view.
          </p>
          <Button asChild>
            <Link to="/app/schedule">Go to Master Schedule</Link>
          </Button>
        </div>
      ) : (
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
                Weekly Master View · {BRAND.name}
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
              {planningPerDay[d].filter((slot) => weekVisible(slot.weekLabel)).length === 0 ? (
                <div className="text-muted-foreground italic opacity-60">—</div>
              ) : (
                planningPerDay[d].filter((slot) => weekVisible(slot.weekLabel)).map((slot, i) => (
                  <div key={i} className="rounded border border-border/60 bg-background/60 p-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-accent font-semibold">{slot.label}</span>
                      {slot.weekLabel && (
                        <span className="text-[9px] font-bold uppercase rounded bg-accent/20 text-accent px-1.5 py-0.5">
                          {slot.weekLabel}
                        </span>
                      )}
                    </div>
                    {slot.pairs.length === 0 ? (
                      <div className="text-muted-foreground italic mt-1 opacity-70">
                        No assignments yet
                      </div>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {slot.pairs.map((p, j) => (
                          <li key={j} className="flex gap-1">
                            {p.grade && (
                              <span className="text-primary font-semibold w-7 truncate">
                                {formatGradeOrdinal(p.grade)}
                              </span>
                            )}
                            <span className="text-foreground truncate flex-1">
                              {p.subject ? `${p.subject} · ` : ''}
                              {p.specialist}
                              {p.teacher ? ` → ${p.teacher.split(' ').slice(-1)[0]}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
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
                          // Group the grade-sorted blocks into grade runs so the
                          // slot reads as a wheel: "1st" once, then everyone
                          // servicing 1st. The office scans the heading to know
                          // which grade is at specials right now.
                          cellBlocks
                            .reduce<{ grade: string | null; items: Block[] }[]>((groups, b) => {
                              const g = b.grade ?? null;
                              const last = groups[groups.length - 1];
                              if (last && last.grade === g) last.items.push(b);
                              else groups.push({ grade: g, items: [b] });
                              return groups;
                            }, [])
                            .map((grp, gi) => (
                              <div key={gi} className="space-y-0.5">
                                {grp.grade && (
                                  <div className={`text-[12px] font-bold leading-tight ${getGradeAccentTextClass(grp.grade)}`}>
                                    {formatGradeOrdinal(grp.grade)}
                                  </div>
                                )}
                                {grp.items.map((b) => (
                                  <div key={b.id} className={`flex items-baseline gap-1.5 ${grp.grade ? 'pl-1.5' : ''}`}>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-foreground font-medium truncate">
                                        {b.subject || specialistSubject(b.specialist_id)}
                                      </div>
                                      <div className="text-muted-foreground truncate">
                                        {specialistName(b.specialist_id)}
                                        {b.teacher_id ? ` · ${teacherName(b.teacher_id)}` : ''}
                                      </div>
                                      {/* Every cell prints its own time — a print-out
                                          must be self-evident even cut off from the
                                          row label ("time in case it is different"). */}
                                      <div className="text-[9px] font-mono text-muted-foreground">
                                        {formatTime(b.start_time)}–{formatTime(b.end_time)}
                                      </div>
                                    </div>
                                    {b.week_label && (
                                      <span className="text-[9px] font-bold uppercase rounded bg-accent/20 text-accent px-1 py-0.5">
                                        {b.week_label}
                                      </span>
                                    )}
                                  </div>
                                ))}
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

        {/* Chrome rows: Recess / Lunch / Dismissal — one merged banner per window */}
        {(['RECESS', 'LUNCH', 'DISMISSAL'] as const).map((kind) => {
          const rows = chromeRowsFor(kind);
          if (rows.length === 0) return null;
          return (
            <div key={kind}>
              <div className="bg-muted/70 px-3 py-1 text-[11px] font-semibold text-primary border-b border-border">
                {kind}
              </div>
              {rows.map((row) => {
                const Icon = /lunch/i.test(row.kind) ? Utensils
                  : /pm recess/i.test(row.kind) ? Cloud
                  : /am recess/i.test(row.kind) ? Sun
                  : LogOut;
                const MAX = 3;
                const shown = row.groups.slice(0, MAX);
                const overflow = row.groups.length - shown.length;
                const groupStr = shown.length
                  ? shown.join(' & ') + (overflow > 0 ? ` +${overflow} more` : '')
                  : '';
                return (
                  <div
                    key={row.key}
                    className="flex items-center gap-2 border-b border-border bg-amber-50/60 dark:bg-amber-950/20 px-3 py-1.5 text-[11px] text-amber-900 dark:text-amber-200"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                    <span className="font-semibold tracking-wide">{row.kind}</span>
                    {groupStr && (
                      <>
                        <span className="opacity-40">·</span>
                        <span className="truncate opacity-80">{groupStr}</span>
                      </>
                    )}
                    <span className="ml-auto font-mono opacity-70 shrink-0">{row.time}</span>
                  </div>
                );
              })}
            </div>
          );
        })}



        {/* Footer band */}
        <div className="bg-secondary/40 border-t-2 border-accent px-6 py-3 grid grid-cols-3 items-center text-[11px] text-primary">
          <a
            href={BRAND.url}
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            {BRAND.domain}
          </a>
          <div className="text-center text-muted-foreground">
            {weekFilter !== 'all' && weekCycle.currentWeekFor(new Date())
              ? `${weekFilter} Week`
              : <>Generated by {BRAND.name}</>}
          </div>
          <a
            href={`mailto:${BRAND.email}`}
            className="text-right hover:underline"
          >
            {BRAND.email}
          </a>
        </div>
      </div>
      )}

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
