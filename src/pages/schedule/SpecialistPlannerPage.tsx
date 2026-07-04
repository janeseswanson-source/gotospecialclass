import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSchool } from "@/contexts/SchoolContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Clock, CalendarDays, AlertTriangle, ArrowLeft } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import ScheduleGrid, { type BlockData, type RecessBand } from "@/components/schedule/ScheduleGrid";
import { getSubjectBadgeClass } from "@/lib/subjectColors";
import { cn } from "@/lib/utils";
import { parseTime } from "@/lib/scheduleGrid";
import BrandedScheduleHeader from "@/components/schedule/BrandedScheduleHeader";
import WeekCyclePicker from "@/components/schedule/WeekCyclePicker";
import { buildWeekCycle, type WeekStrategy } from "@/lib/weekCycle";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

interface SpecialistWithLoad {
  id: string;
  name: string;
  subject: string;
  working_days: string[];
  planning_minutes: number;
  totalClasses: number;
  totalMinutes: number;
  classesByDay: Record<string, number>;
  conflicts: string[];
  gradesServed: string[];
}

interface RecessRow {
  id: string;
  grade_band: string;
  am_recess_start: string | null;
  am_recess_end: string | null;
  lunch_start: string | null;
  lunch_end: string | null;
  pm_recess_start: string | null;
  pm_recess_end: string | null;
}

const SpecialistCardSkeleton = () => (
  <div className="rounded-xl border border-border bg-card p-4 space-y-3">
    <Skeleton className="h-4 w-32" />
    <Skeleton className="h-3 w-20" />
    <div className="flex gap-3">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-3 w-16" />
    </div>
    <div className="flex gap-1">
      {DAYS.map(d => <Skeleton key={d} className="h-5 w-10 rounded-full" />)}
    </div>
  </div>
);

function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function expandBandGrades(band: string): string[] {
  // "all" handled by caller. Supports "K-2", "3-5", "K,1,2", "K"
  const parts = band.split(",").map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const m = p.match(/^([Kk]|\d+)\s*-\s*(\d+)$/);
    if (m) {
      const startTok = m[1];
      const endNum = Number(m[2]);
      const startNum = /k/i.test(startTok) ? 0 : Number(startTok);
      for (let i = startNum; i <= endNum; i++) {
        out.push(i === 0 ? "K" : String(i));
      }
    } else {
      out.push(p.toUpperCase() === "K" ? "K" : p);
    }
  }
  return out;
}

function bandsForSpecialist(gradesServed: string[], rows: RecessRow[]): RecessBand[] {
  const out: RecessBand[] = [];
  for (const row of rows) {
    const isAll = (row.grade_band ?? "all").toLowerCase() === "all";
    if (!isAll) {
      const bandGrades = expandBandGrades(row.grade_band);
      const overlap = bandGrades.some((g) => gradesServed.includes(g));
      if (!overlap) continue;
    }
    const prefix = isAll ? "" : `${row.grade_band} `;
    const push = (label: string, s: string | null, e: string | null, suffix: string) => {
      if (s && e) out.push({ id: `${row.id}-${suffix}`, label: `${prefix}${label}`, start_time: s, end_time: e });
    };
    push("AM Recess", row.am_recess_start, row.am_recess_end, "am");
    push("Lunch", row.lunch_start, row.lunch_end, "lunch");
    push("PM Recess", row.pm_recess_start, row.pm_recess_end, "pm");
  }
  return out.sort((a, b) => a.start_time.localeCompare(b.start_time));
}

