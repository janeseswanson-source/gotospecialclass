import { useState, useMemo, useEffect } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { cn, formatTime } from "@/lib/utils";

import ScheduleStackCell from "./ScheduleStackCell";
import ScrabbleTray from "./ScrabbleTray";
import { computeConflictIds, parseTime } from "@/lib/scheduleGrid";
import { legalTargets, type DropEval } from "@/lib/gridTargets";
import { getSubjectLeftBorderClass } from "@/lib/subjectColors";
import { X } from "lucide-react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export interface BlockData {
  id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  subject?: string | null;
  specialist_name?: string | null;
  teacher_name?: string | null;
  room?: string | null;
  grade?: string | null;
  is_override?: boolean;
  week_label?: string | null;
  specialist_id?: string | null;
  teacher_id?: string | null;
  notes?: string | null;
  placement_reason?: string | null;
  ai_explanation?: string | null;
}

export interface RecessBand {
  id: string;
  label: string;
  start_time: string;
  end_time: string;
}

interface ScheduleGridProps {
  blocks: BlockData[];
  timeSlots: string[];
  onBlockClick?: (block: BlockData) => void;
  onBlockDrop?: (blockId: string, newDay: string, newTime: string) => void;
  lockedIds?: Set<string>;
  onToggleLock?: (blockId: string) => void;
  recessBands?: RecessBand[];
  /** School hours — feed the legal-target computation for the drag wash. */
  schoolStart?: string | null;
  schoolEnd?: string | null;
  onNotesChange?: (blockId: string, notes: string) => Promise<boolean> | boolean;
  notesEditable?: boolean;
  /** External conflict set. If omitted, conflicts are computed internally. */
  conflictIds?: Set<string>;
  /** Conflicted blocks to show in a drag-back tray above the grid (master view).
   *  Rendered inside this grid's DndContext so tiles drop onto cells. */
  trayBlocks?: BlockData[];
  /** Block IDs to render as ghosts (e.g. lifted into the Scrabble tray). */
  liftedIds?: Set<string>;
  /** Block IDs recently changed (e.g. by the AI editor) — rendered with a
   *  prominent "changed" highlight so edits are visible at a glance. */
  highlightIds?: Set<string>;
  /** Ghost preview (proposed, unapplied AI edits): synthetic destination blocks. */
  ghostIds?: Set<string>;
  /** Origins of proposed moves — rendered faded until Apply/Discard. */
  originIds?: Set<string>;
  /** Blocks proposed for deletion — rendered struck-through until Apply/Discard. */
  deletedIds?: Set<string>;
  /** Pixel offset for the sticky day-header row. When the grid renders under
   *  another sticky bar (e.g. WeekGrid's tabs at top-0), pass that bar's height
   *  so the Mon–Fri header pins BELOW it instead of sliding underneath. */
  stickyTopOffset?: number;
}

