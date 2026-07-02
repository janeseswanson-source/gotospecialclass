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
// rotations (same subject+teacher) are collapsed.
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
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, b: BlockData) => void;
}

export default function ScheduleStackCell({
  blocks, conflictIds, lockedIds, highlightIds, ghostIds, originIds, deletedIds,
  onBlockClick, onPickUp, selectedId, draggable, onDragStart,
}: Props) {
  if (!blocks.length) return null;
  // Dedupe by subject + teacher (keep first); preserves order so the grade chip
  // matches the visible top row.
  const seen = new Set<string>();
  const rows = blocks.filter((b) => {
    const k = `${(b.subject ?? "").toLowerCase()}|${b.teacher_id ?? b.teacher_name ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Header derived from the first row.
  const head = rows[0];
  const start = head.start_time;
  const end = head.end_time;
  const grade = head.grade;
  const week = head.week_label;
  const hasAnyConflict = rows.some((r) => conflictIds.has(r.id));
  const hasAnyLocked = rows.some((r) => lockedIds?.has(r.id));
  const isHighlighted = rows.some((r) => highlightIds?.has(r.id));
  // Ghost preview: an all-ghost cell renders dashed + non-interactive (a proposed
  // destination); an all-origin cell fades (its content is moving away).
  const allGhost = rows.length > 0 && rows.every((r) => ghostIds?.has(r.id));
  const allOrigin = rows.length > 0 && rows.every((r) => originIds?.has(r.id));
  // Border-accent color comes from the first row's subject — keeps the cell
  // visually anchored to its dominant subject.
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
        {rows.map((b) => {
          const isSelected = selectedId === b.id;
          const isLocked = lockedIds?.has(b.id);
          const isGhost = ghostIds?.has(b.id);
          const isOrigin = originIds?.has(b.id);
          const isDeleted = deletedIds?.has(b.id);
          const teacher = b.teacher_name ?? b.specialist_name ?? "—";
          return (
            <li
              key={b.id}
              draggable={draggable && !isLocked && !isGhost && !isDeleted}
              onDragStart={(e) => onDragStart?.(e, b)}
              onClick={(e) => { e.stopPropagation(); if (!isGhost) onBlockClick?.(b); }}
              className={cn(
                "flex items-center gap-1.5 rounded px-1 py-0.5 cursor-pointer hover:bg-foreground/5 transition-colors motion-reduce:transition-none min-w-0",
                isSelected && "ring-1 ring-primary bg-primary/10",
                draggable && !isLocked && !isGhost && !isDeleted && "active:cursor-grabbing",
                isGhost && "border border-dashed border-primary/50 bg-primary/5 opacity-80 cursor-default",
                isOrigin && !isGhost && "opacity-40",
                isDeleted && "line-through text-destructive/80 opacity-60",
              )}
              title={isGhost ? `Proposed: ${b.subject ?? ""} · ${teacher}` : isDeleted ? `Proposed removal: ${b.subject ?? ""} · ${teacher}` : `${b.subject ?? ""} · ${teacher}`}
            >
              {onPickUp && draggable && !isLocked && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onPickUp(b.id); }}
                  className="opacity-0 group-hover:opacity-60 hover:opacity-100 text-muted-foreground"
                  aria-label={`Move ${b.subject ?? "block"}`}
                >
                  <GripVertical className="h-3 w-3" />
                </button>
              )}
              <span className="font-semibold text-foreground truncate shrink-0 max-w-[40%]">
                {b.subject ?? "—"}
              </span>
              <span className="text-foreground/65 truncate flex-1 min-w-0">
                {teacher}
              </span>
              {b.room && (
                <span className="shrink-0 text-[9px] text-foreground/50">{b.room}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
