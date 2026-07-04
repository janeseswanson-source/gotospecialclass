// Grouped cell renderer for the master grid. Mirrors the reference layout:
//
//   ┌─────────────────────────────────┐
//   │ [Gr] Start–End                  │
//   │ Subject · Teacher               │
//   │ Subject · Teacher               │
//   └─────────────────────────────────┘
//
// One stacked cell per (day, time) — multi-rotation blocks share the cell
// header (grade + time) and render one row per rotation. Duplicate
// rotations (same subject+teacher) are collapsed. Pointer/touch dragging is
// powered by @dnd-kit (each rotation row is a draggable); the tap/keyboard
// "pick up" affordance (GripVertical) remains for accessibility.
import { useDraggable } from "@dnd-kit/core";
import { cn, formatTime } from "@/lib/utils";
import { AlertTriangle, Lock, GripVertical } from "lucide-react";
import { getSubjectLeftBorderClass, getSubjectColorClass } from "@/lib/subjectColors";
import type { BlockData } from "./ScheduleGrid";

interface Props {
  blocks: BlockData[];
  conflictIds: Set<string>;
  lockedIds?: Set<string>;
  highlightIds?: Set<string>;
  /** Ghost preview (proposed AI edits): synthetic dashed destination blocks. */
  ghostIds?: Set<string>;
  /** Origins of proposed moves — faded until Apply/Discard. */
  originIds?: Set<string>;
  /** Blocks proposed for deletion — struck-through until Apply/Discard. */
  deletedIds?: Set<string>;
  onBlockClick?: (b: BlockData) => void;
  onPickUp?: (id: string) => void;
  selectedId?: string | null;
  /** When true, rotation rows are @dnd-kit draggables. */
  dndEnabled?: boolean;
  /** The id currently being pointer-dragged (rendered semi-transparent). */
  activeDragId?: string | null;
}

/** One draggable rotation row. Extracted so `useDraggable` runs at the row level. */
function BlockRow({
  block, teacher, showGrade, differingEnd, isSelected, isLocked, isGhost, isOrigin, isDeleted,
  dndEnabled, isActiveDrag, onBlockClick, onPickUp,
}: {
  block: BlockData;
  teacher: string;
  /** Render this row's own grade chip (multi-grade stacks — the shared header
   *  chip would mislabel the other grades' rows). */
  showGrade: boolean;
  /** This row ends at a different time than the header range (mixed durations
   *  sharing a start slot) — show its own end time so the header doesn't lie. */
  differingEnd: boolean;
  isSelected: boolean;
  isLocked: boolean;
  isGhost: boolean;
  isOrigin: boolean;
  isDeleted: boolean;
  dndEnabled: boolean;
  isActiveDrag: boolean;
  onBlockClick?: (b: BlockData) => void;
  onPickUp?: (id: string) => void;
}) {
  const canDrag = dndEnabled && !isLocked && !isGhost && !isDeleted;
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: block.id,
    data: { block },
    disabled: !canDrag,
  });

  return (
    <li
      ref={setNodeRef}
      onClick={(e) => { e.stopPropagation(); if (!isGhost) onBlockClick?.(block); }}
      className={cn(
        "flex items-center gap-1.5 rounded px-1 py-0.5 cursor-pointer hover:bg-foreground/5 transition-colors motion-reduce:transition-none min-w-0",
        isSelected && "ring-1 ring-primary bg-primary/10",
        canDrag && "active:cursor-grabbing",
        (isDragging || isActiveDrag) && "opacity-40",
        isGhost && "border border-dashed border-primary/50 bg-primary/5 opacity-80 cursor-default",
        isOrigin && !isGhost && "opacity-40",
        isDeleted && "line-through text-destructive/80 opacity-60",
      )}
      title={isGhost ? `Proposed: ${block.subject ?? ""} · ${teacher}` : isDeleted ? `Proposed removal: ${block.subject ?? ""} · ${teacher}` : `${block.subject ?? ""} · ${teacher}`}
    >
      {onPickUp && canDrag && (
        <button
          type="button"
          {...listeners}
          {...attributes}
          onClick={(e) => { e.stopPropagation(); onPickUp(block.id); }}
          className="opacity-0 group-hover:opacity-60 hover:opacity-100 text-muted-foreground cursor-grab touch-none"
          aria-label={`Move ${block.subject ?? "block"}`}
        >
          <GripVertical className="h-3 w-3" />
        </button>
      )}
      {showGrade && block.grade && (
        <span className="shrink-0 rounded bg-primary/15 px-1 text-[9px] font-bold leading-[14px] text-primary uppercase">
          {block.grade}
        </span>
      )}
      <span className="font-semibold text-foreground truncate shrink-0 max-w-[40%]">
        {block.subject ?? "—"}
      </span>
      <span className="text-foreground/65 truncate flex-1 min-w-0">
        {teacher}
      </span>
      {differingEnd && (
        <span className="shrink-0 font-mono text-[9px] text-foreground/55" title={`Ends ${formatTime(block.end_time)}`}>
          →{formatTime(block.end_time)}
        </span>
      )}
      {block.room && (
        <span className="shrink-0 text-[9px] text-foreground/50">{block.room}</span>
      )}
    </li>
  );
}

