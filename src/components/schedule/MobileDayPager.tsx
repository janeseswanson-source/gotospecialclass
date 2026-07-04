// MobileDayPager — the read-only phone view (shown under `md`). Editing stays on
// desktop; here a coordinator swipes through the week a day at a time and can
// filter to one specialist or teacher. Blocks render as a simple time-ordered
// list with subject color rails, matching the grid's palette.
import { useRef } from "react";
import { cn, formatTime } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getSubjectLeftBorderClass, getSubjectColorClass } from "@/lib/subjectColors";
import { parseTime } from "@/lib/scheduleGrid";
import type { BlockData, RecessBand } from "./ScheduleGrid";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const DAY_FULL: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };

interface Props {
  blocks: BlockData[];
  recessBands?: RecessBand[];
  day: string;
  onDayChange: (day: string) => void;
  specialists: { id: string; name: string; subject: string }[];
  teachers: { id: string; name: string; grade: string }[];
  filterSpecialist: string;
  onFilterSpecialist: (v: string) => void;
  filterTeacher: string;
  onFilterTeacher: (v: string) => void;
}

export default function MobileDayPager({
  blocks, recessBands, day, onDayChange, specialists, teachers,
  filterSpecialist, onFilterSpecialist, filterTeacher, onFilterTeacher,
}: Props) {
  const touchX = useRef<number | null>(null);
  const idx = Math.max(0, DAYS.indexOf(day));
  const go = (delta: number) => {
    const next = idx + delta;
    if (next >= 0 && next < DAYS.length) onDayChange(DAYS[next]);
  };

  // Blocks for the selected day, honoring the specialist/teacher filters.
  const dayBlocks = blocks.filter((b) => {
    if (b.day_of_week !== day) return false;
    if (filterSpecialist !== "all" && specialists.find((s) => s.name === b.specialist_name)?.id !== filterSpecialist) return false;
    if (filterTeacher !== "all" && teachers.find((t) => t.name === b.teacher_name)?.id !== filterTeacher) return false;
    return true;
  });

  // Rows for the selected day: block cells + recess bands, time-ordered.
  type Row = { kind: "block"; block: BlockData } | { kind: "band"; band: RecessBand };
  const rows: Row[] = [
    ...dayBlocks.map((block): Row => ({ kind: "block", block })),
    ...(recessBands ?? []).map((band): Row => ({ kind: "band", band })),
  ].sort((a, b) => {
    const at = a.kind === "block" ? parseTime(a.block.start_time) : parseTime(a.band.start_time);
    const bt = b.kind === "block" ? parseTime(b.block.start_time) : parseTime(b.band.start_time);
    return at - bt;
  });

  return (
    <div className="space-y-3 md:hidden">
      {/* Filters */}
      <div className="grid grid-cols-2 gap-2">
        <Select value={filterSpecialist} onValueChange={onFilterSpecialist}>
          <SelectTrigger className="h-9"><SelectValue placeholder="All specialists" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All specialists</SelectItem>
            {specialists.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterTeacher} onValueChange={onFilterTeacher}>
          <SelectTrigger className="h-9"><SelectValue placeholder="All teachers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All teachers</SelectItem>
            {teachers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Day pager */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-2 py-2">
        <button type="button" onClick={() => go(-1)} disabled={idx === 0} className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground disabled:opacity-30 hover:bg-muted" aria-label="Previous day">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold text-foreground">{DAY_FULL[day] ?? day}</span>
        <button type="button" onClick={() => go(1)} disabled={idx === DAYS.length - 1} className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground disabled:opacity-30 hover:bg-muted" aria-label="Next day">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Day schedule (read-only) */}
      <div
        className="space-y-2"
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchX.current == null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
          touchX.current = null;
        }}
      >
        {rows.length === 0 && (
          <p className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            Nothing scheduled on {DAY_FULL[day] ?? day}.
          </p>
        )}
        {rows.map((row, i) => {
          if (row.kind === "band") {
            return (
              <div key={`band-${i}`} className="rounded-lg bg-amber-100/70 dark:bg-amber-900/30 px-3 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-200">
                {row.band.label} · {formatTime(row.band.start_time)}–{formatTime(row.band.end_time)}
              </div>
            );
          }
          const b = row.block;
          return (
            <div key={b.id} className={cn("rounded-lg border bg-card p-3", getSubjectColorClass(b.subject), getSubjectLeftBorderClass(b.subject))}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">{b.subject ?? "—"}</span>
                <span className="font-mono text-xs text-muted-foreground">{formatTime(b.start_time)}–{formatTime(b.end_time)}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                {b.grade && <span className="rounded bg-primary/15 px-1 font-semibold text-primary">Gr {b.grade}</span>}
                <span className="truncate">{b.teacher_name ?? b.specialist_name ?? ""}</span>
                {b.week_label && <span className="ml-auto rounded border border-amber-500/40 bg-amber-500/15 px-1 text-[10px] font-bold uppercase text-amber-700 dark:text-amber-300">{b.week_label}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
