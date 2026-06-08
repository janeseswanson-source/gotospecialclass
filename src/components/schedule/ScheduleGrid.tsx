import { useState, useMemo } from "react";
import { cn, formatTime } from "@/lib/utils";
import ScheduleBlockCell from "./ScheduleBlockCell";
import { computeConflictIds, parseTime } from "@/lib/scheduleGrid";

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
}

export default function ScheduleGrid({
  blocks, timeSlots, onBlockClick, onBlockDrop, lockedIds, onToggleLock,
  recessBands, onNotesChange, notesEditable, conflictIds, liftedIds,
}: ScheduleGridProps) {
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);

  const internalConflicts = useMemo(() => computeConflictIds(blocks), [blocks]);
  const conflicts = conflictIds ?? internalConflicts;

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
    <div className="overflow-x-auto rounded-xl border border-border bg-card print-full-width">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground w-20">Time</th>
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
                    return (
                      <td
                        key={day}
                        className={cn(
                          "px-1 py-1 transition-colors align-top",
                          isOver && "bg-primary/10 ring-2 ring-inset ring-primary/40 rounded",
                        )}
                        onDragOver={handleDragOver}
                        onDragEnter={() => setDragOverCell(key)}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCell(null);
                        }}
                        onDrop={(e) => handleDrop(e, day, time)}
                      >
                        {slotBlocks.length > 0 ? (
                          <div className={cn("flex gap-1", slotBlocks.length > 1 && "items-stretch")}>
                            {slotBlocks.map((block) => (
                              <div key={block.id} className={slotBlocks.length > 1 ? "flex-1 min-w-0" : "w-full"}>
                                <ScheduleBlockCell
                                  blockId={block.id}
                                  subject={block.subject}
                                  specialistName={block.specialist_name}
                                  teacherName={block.teacher_name}
                                  room={block.room}
                                  grade={block.grade}
                                  startTime={block.start_time}
                                  endTime={block.end_time}
                                  isOverride={block.is_override}
                                  hasConflict={conflicts.has(block.id)}
                                  isLocked={lockedIds?.has(block.id)}
                                  onToggleLock={onToggleLock ? () => onToggleLock(block.id) : undefined}
                                  onClick={() => onBlockClick?.(block)}
                                  draggable={!!onBlockDrop}
                                  onDragStart={(e) => handleDragStart(e, block)}
                                  weekLabel={block.week_label}
                                  notes={block.notes}
                                  onNotesChange={notesEditable ? onNotesChange : undefined}
                                />
                              </div>
                            ))}
                          </div>
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