export default function ScheduleStackCell({
  blocks, conflictIds, lockedIds, highlightIds, ghostIds, originIds, deletedIds,
  onBlockClick, onPickUp, selectedId, dndEnabled, activeDragId,
}: Props) {
  if (!blocks.length) return null;
  // Dedupe by grade + subject + teacher (keep first); preserves order so the
  // grade chip matches the visible top row. Grade is part of the key so two
  // whole-grade blocks (teacher null) with the same subject in DIFFERENT grades
  // both stay visible instead of one silently collapsing into the other.
  const seen = new Set<string>();
  const rows = blocks.filter((b) => {
    const k = `${b.grade ?? ""}|${(b.subject ?? "").toLowerCase()}|${b.teacher_id ?? b.teacher_name ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Header derived from the first row. On the master grid a slot can hold blocks
  // from SEVERAL grades — then a single header chip would mislabel the other
  // rows, so each row carries its own grade chip instead.
  const head = rows[0];
  const start = head.start_time;
  const end = head.end_time;
  const multiGrade = new Set(rows.map((r) => r.grade ?? "")).size > 1;
  const grade = multiGrade ? null : head.grade;
  const week = head.week_label;
  const hasAnyConflict = rows.some((r) => conflictIds.has(r.id));
  const hasAnyLocked = rows.some((r) => lockedIds?.has(r.id));
  const isHighlighted = rows.some((r) => highlightIds?.has(r.id));
  const allGhost = rows.length > 0 && rows.every((r) => ghostIds?.has(r.id));
  const allOrigin = rows.length > 0 && rows.every((r) => originIds?.has(r.id));
  const borderClass = getSubjectLeftBorderClass(head.subject);
  const tintClass = getSubjectColorClass(head.subject);

  return (
    <div
      className={cn(
        "group relative w-full rounded-md border bg-card text-left text-[11px] leading-tight transition-all motion-reduce:transition-none",
        tintClass,
        borderClass,
        hasAnyConflict && !allGhost && "ring-2 ring-destructive/60 border-destructive/50",
        hasAnyLocked && !hasAnyConflict && "ring-1 ring-primary/30",
        isHighlighted && "ring-4 ring-sky-400 ring-offset-1 ring-offset-background z-10",
        allGhost && "border-dashed border-2 border-primary/60 bg-primary/5 opacity-80 pointer-events-none",
        allOrigin && "opacity-40",
      )}
      aria-hidden={allGhost || undefined}
    >
      {/* Header: grade chip + time. */}
      <div className="flex items-center gap-1 px-1.5 pt-1 pb-0.5">
        {grade && (
          <span className="shrink-0 rounded bg-primary/15 px-1 text-[9px] font-bold leading-[14px] text-primary uppercase">
            {grade}
          </span>
        )}
        <span className="font-mono text-[10px] font-semibold text-foreground/80 truncate">
          {formatTime(start)}–{formatTime(end)}
        </span>
        {week && (
          <span className="ml-auto shrink-0 rounded border border-amber-500/40 bg-amber-500/15 px-1 text-[8px] font-bold leading-[12px] text-amber-700 dark:text-amber-300 uppercase">
            {week}
          </span>
        )}
        {hasAnyConflict && (
          <AlertTriangle className="ml-auto h-3 w-3 text-destructive shrink-0" />
        )}
        {hasAnyLocked && !hasAnyConflict && !week && (
          <Lock className="ml-auto h-2.5 w-2.5 text-primary/60 shrink-0" />
        )}
      </div>
      {/* Rotation rows. */}
      <ul className="px-1.5 pb-1 space-y-px">
        {rows.map((b) => (
          <BlockRow
            key={b.id}
            block={b}
            teacher={b.teacher_name ?? b.specialist_name ?? "—"}
            showGrade={multiGrade}
            differingEnd={b.end_time !== end}
            isSelected={selectedId === b.id}
            isLocked={!!lockedIds?.has(b.id)}
            isGhost={!!ghostIds?.has(b.id)}
            isOrigin={!!originIds?.has(b.id)}
            isDeleted={!!deletedIds?.has(b.id)}
            dndEnabled={!!dndEnabled}
            isActiveDrag={activeDragId === b.id}
            onBlockClick={onBlockClick}
            onPickUp={onPickUp}
          />
        ))}
      </ul>
    </div>
  );
}
