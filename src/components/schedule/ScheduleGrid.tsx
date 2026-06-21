import { useState, useMemo, useEffect } from "react";
import { cn, formatTime } from "@/lib/utils";
import ScheduleBlockCell from "./ScheduleBlockCell";
import ScheduleStackCell from "./ScheduleStackCell";
import { computeConflictIds, parseTime } from "@/lib/scheduleGrid";
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
  onNotesChange?: (blockId: string, notes: string) => Promise<boolean> | boolean;
  notesEditable?: boolean;
  /** External conflict set. If omitted, conflicts are computed internally. */
  conflictIds?: Set<string>;
  /** Block IDs to render as ghosts (e.g. lifted into the Scrabble tray). */
  liftedIds?: Set<string>;
  /** Block IDs recently changed (e.g. by the AI editor) — rendered with a
   *  prominent "changed" highlight so edits are visible at a glance. */
  highlightIds?: Set<string>;
}

export default function ScheduleGrid({
  blocks, timeSlots, onBlockClick, onBlockDrop, lockedIds, onToggleLock,
  recessBands, onNotesChange, notesEditable, conflictIds, liftedIds, highlightIds,
}: ScheduleGridProps) {
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  // Touch/keyboard "pick up to move": the block waiting for a target slot.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const internalConflicts = useMemo(() => computeConflictIds(blocks), [blocks]);
  const conflicts = conflictIds ?? internalConflicts;

  const selectedBlock = selectedId ? blocks.find((b) => b.id === selectedId) ?? null : null;

  // Cancel an in-progress move with Escape.
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

  /** Return all blocks that *start* in this slot (covers A/B side-by-side). */
  const getBlocks = (day: string, time: string) => {
    const slotMin = parseTime(time);
    return blocks.filter(
      (b) => b.day_of_week === day && parseTime(b.start_time) === slotMin,
    );
  };

  function handleDragStart(e: React.DragEvent, block: BlockData) {
    e.dataTransfer.setData("text/plain", block.id);
    e.dataTransfer.effectAllowed = "move";
  }
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }
  function handleDrop(e: React.DragEvent, day: string, time: string) {
    e.preventDefault();
    setDragOverCell(null);
    const blockId = e.dataTransfer.getData("text/plain");
    if (blockId && onBlockDrop) onBlockDrop(blockId, day, time);
  }
  const cellKey = (day: string, time: string) => `${day}-${time}`;

  return (
    <div className="rounded-xl border border-border bg-card print-full-width">
      {/* Move-mode banner — appears once a block is picked up (tap or keyboard). */}
      {selectedBlock && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-t-xl border-b border-primary/30 bg-primary/10 px-3 py-2 text-xs text-foreground"
        >
          <span className="font-medium">
            Moving {selectedBlock.subject ?? "block"}
            {selectedBlock.grade ? ` (Gr. ${selectedBlock.grade})` : ""} — tap any slot to drop it here.
          </span>
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground"
          >
            <X className="h-3 w-3" /> Cancel <span className="opacity-60">(Esc)</span>
          </button>
        </div>
      )}
      <table className="w-full text-sm table-fixed" role="grid" aria-label="Master schedule, days across, times down">
        <thead className="sticky top-0 z-10 bg-card">
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
                    <td
                      colSpan={DAYS.length + 1}
                      className="bg-amber-100/70 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 font-medium text-xs px-3 py-1.5 tracking-wide"
                    >
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
                    const key = cellKey(day, time);
                    const isOver = dragOverCell === key;
                    // In move-mode, every cell becomes a tap/keyboard drop target.
                    const moveMode = !!selectedId && !!onBlockDrop;
                    const isMoveSource = slotBlocks.some((b) => b.id === selectedId);
                    return (
                      <td
                        key={day}
                        role={moveMode ? "button" : undefined}
                        tabIndex={moveMode && !isMoveSource ? 0 : undefined}
                        aria-label={moveMode && !isMoveSource ? `Drop here: ${day} at ${formatTime(time)}` : undefined}
                        className={cn(
                          "px-1 py-1 transition-colors align-top",
                          isOver && "bg-primary/10 ring-2 ring-inset ring-primary/40 rounded",
                          moveMode && !isMoveSource && "cursor-pointer hover:bg-primary/10 hover:ring-2 hover:ring-inset hover:ring-primary/40 focus:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary rounded",
                        )}
                        onClickCapture={(e) => {
                          if (moveMode && !isMoveSource) { e.stopPropagation(); e.preventDefault(); placeInto(day, time); }
                        }}
                        onKeyDown={(e) => {
                          if (moveMode && !isMoveSource && (e.key === "Enter" || e.key === " ")) {
                            e.preventDefault(); placeInto(day, time);
                          }
                        }}
                        onDragOver={handleDragOver}
                        onDragEnter={() => setDragOverCell(key)}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCell(null);
                        }}
                        onDrop={(e) => handleDrop(e, day, time)}
                      >
                        {slotBlocks.length > 0 ? (
                          <ScheduleStackCell
                            blocks={slotBlocks}
                            conflictIds={conflicts}
                            lockedIds={lockedIds}
                            highlightIds={highlightIds}
                            onBlockClick={onBlockClick}
                            onPickUp={onBlockDrop ? pickUp : undefined}
                            selectedId={selectedId}
                            draggable={!!onBlockDrop}
                            onDragStart={handleDragStart}
                          />
                        ) : (
                          <div className="h-10 rounded-md bg-muted/20" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            });
          })()}
        </tbody>
      </table>
    </div>
  );
}
