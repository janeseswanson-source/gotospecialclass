import { useState } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { GripVertical, ChevronUp, ChevronDown, X, Plus, AlertTriangle } from 'lucide-react';

export type PlusGradeSlot = {
  grade: string;
  startTime?: string;
  durationMinutes?: number;
  userSetTime?: boolean;
};
export type PlusDayEntry = { active: boolean; startTime: string; grades: PlusGradeSlot[] };
export type PlusRotation = Record<string, PlusDayEntry>;

export type RecessWindow = { start: string; end: string; label: string };

const ALL_GRADES = ['K', '1', '2', '3', '4', '5', '6'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;

/** Coerce mixed legacy shapes into PlusGradeSlot[]. */
function coerceGrades(raw: any): PlusGradeSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => {
      if (typeof g === 'string') return { grade: g };
      if (g && typeof g === 'object' && typeof g.grade === 'string') {
        return {
          grade: g.grade,
          startTime: typeof g.startTime === 'string' ? g.startTime : undefined,
          durationMinutes: typeof g.durationMinutes === 'number' ? g.durationMinutes : undefined,
          userSetTime: !!g.userSetTime,
        };
      }
      return null;
    })
    .filter(Boolean) as PlusGradeSlot[];
}

export function normalizePlusRotation(raw: any): PlusRotation {
  const base = emptyPlusRotation();
  if (!raw || typeof raw !== 'object') return base;
  for (const d of DAYS) {
    const e = raw[d];
    if (!e) continue;
    base[d] = {
      active: !!e.active,
      startTime: typeof e.startTime === 'string' ? e.startTime : '',
      grades: coerceGrades(e.grades),
    };
  }
  return base;
}

export const emptyPlusRotation = (): PlusRotation =>
  DAYS.reduce((acc, d) => ({ ...acc, [d]: { active: false, startTime: '', grades: [] } }), {} as PlusRotation);

export function migrateLegacyGradeRotation(legacy: any): PlusRotation {
  const base = emptyPlusRotation();
  if (!legacy || typeof legacy !== 'object') return base;
  for (const d of DAYS) {
    const e = legacy[d];
    if (e && Array.isArray(e.grades) && e.grades.length > 0) {
      base[d] = { active: true, startTime: '', grades: coerceGrades(e.grades) };
    }
  }
  return base;
}