export default function SpecialistPlannerPage() {
  const { user } = useAuth();
  const { selectedSchoolId, schools, loading: schoolLoading } = useSchool();
  const [specialists, setSpecialists] = useState<SpecialistWithLoad[]>([]);
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [timeSlots, setTimeSlots] = useState<string[]>([]);
  const [recessRows, setRecessRows] = useState<RecessRow[]>([]);
  const [weekFilter, setWeekFilter] = useState<string>("all");

  useEffect(() => {
    if (!user || schoolLoading) return;
    if (selectedSchoolId) load();
    else setLoading(false);
  }, [user, selectedSchoolId, schoolLoading]);

  async function load() {
    setLoading(true);
    setLoadError(false);

    const { data: gen } = await supabase.from("schedule_generations").select("id").eq("school_id", selectedSchoolId!).order("version", { ascending: false }).limit(1).maybeSingle();
    const { data: specs } = await supabase.from("specialists").select("*").eq("school_id", selectedSchoolId!);
    const { data: teachers } = await supabase.from("classroom_teachers").select("id, name").eq("school_id", selectedSchoolId!);
    const { data: recess } = await supabase.from("recess_lunch_config").select("*").eq("school_id", selectedSchoolId!);

    let allBlocks: any[] = [];
    if (gen) {
      const { data: blks } = await supabase.from("schedule_blocks").select("*").eq("generation_id", gen.id);
      allBlocks = blks ?? [];
    }

    const specMap = Object.fromEntries((specs ?? []).map((s) => [s.id, s]));
    const teachMap = Object.fromEntries((teachers ?? []).map((t) => [t.id, t]));

    const mapped: BlockData[] = allBlocks.map((b) => ({
      id: b.id,
      day_of_week: b.day_of_week,
      start_time: b.start_time,
      end_time: b.end_time,
      subject: b.subject,
      specialist_name: b.specialist_id ? specMap[b.specialist_id]?.name : null,
      teacher_name: b.teacher_id ? teachMap[b.teacher_id]?.name : null,
      room: b.room,
      grade: b.grade,
      is_override: b.is_override ?? false,
      week_label: b.week_label ?? null,
      specialist_id: b.specialist_id ?? null,
      teacher_id: b.teacher_id ?? null,
      notes: b.notes ?? null,
    }));

    setBlocks(mapped);
    setTimeSlots([...new Set(mapped.map((b) => b.start_time))].sort());
    setRecessRows((recess ?? []) as RecessRow[]);

    const enriched: SpecialistWithLoad[] = (specs ?? []).map((s) => {
      const myBlocks = allBlocks.filter((b) => b.specialist_id === s.id);
      const classesByDay: Record<string, number> = {};
      DAYS.forEach((d) => {
        classesByDay[d] = myBlocks.filter((b) => b.day_of_week === d).length;
      });
      const totalMinutes = myBlocks.reduce((sum, b) => {
        const [sh, sm] = b.start_time.split(":").map(Number);
        const [eh, em] = b.end_time.split(":").map(Number);
        return sum + (eh * 60 + em) - (sh * 60 + sm);
      }, 0);

      const conflicts: string[] = [];
      DAYS.forEach((d) => {
        const dayBlocks = myBlocks.filter((b) => b.day_of_week === d);
        const timeMap = new Map<string, number>();
        dayBlocks.forEach((b) => {
          timeMap.set(b.start_time, (timeMap.get(b.start_time) ?? 0) + 1);
        });
        timeMap.forEach((count, time) => {
          if (count > 1) conflicts.push(`Double-booked on ${d} at ${time}`);
        });
      });
      DAYS.forEach((d) => {
        const workingDays = s.working_days ?? DAYS;
        if (!workingDays.includes(d) && classesByDay[d] > 0) {
          conflicts.push(`Scheduled on ${d} (non-working day)`);
        }
      });

      const gradesServed = [
        ...new Set(myBlocks.map((b) => b.grade).filter((g): g is string => !!g)),
      ];

      return {
        id: s.id,
        name: s.name,
        subject: s.subject,
        working_days: s.working_days ?? DAYS,
        planning_minutes: s.planning_minutes ?? 0,
        totalClasses: myBlocks.length,
        totalMinutes,
        classesByDay,
        conflicts,
        gradesServed,
      };
    });

    setSpecialists(enriched);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            <SpecialistCardSkeleton />
            <SpecialistCardSkeleton />
            <SpecialistCardSkeleton />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-2">
                <Skeleton className="h-10 w-20" />
                {DAYS.map(d => <Skeleton key={d} className="h-10 flex-1" />)}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4 animate-fade-in">
        <h1 className="text-2xl font-bold text-foreground">Specialist Planner</h1>
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card p-20">
          <p className="text-sm text-muted-foreground">Failed to load data.</p>
          <Button variant="outline" onClick={load}>Retry</Button>
        </div>
      </div>
    );
  }

  const activeSchool = schools.find((x) => x.id === selectedSchoolId);

  // Infer the week strategy from the labels present → dated cycle for the selector.
  const weekLabelSet = new Set(blocks.map((b) => b.week_label).filter(Boolean) as string[]);
  const strategy: WeekStrategy =
    weekLabelSet.has("AA") || weekLabelSet.has("BB") ? "aa_bb_week"
      : weekLabelSet.has("A") || weekLabelSet.has("B") ? "ab_week"
        : "standard";
  const hasWeekCycle = strategy !== "standard";
  const weekCycle = buildWeekCycle({
    strategy,
    startDate: (activeSchool as { school_year_start?: string | null })?.school_year_start ?? null,
    endDate: (activeSchool as { school_year_end?: string | null })?.school_year_end ?? null,
    schoolYear: (activeSchool as { school_year?: string | null })?.school_year ?? null,
  });
  const weekVisible = (label?: string | null) => weekFilter === "all" || !label || label === weekFilter;

  const selectedSpec = specialists.find((s) => s.id === selected) ?? null;
  const selectedBlocks = selectedSpec
    ? blocks.filter((b) => b.specialist_name === selectedSpec.name && weekVisible(b.week_label))
    : [];
  const selectedBands = selectedSpec ? bandsForSpecialist(selectedSpec.gradesServed, recessRows) : [];

  // Per-day teaching load + internal planning gaps for the selected specialist —
  // "their reality": how full each day is and where the open planning time falls.
  const dayLoads = DAYS.map((d) => {
    const dayBlocks = selectedBlocks
      .filter((b) => b.day_of_week === d)
      .sort((a, b) => parseTime(a.start_time) - parseTime(b.start_time));
    let minutes = 0;
    let gap = 0;
    dayBlocks.forEach((b, i) => {
      minutes += parseTime(b.end_time) - parseTime(b.start_time);
      if (i > 0) {
        const g = parseTime(b.start_time) - parseTime(dayBlocks[i - 1].end_time);
        if (g > 0) gap += g;
      }
    });
    return { day: d, classes: dayBlocks.length, minutes, gap };
  });
  const maxDayMinutes = Math.max(60, ...dayLoads.map((d) => d.minutes));

  return (
    <div className="space-y-5 animate-fade-in">
      <BrandedScheduleHeader
        title="Specialist Planner"
        subtitle="Specialist Ops! · Workload & Assignments"
        schoolName={activeSchool?.name}
        schoolYear={(activeSchool as any)?.school_year ?? undefined}
      />
      <div>
        <h1 className="text-2xl font-bold text-foreground sr-only">Specialist Planner</h1>
        <p className="text-sm text-muted-foreground">Review workload and weekly assignments per specialist.</p>
      </div>

      {specialists.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border bg-card p-20">
          <p className="text-sm text-muted-foreground">No specialists configured yet.</p>
        </div>
      ) : selectedSpec ? (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            {specialists.map((s) => {
              const isActive = selected === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={cn(
                    "w-full rounded-xl border p-4 text-left transition-all",
                    isActive
                      ? "border-2 border-accent bg-accent/10 shadow-md"
                      : "border border-border bg-card hover:border-primary/30",
                  )}
                >
                  <p className="text-sm font-semibold text-foreground">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.subject}</p>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" />{s.totalClasses} classes</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatMinutes(s.totalMinutes)}</span>
                  </div>
                  {s.conflicts.length > 0 && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="mt-2 flex items-center gap-1 text-xs text-destructive">
                            <AlertTriangle className="h-3 w-3" />
                            <span>{s.conflicts.length} conflict{s.conflicts.length > 1 ? "s" : ""}</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-64">
                          <ul className="space-y-1 text-xs">
                            {s.conflicts.map((c, i) => <li key={i}>• {c}</li>)}
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  <div className="mt-2 flex gap-1 flex-wrap">
                    {DAYS.map((d) => (
                      <Badge
                        key={d}
                        variant={s.working_days.includes(d) ? "default" : "outline"}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {d} {s.classesByDay[d] > 0 && `(${s.classesByDay[d]})`}
                      </Badge>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="space-y-4">
            <button
              onClick={() => setSelected(null)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3 w-3" /> Back to all specialists
            </button>

            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl font-bold text-foreground">{selectedSpec.name}</h2>
                <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", getSubjectBadgeClass(selectedSpec.subject))}>
                  {selectedSpec.subject}
                </span>
                <span className="text-sm text-muted-foreground">
                  Total this week: <span className="font-semibold text-foreground">{formatMinutes(selectedSpec.totalMinutes)}</span>
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-xs">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  <span className="font-medium text-foreground">{selectedSpec.totalClasses} classes</span>
                </div>
                {selectedSpec.planning_minutes > 0 && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-xs">
                    <span className="font-medium text-foreground">{selectedSpec.planning_minutes} min planning</span>
                  </div>
                )}
                {selectedSpec.conflicts.length > 0 && (
                  <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-1.5 text-xs">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <span className="font-medium text-destructive">{selectedSpec.conflicts.length} conflict{selectedSpec.conflicts.length > 1 ? "s" : ""}</span>
                  </div>
                )}
              </div>
            </div>

            {hasWeekCycle && (
              <WeekCyclePicker cycle={weekCycle} value={weekFilter} onChange={setWeekFilter} />
            )}

            {/* Per-day load vs the busiest day, with the open planning time labelled. */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Weekly load</h3>
              <ul className="space-y-2">
                {dayLoads.map((d) => (
                  <li key={d.day} className="flex items-center gap-3 text-xs">
                    <span className="w-8 shrink-0 font-medium text-muted-foreground">{d.day}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all motion-reduce:transition-none"
                        style={{ width: `${Math.round((d.minutes / maxDayMinutes) * 100)}%` }}
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
                      {d.classes} · {formatMinutes(d.minutes)}
                    </span>
                    <span className="hidden w-28 shrink-0 text-right sm:block">
                      {d.gap > 0 ? <span className="text-accent-foreground/80">Planning · {formatMinutes(d.gap)}</span> : <span className="opacity-0">—</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <ScheduleGrid blocks={selectedBlocks} timeSlots={timeSlots} recessBands={selectedBands} />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Click a specialist to focus their week, or scroll through all below.</p>
            {hasWeekCycle && (
              <WeekCyclePicker cycle={weekCycle} value={weekFilter} onChange={setWeekFilter} />
            )}
          </div>
          {specialists.map((s) => {
            const sBlocks = blocks.filter((b) => b.specialist_name === s.name && weekVisible(b.week_label));
            return (
              <div key={s.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                <button
                  onClick={() => setSelected(s.id)}
                  className="w-full flex items-center justify-between gap-3 flex-wrap hover:opacity-80 transition-opacity text-left"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="text-base font-semibold text-foreground">{s.name}</h3>
                    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", getSubjectBadgeClass(s.subject))}>
                      {s.subject}
                    </span>
                    <span className="text-xs text-muted-foreground">{s.totalClasses} classes · {formatMinutes(s.totalMinutes)}</span>
                    {s.conflicts.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-destructive">
                        <AlertTriangle className="h-3 w-3" />{s.conflicts.length} conflict{s.conflicts.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-primary">Open →</span>
                </button>
                <ScheduleGrid blocks={sBlocks} timeSlots={timeSlots} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