/** A droppable grid cell. Paints the legal-target wash while a drag is active. */
function DroppableCell({
  day, time, children, active, evalResult, moveMode, isMoveSource, onPlace, onKeyPlace,
}: {
  day: string;
  time: string;
  children: React.ReactNode;
  active: boolean;
  evalResult?: DropEval;
  moveMode: boolean;
  isMoveSource: boolean;
  onPlace: () => void;
  onKeyPlace: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${day}|${time}`, data: { day, time } });
  const legal = active && evalResult?.legal;
  const illegal = active && evalResult && !evalResult.legal && evalResult.kind !== "self";
  const showReason = isOver && illegal && !!evalResult?.reason;

  return (
    <td
      ref={setNodeRef}
      role={moveMode ? "button" : undefined}
      tabIndex={moveMode && !isMoveSource ? 0 : undefined}
      aria-label={moveMode && !isMoveSource ? `Drop here: ${day} at ${formatTime(time)}` : undefined}
      className={cn(
        "relative px-1 py-1 align-top transition-colors motion-reduce:transition-none",
        // Legal-target wash (green) + hover emphasis; illegal target dims.
        legal && "bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/40 rounded",
        legal && isOver && "bg-emerald-500/20 ring-2 ring-emerald-500/70",
        illegal && isOver && "bg-destructive/10 ring-2 ring-inset ring-destructive/50 rounded cursor-not-allowed",
        moveMode && !isMoveSource && "cursor-pointer hover:bg-primary/10 hover:ring-2 hover:ring-inset hover:ring-primary/40 focus:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary rounded",
      )}
      onClickCapture={(e) => {
        if (moveMode && !isMoveSource) { e.stopPropagation(); e.preventDefault(); onPlace(); }
      }}
      onKeyDown={(e) => {
        if (moveMode && !isMoveSource && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onKeyPlace(); }
      }}
    >
      {children}
      {showReason && (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-1 top-1 z-30 max-w-[200px] rounded bg-destructive px-2 py-1 text-[10px] font-medium leading-tight text-destructive-foreground shadow-lg"
        >
          {evalResult?.reason}
        </div>
      )}
    </td>
  );
}

export default function ScheduleGrid({
  blocks, timeSlots, onBlockClick, onBlockDrop, lockedIds, onToggleLock,
  recessBands, schoolStart, schoolEnd, onNotesChange, notesEditable, conflictIds,
  trayBlocks, liftedIds, highlightIds, ghostIds, originIds, deletedIds, stickyTopOffset,
}: ScheduleGridProps) {
  // Touch/keyboard "pick up to move": the block waiting for a target slot.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Pointer drag (@dnd-kit): the block currently being dragged + its legal map.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [targets, setTargets] = useState<Map<string, DropEval> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const internalConflicts = useMemo(() => computeConflictIds(blocks), [blocks]);
  const conflicts = conflictIds ?? internalConflicts;

  const selectedBlock = selectedId ? blocks.find((b) => b.id === selectedId) ?? null : null;
  const activeBlock = activeId ? blocks.find((b) => b.id === activeId) ?? null : null;

  // Cancel an in-progress (tap/keyboard) move with Escape.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  const pickUp = (id: string) => setSelectedId((prev) => (prev === id ? null : id));
  const placeInto = (day: string, time: string) => {
    if (!selectedId || !onBlockDrop) return;
    const id = selectedId;
    setSelectedId(null);
    onBlockDrop(id, day, time); // validated swap/move in the parent handler
  };

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setActiveId(id);
    const block = blocks.find((b) => b.id === id);
    if (!block) return;
    // Compute the legal targets ONCE for this drag (SSOT-mirror over the grid).
    setTargets(
      legalTargets({
        block,
        allBlocks: blocks,
        days: DAYS,
        timeSlots,
        lockedIds,
        recessBands: recessBands ?? [],
        schoolStart,
        schoolEnd,
      }),
    );
  }
  function endDrag() { setActiveId(null); setTargets(null); }
  function handleDragEnd(e: DragEndEvent) {
    const id = activeId;
    endDrag();
    if (!id || !onBlockDrop || !e.over) return;
    const data = e.over.data.current as { day?: string; time?: string } | undefined;
    if (data?.day && data?.time) onBlockDrop(id, data.day, data.time);
  }

  /** Return all blocks that *start* in this slot (covers A/B side-by-side). */
  const getBlocks = (day: string, time: string) => {
    const slotMin = parseTime(time);
    return blocks.filter((b) => b.day_of_week === day && parseTime(b.start_time) === slotMin);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={endDrag}
    >
      {trayBlocks && trayBlocks.length > 0 && (
        <div className="mb-3">
          <ScrabbleTray blocks={trayBlocks} activeDragId={activeId} />
        </div>
      )}
      <div className="rounded-xl border border-border bg-card print-full-width">
        {/* Move-mode banner — appears once a block is picked up (tap or keyboard). */}
        {selectedBlock && (
          <div role="status" className="flex items-center gap-2 rounded-t-xl border-b border-primary/30 bg-primary/10 px-3 py-2 text-xs text-foreground">
            <span className="font-medium">
              Moving {selectedBlock.subject ?? "block"}
              {selectedBlock.grade ? ` (Gr. ${selectedBlock.grade})` : ""} — tap any slot to drop it here.
            </span>
            <button type="button" onClick={() => setSelectedId(null)} className="ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground">
              <X className="h-3 w-3" /> Cancel <span className="opacity-60">(Esc)</span>
            </button>
          </div>
        )}
        <table className="w-full text-sm table-fixed" role="grid" aria-label="Master schedule, days across, times down">
          <thead className="sticky z-10 bg-card" style={{ top: stickyTopOffset ?? 0 }}>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-2 py-2 text-left font-medium text-muted-foreground w-16">Time</th>
              {DAYS.map((d) => (
                <th key={d} className="px-2 py-2 text-center font-medium text-muted-foreground">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              type Row = { kind: "slot"; time: string } | { kind: "band"; band: RecessBand };
              const rows: Row[] = [
                ...timeSlots.map((time): Row => ({ kind: "slot", time })),
                ...(recessBands ?? []).map((band): Row => ({ kind: "band", band })),
              ].sort((a, b) => {
                const at = a.kind === "slot" ? parseTime(a.time) : parseTime(a.band.start_time);
                const bt = b.kind === "slot" ? parseTime(b.time) : parseTime(b.band.start_time);
                return at - bt;
              });

              return rows.map((row) => {
                if (row.kind === "band") {
                  const b = row.band;
                  return (
                    <tr key={`band-${b.id}`} className="border-y border-amber-400/40">
                      <td colSpan={DAYS.length + 1} className="bg-amber-100/70 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 font-medium text-xs px-3 py-1.5 tracking-wide">
                        {b.label} · {formatTime(b.start_time)}–{formatTime(b.end_time)}
                      </td>
                    </tr>
                  );
                }
                const time = row.time;
                return (
                  <tr key={time} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-1.5 text-xs text-muted-foreground whitespace-nowrap font-mono">
                      {formatTime(time)}
                    </td>
                    {DAYS.map((day) => {
                      const slotBlocks = getBlocks(day, time).filter((b) => !liftedIds?.has(b.id));
                      const moveMode = !!selectedId && !!onBlockDrop;
                      const isMoveSource = slotBlocks.some((b) => b.id === selectedId);
                      const evalResult = targets?.get(`${day}-${time}`);
                      return (
                        <DroppableCell
                          key={day}
                          day={day}
                          time={time}
                          active={!!activeId}
                          evalResult={evalResult}
                          moveMode={moveMode}
                          isMoveSource={isMoveSource}
                          onPlace={() => placeInto(day, time)}
                          onKeyPlace={() => placeInto(day, time)}
                        >
                          {slotBlocks.length > 0 ? (
                            <ScheduleStackCell
                              blocks={slotBlocks}
                              conflictIds={conflicts}
                              lockedIds={lockedIds}
                              highlightIds={highlightIds}
                              ghostIds={ghostIds}
                              originIds={originIds}
                              deletedIds={deletedIds}
                              onBlockClick={onBlockClick}
                              onPickUp={onBlockDrop ? pickUp : undefined}
                              selectedId={selectedId}
                              dndEnabled={!!onBlockDrop}
                              activeDragId={activeId}
                            />
                          ) : (
                            <div className="h-10 rounded-md bg-muted/20" />
                          )}
                        </DroppableCell>
                      );
                    })}
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
      </div>

      {/* Styled clone that follows the cursor while dragging. */}
      <DragOverlay dropAnimation={null}>
        {activeBlock ? (
          <div className={cn(
            "pointer-events-none w-44 rounded-md border bg-card px-2 py-1.5 text-[11px] shadow-xl ring-2 ring-primary/50",
            getSubjectLeftBorderClass(activeBlock.subject),
          )}>
            <div className="flex items-center gap-1">
              {activeBlock.grade && (
                <span className="rounded bg-primary/15 px-1 text-[9px] font-bold text-primary uppercase">{activeBlock.grade}</span>
              )}
              <span className="font-mono text-[10px] font-semibold text-foreground/80">
                {formatTime(activeBlock.start_time)}–{formatTime(activeBlock.end_time)}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="font-semibold text-foreground truncate">{activeBlock.subject ?? "—"}</span>
              <span className="text-foreground/65 truncate">{activeBlock.teacher_name ?? activeBlock.specialist_name ?? ""}</span>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