// ===== Time helpers =====
function toMin(t: string): number | null {
  if (!t || !/^\d{1,2}:\d{2}/.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function toHHMM(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

type ComputedRow = {
  slot: PlusGradeSlot;
  startMin: number | null;
  endMin: number | null;
  isUserSet: boolean;
};

function computeRows(
  grades: PlusGradeSlot[],
  schoolStartMin: number | null,
  defaultDuration: number,
  passingTime: number,
): ComputedRow[] {
  const out: ComputedRow[] = [];
  let cursor: number | null = schoolStartMin;
  for (let i = 0; i < grades.length; i++) {
    const g = grades[i];
    const duration = g.durationMinutes ?? defaultDuration;
    let start: number | null;
    if (g.userSetTime && g.startTime) {
      start = toMin(g.startTime);
    } else {
      start = cursor;
    }
    const end = start != null ? start + duration : null;
    out.push({ slot: g, startMin: start, endMin: end, isUserSet: !!g.userSetTime });
    cursor = end != null ? end + passingTime : cursor;
  }
  return out;
}

function overlapsWindow(startMin: number, endMin: number, w: RecessWindow): boolean {
  const ws = toMin(w.start);
  const we = toMin(w.end);
  if (ws == null || we == null) return false;
  return startMin < we && endMin > ws;
}

interface ChipProps {
  id: string;
  grade: string;
  invalid: boolean;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  disabled: boolean;
}

function SortableChip({ id, grade, invalid, canUp, canDown, onMove, onRemove, disabled }: ChipProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const tone = invalid
    ? 'bg-warning/20 text-warning-foreground border-warning'
    : 'bg-accent text-accent-foreground border-accent';
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[11px] font-medium ${tone} ${disabled ? 'opacity-50' : ''}`}
      title={invalid ? `Your school doesn't serve grade ${grade}. Update Grades Served on School Info or remove this grade.` : undefined}
    >
      <button
        type="button"
        className="cursor-grab touch-none disabled:cursor-not-allowed"
        disabled={disabled}
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      {invalid && <AlertTriangle className="h-3 w-3" />}
      <span>{grade}</span>
      <button type="button" className="px-0.5 disabled:opacity-30" onClick={() => onMove(-1)} disabled={disabled || !canUp} aria-label="Move earlier">
        <ChevronUp className="h-3 w-3" />
      </button>
      <button type="button" className="px-0.5 disabled:opacity-30" onClick={() => onMove(1)} disabled={disabled || !canDown} aria-label="Move later">
        <ChevronDown className="h-3 w-3" />
      </button>
      <button type="button" className="ml-0.5 disabled:opacity-30" onClick={onRemove} disabled={disabled} aria-label="Remove">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

interface RowProps {
  day: typeof DAYS[number];
  entry: PlusDayEntry;
  isWorkingDay: boolean;
  gradesServed: string[];
  schoolStart: string;
  defaultDuration: number;
  passingTime: number;
  recessWindows: RecessWindow[];
  onChange: (e: PlusDayEntry) => void;
  disabled: boolean;
}

function DayRow({ day, entry, isWorkingDay, gradesServed, schoolStart, defaultDuration, passingTime, recessWindows, onChange, disabled }: RowProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const rowDisabled = disabled || !entry.active;
  const availableToAdd = ALL_GRADES.filter(g => !entry.grades.find(slot => slot.grade === g));

  const schoolStartMin = toMin(entry.startTime || schoolStart);
  const computed = computeRows(entry.grades, schoolStartMin, defaultDuration, passingTime);

  const updateSlot = (idx: number, patch: Partial<PlusGradeSlot>) => {
    const next = entry.grades.map((g, i) => (i === idx ? { ...g, ...patch } : g));
    onChange({ ...entry, grades: next });
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = entry.grades.findIndex(g => g.grade === String(active.id));
    const newIndex = entry.grades.findIndex(g => g.grade === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onChange({ ...entry, grades: arrayMove(entry.grades, oldIndex, newIndex) });
  };

  // Warnings
  const warnings: string[] = [];
  if (entry.active && computed.length > 0 && schoolStartMin != null) {
    computed.forEach((row, i) => {
      if (row.startMin == null || row.endMin == null) return;
      if (row.startMin < schoolStartMin) {
        warnings.push(`${row.slot.grade} starts before school start (${toHHMM(row.startMin)}).`);
      }
      if (i > 0) {
        const prev = computed[i - 1];
        if (prev.endMin != null && row.startMin < prev.endMin) {
          warnings.push(`${row.slot.grade} overlaps previous slot (${prev.slot.grade}).`);
        }
      }
      for (const w of recessWindows) {
        if (overlapsWindow(row.startMin, row.endMin, w)) {
          warnings.push(`${row.slot.grade} overlaps ${w.label} (${w.start}–${w.end}).`);
        }
      }
    });
  }

  return (
    <div className="rounded border border-border bg-card/50 p-2 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold w-8 shrink-0">{day}</span>
        <div className="flex items-center gap-1.5">
          <Switch
            checked={entry.active}
            disabled={disabled || !isWorkingDay}
            onCheckedChange={(v) => onChange({ ...entry, active: v })}
            id={`plus-active-${day}`}
          />
          <label htmlFor={`plus-active-${day}`} className={`text-[11px] cursor-pointer text-muted-foreground ${!isWorkingDay ? 'opacity-50' : ''}`}>Active</label>
        </div>
        {!isWorkingDay && (
          <span className="text-[10px] text-muted-foreground italic">Not a working day</span>
        )}
        {entry.active && !isWorkingDay && (
          <span className="text-[10px] text-warning-foreground bg-warning/10 px-1.5 py-0.5 rounded">
            Not in Days working — rotation will be ignored
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1 pl-10">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={entry.grades.map(g => g.grade)} strategy={horizontalListSortingStrategy}>
            {entry.grades.map((g, i) => (
              <SortableChip
                key={g.grade}
                id={g.grade}
                grade={g.grade}
                invalid={gradesServed.length > 0 && !gradesServed.includes(g.grade)}
                canUp={i > 0}
                canDown={i < entry.grades.length - 1}
                disabled={rowDisabled}
                onMove={(dir) => {
                  const ni = i + dir;
                  if (ni < 0 || ni >= entry.grades.length) return;
                  onChange({ ...entry, grades: arrayMove(entry.grades, i, ni) });
                }}
                onRemove={() => onChange({ ...entry, grades: entry.grades.filter(x => x.grade !== g.grade) })}
              />
            ))}
          </SortableContext>
        </DndContext>
        {availableToAdd.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant="outline" disabled={rowDisabled} className="h-6 gap-1 px-1.5 text-[11px]">
                <Plus className="h-3 w-3" /> Add grade
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-1">
              <div className="flex flex-wrap gap-1 max-w-[180px]">
                {availableToAdd.map(g => (
                  <button
                    key={g}
                    type="button"
                    className="rounded bg-secondary px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground"
                    onClick={() => onChange({ ...entry, grades: [...entry.grades, { grade: g }] })}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
        {entry.grades.length === 0 && entry.active && (
          <span className="text-[10px] text-muted-foreground italic">No grades yet — add one</span>
        )}
      </div>

      {entry.active && entry.grades.length > 0 && (
        <div className="pl-10 pt-1">
          <table className="text-[11px] w-full max-w-md">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left font-medium pb-1">Grade</th>
                <th className="text-left font-medium pb-1">Start</th>
                <th className="text-left font-medium pb-1">Duration (min)</th>
                <th className="text-left font-medium pb-1">End</th>
              </tr>
            </thead>
            <tbody>
              {computed.map((row, i) => {
                const startVal = row.slot.startTime ?? (row.startMin != null ? toHHMM(row.startMin) : '');
                const durVal = row.slot.durationMinutes ?? defaultDuration;
                return (
                  <tr key={row.slot.grade}>
                    <td className="pr-2 py-0.5 font-medium">{row.slot.grade}</td>
                    <td className="pr-2 py-0.5">
                      <Input
                        type="time"
                        className="h-6 text-[11px] w-24 px-1"
                        value={startVal}
                        disabled={rowDisabled}
                        onChange={(e) => updateSlot(i, { startTime: e.target.value, userSetTime: true })}
                      />
                    </td>
                    <td className="pr-2 py-0.5">
                      <Input
                        type="number"
                        min={5}
                        max={240}
                        className="h-6 text-[11px] w-16 px-1"
                        value={durVal}
                        disabled={rowDisabled}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          updateSlot(i, { durationMinutes: Number.isFinite(v) && v > 0 ? v : undefined });
                        }}
                      />
                    </td>
                    <td className="pr-2 py-0.5 text-muted-foreground">
                      {row.endMin != null ? toHHMM(row.endMin) : '—'}
                      {row.isUserSet && <span className="ml-1 text-[9px] uppercase">set</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {warnings.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {warnings.map((w, i) => (
                <div key={i} className="text-[10px] text-warning-foreground bg-warning/10 px-1.5 py-0.5 rounded inline-flex items-center gap-1 mr-1">
                  <AlertTriangle className="h-3 w-3" /> {w}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface MatrixProps {
  value: PlusRotation;
  workingDays: string[];
  gradesServed: string[];
  defaultStartTime: string;
  defaultDuration?: number;
  passingTime?: number;
  recessWindows?: RecessWindow[];
  onChange: (next: PlusRotation) => void;
}

export default function PlusRotationMatrix({ value, workingDays, gradesServed, defaultStartTime, defaultDuration = 45, passingTime = 5, recessWindows = [], onChange }: MatrixProps) {
  const [enabled, setEnabled] = useState(() => DAYS.some(d => value[d]?.active));
  const [draft, setDraft] = useState<PlusRotation>(value);

  const handleMasterToggle = (on: boolean) => {
    setEnabled(on);
    if (!on) {
      setDraft(value);
      const next = { ...value };
      for (const d of DAYS) next[d] = { ...next[d], active: false };
      onChange(next);
    } else {
      const next = { ...value };
      for (const d of DAYS) {
        next[d] = { ...next[d], active: draft[d]?.active || false };
      }
      onChange(next);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold text-card-foreground uppercase tracking-wide">PLUS Rotation</h4>
          <p className="text-[10px] text-muted-foreground">Per-day grade order with optional per-grade time slots.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Switch checked={enabled} onCheckedChange={handleMasterToggle} id="plus-master" />
          <label htmlFor="plus-master" className="text-[11px] cursor-pointer">Enable PLUS rotation</label>
        </div>
      </div>
      {!enabled && (
        <div className="rounded border border-dashed border-border bg-muted/30 p-2 text-[11px] text-muted-foreground">
          PLUS rotation disabled — matrix preserved.
        </div>
      )}
      <div className="space-y-1.5">
        {DAYS.map(d => (
          <DayRow
            key={d}
            day={d}
            entry={value[d] || { active: false, startTime: '', grades: [] }}
            isWorkingDay={workingDays.includes(d)}
            gradesServed={gradesServed}
            schoolStart={defaultStartTime}
            defaultDuration={defaultDuration}
            passingTime={passingTime}
            recessWindows={recessWindows}
            disabled={!enabled}
            onChange={(e) => onChange({ ...value, [d]: e })}
          />
        ))}
      </div>
    </div>
  );
}
