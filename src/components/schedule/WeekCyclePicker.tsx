// WeekCyclePicker — the dated week selector, driven by lib/weekCycle. Shows the
// week that contains today ("This week · Week A · Mar 2–6") and lets the user
// filter the grid by cycle label (A/B or AA/BB), each annotated with the date of
// its next occurrence. Falls back to a simple "All / This week" control for the
// standard strategy. Presentational — the page owns the filter state.
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { CalendarDays } from "lucide-react";
import type { WeekCycle, WeekLabel } from "@/lib/weekCycle";

interface Props {
  cycle: WeekCycle;
  /** Current grid filter: a label, or "all" for every week. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export default function WeekCyclePicker({ cycle, value, onChange, className }: Props) {
  const today = useMemo(() => new Date(), []);
  const currentWeek = cycle.currentWeekFor(today);
  const currentLabel = currentWeek?.label ?? null;

  // The distinct labels this strategy uses, in cycle order.
  const labels = useMemo<WeekLabel[]>(() => {
    const seen: WeekLabel[] = [];
    for (const w of cycle.instructionalWeeks) {
      if (w.label && !seen.includes(w.label)) seen.push(w.label);
    }
    return seen;
  }, [cycle]);

  // For each label, the next occurrence on/after today (for the date annotation).
  const nextByLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const label of labels) {
      if (!label) continue;
      const weeks = cycle.rangesFor(label);
      const upcoming = weeks.find((w) => w.friday >= today) ?? weeks[weeks.length - 1];
      if (upcoming) map.set(label, upcoming.rangeText);
    }
    return map;
  }, [labels, cycle, today]);

  const chip = (v: string, label: string, sub?: string, isCurrent?: boolean) => (
    <button
      key={v}
      type="button"
      onClick={() => onChange(v)}
      aria-pressed={value === v}
      className={cn(
        "flex flex-col items-start rounded-lg border px-3 py-1.5 text-left transition-colors motion-reduce:transition-none",
        value === v
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:border-primary/40",
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold">
        {label}
        {isCurrent && (
          <span className={cn(
            "rounded-full px-1.5 py-px text-[9px] font-bold uppercase",
            value === v ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/15 text-primary",
          )}>
            Now
          </span>
        )}
      </span>
      {sub && <span className={cn("text-[10px]", value === v ? "text-primary-foreground/80" : "text-muted-foreground")}>{sub}</span>}
    </button>
  );

  return (
    <div className={cn("space-y-1.5 no-print", className)}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden />
        {currentWeek ? (
          <span>
            This week: <span className="font-medium text-foreground">{currentWeek.labelText}</span>
            {" · "}{currentWeek.rangeText}
            {currentWeek.isHolidayWeek && <span className="italic"> (no school)</span>}
          </span>
        ) : (
          <span>{cycle.explanation}</span>
        )}
      </div>
      <div className="flex flex-wrap items-stretch gap-1.5">
        {chip("all", "All weeks")}
        {labels.map((label) =>
          label ? chip(label, `Week ${label}`, nextByLabel.get(label), label === currentLabel) : null,
        )}
      </div>
    </div>
  );
}
