import { useDraggable } from "@dnd-kit/core";
import { GripVertical, AlertTriangle } from "lucide-react";
import { cn, formatTime } from "@/lib/utils";
import type { BlockData } from "./ScheduleGrid";

interface ScrabbleTrayProps {
  blocks: BlockData[];
  /** The id currently being pointer-dragged (rendered semi-transparent). */
  activeDragId?: string | null;
}

/** One draggable Scrabble tile (a conflicted block waiting to be re-placed). */
function TrayTile({ block, isActiveDrag }: { block: BlockData; isActiveDrag: boolean }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: block.id, data: { block } });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "group relative w-44 cursor-grab touch-none active:cursor-grabbing select-none",
        "rounded-md border-2 border-amber-800/50 bg-amber-50 dark:bg-amber-100/90",
        "shadow-[inset_0_-3px_0_rgba(120,53,15,0.35),0_2px_4px_rgba(0,0,0,0.15)]",
        "hover:-translate-y-0.5 hover:shadow-[inset_0_-3px_0_rgba(120,53,15,0.35),0_4px_8px_rgba(0,0,0,0.2)] transition-all motion-reduce:transition-none",
        "px-2.5 py-2",
        (isDragging || isActiveDrag) && "opacity-40",
      )}
      title={`${block.subject} · ${block.day_of_week} ${formatTime(block.start_time)}`}
    >
      <GripVertical className="absolute left-0.5 top-1/2 -translate-y-1/2 h-3 w-3 text-amber-900/40 group-hover:text-amber-900/70" />
      <div className="pl-3 text-amber-950">
        <p className="text-xs font-bold truncate">{block.subject ?? "—"}</p>
        {block.grade && <p className="text-[10px] font-medium opacity-80">Gr. {block.grade}</p>}
        {block.teacher_name && <p className="text-[10px] truncate opacity-80">{block.teacher_name}</p>}
        {block.specialist_name && <p className="text-[10px] truncate opacity-70">{block.specialist_name}</p>}
        <p className="text-[10px] opacity-60 mt-0.5">
          {block.day_of_week} · {formatTime(block.start_time)}
        </p>
      </div>
    </div>
  );
}

/**
 * "Scrabble tray" of conflicted blocks the user can drag back into the grid.
 * Rendered INSIDE the grid's DndContext so tiles drop onto grid cells.
 */
export default function ScrabbleTray({ blocks, activeDragId }: ScrabbleTrayProps) {
  if (blocks.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-700/40 bg-gradient-to-b from-amber-100 to-amber-200 dark:from-amber-900/40 dark:to-amber-950/60 p-3 shadow-inner no-print">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200 uppercase tracking-wide">
          <AlertTriangle className="h-3.5 w-3.5" />
          Conflicted Blocks — drag to a free slot
        </div>
        <span className="text-[10px] text-amber-800/70 dark:text-amber-200/60">
          {blocks.length} tile{blocks.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {blocks.map((b) => (
          <TrayTile key={b.id} block={b} isActiveDrag={activeDragId === b.id} />
        ))}
      </div>
    </div>
  );
}
