import { useState, useRef, useEffect } from "react";
import { cn, formatTime } from "@/lib/utils";
import { Pencil, GripVertical, AlertTriangle, Lock, LockOpen, MessageSquare } from "lucide-react";
import { getSubjectColorClass, getSubjectLeftBorderClass } from "@/lib/subjectColors";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

const getColorClass = getSubjectColorClass;
const getLeftBorder = getSubjectLeftBorderClass;
const NOTES_LIMIT = 200;

interface ScheduleBlockCellProps {
  blockId?: string;
  subject?: string | null;
  specialistName?: string | null;
  teacherName?: string | null;
  room?: string | null;
  grade?: string | null;
  startTime: string;
  endTime: string;
  isOverride?: boolean;
  hasConflict?: boolean;
  isLocked?: boolean;
  /** Recently changed (e.g. by the AI editor) — rendered with a visible highlight. */
  isHighlighted?: boolean;
  onToggleLock?: () => void;
  onClick?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  /** Touch/keyboard "pick up to move" — toggles this block as the one being moved. */
  onPickUp?: () => void;
  /** This block is currently picked up (waiting for a target slot). */
  isSelected?: boolean;
  weekLabel?: string | null;
  notes?: string | null;
  onNotesChange?: (blockId: string, notes: string) => Promise<boolean> | boolean;
}

function durationMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
}

export default function ScheduleBlockCell({
  blockId, subject, specialistName, teacherName, room, grade, startTime, endTime, isOverride, hasConflict,
  isLocked, isHighlighted, onToggleLock, onClick, draggable, onDragStart, onPickUp, isSelected, weekLabel, notes, onNotesChange,
}: ScheduleBlockCellProps) {
  const iconOffset = weekLabel ? "right-7" : "right-1";
  const isA = weekLabel ? /^A/i.test(weekLabel) : false;
  const hasNotes = !!(notes && notes.trim());
  const trimmedNotesPreview = hasNotes ? (notes as string).trim() : "";

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(notes ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const savedRef = useRef(notes ?? "");

  useEffect(() => {
    setDraft(notes ?? "");
    savedRef.current = notes ?? "";
  }, [notes]);

  async function commit() {
    if (!onNotesChange || !blockId) return;
    const next = draft.slice(0, NOTES_LIMIT).trim();
    if (next === (savedRef.current ?? "").trim()) {
      setStatus("idle");
      return;
    }
    setStatus("saving");
    const prev = savedRef.current;
    savedRef.current = next;
    try {
      const ok = await onNotesChange(blockId, next);
      if (ok === false) throw new Error("save failed");
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1200);
    } catch {
      savedRef.current = prev;
      setDraft(prev);
      setStatus("error");
    }
  }

  // Height scales with duration so a 30-min and a 90-min block are visually
  // distinguishable at a glance (clamped so short blocks stay readable).
  const minHeightPx = Math.min(150, Math.max(48, durationMinutes(startTime, endTime) * 1.1));

  return (
    <button
      onClick={onClick}
      draggable={draggable && !isLocked}
      onDragStart={onDragStart}
      style={{ minHeight: `${minHeightPx}px` }}
      aria-label={`${subject ?? "Block"}${grade ? `, grade ${grade}` : ""}${teacherName ? `, ${teacherName}` : ""}, ${formatTime(startTime)} to ${formatTime(endTime)}${isLocked ? ", locked" : ""}${hasConflict ? ", has a conflict" : ""}`}
      className={cn(
        "relative w-full rounded-md border px-2 py-1.5 text-left text-xs transition-all hover:shadow-md group",
        draggable && !isLocked && "cursor-grab active:cursor-grabbing",
        getColorClass(subject),
        getLeftBorder(subject),
        hasConflict && "ring-2 ring-destructive/60 border-destructive/50",
        isLocked && "ring-2 ring-primary/40 opacity-90",
        isSelected && "ring-2 ring-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.25)] animate-pulse",
        isHighlighted && "ring-4 ring-sky-400 ring-offset-1 ring-offset-background animate-ai-changed z-10",
      )}
    >
      {isHighlighted && (
        <span className="absolute -top-2 left-2 z-10 rounded bg-sky-500 px-1.5 py-px text-[8px] font-bold uppercase tracking-wide text-white shadow-lg shadow-sky-500/50 animate-pulse">
          ✨ Changed
        </span>
      )}
      {/* Pick-up handle: works for touch + keyboard (mouse can still drag the block). */}
      {onPickUp && draggable && !isLocked && (
        <button
          type="button"
          aria-label={isSelected ? `Cancel moving ${subject ?? "block"}` : `Move ${subject ?? "block"}`}
          aria-pressed={isSelected}
          title={isSelected ? "Cancel move" : "Move block"}
          onClick={(e) => { e.stopPropagation(); onPickUp(); }}
          className={cn(
            "absolute left-0 top-1/2 -translate-y-1/2 z-10 inline-flex h-6 w-5 items-center justify-center rounded transition-opacity touch-none",
            isSelected ? "opacity-100 text-primary" : "opacity-30 group-hover:opacity-70 hover:opacity-100",
          )}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}
      {weekLabel && (
        <span className={cn(
          "absolute right-1 top-1 text-[9px] font-bold px-1 py-px rounded leading-none border",
          isA
            ? "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30"
            : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
        )}>
          {weekLabel.toUpperCase()}
        </span>
      )}
      {hasConflict && (
        <AlertTriangle className={cn("absolute top-1 h-3 w-3 text-destructive", iconOffset)} />
      )}
      {onToggleLock && !hasConflict && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
          className={cn("absolute top-1 h-4 w-4 opacity-0 group-hover:opacity-70 hover:opacity-100 transition-opacity", iconOffset)}
          title={isLocked ? "Unlock block" : "Lock block"}
        >
          {isLocked ? <Lock className="h-3 w-3 text-primary" /> : <LockOpen className="h-3 w-3 text-muted-foreground" />}
        </button>
      )}
      <p className="font-semibold truncate">{subject ?? "—"}</p>
      {teacherName && (
        <p className="truncate text-[11px] font-medium text-foreground/85">
          {teacherName}{grade ? ` · Gr. ${grade}` : ''}
        </p>
      )}
      {!teacherName && grade && <p className="truncate font-medium text-[10px] print:text-muted-foreground/60">Gr. {grade}</p>}
      {specialistName && <p className="truncate text-[10px] text-muted-foreground">{specialistName}</p>}
      <p
        className="mt-0.5 text-[10px] opacity-50 group-hover:opacity-90 transition-opacity"
        title={`${formatTime(startTime)}–${formatTime(endTime)}`}
      >
        {formatTime(startTime)}–{formatTime(endTime)} {room && `· ${room}`}
      </p>
      {hasNotes && !onNotesChange && (
        <p
          className="mt-0.5 italic text-[10px] truncate opacity-80"
          title={trimmedNotesPreview}
        >
          {trimmedNotesPreview.length > 40 ? trimmedNotesPreview.slice(0, 40) + "…" : trimmedNotesPreview}
        </p>
      )}
      {isOverride && !hasConflict && !onToggleLock && (
        <Pencil className={cn("absolute top-1 h-3 w-3 opacity-50", iconOffset)} />
      )}
      {isLocked && (
        <Lock className="absolute left-1 bottom-1 h-2.5 w-2.5 text-primary/60" />
      )}

      {onNotesChange && blockId && (
        <span
          className="absolute bottom-0.5 right-0.5"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Popover open={open} onOpenChange={(o) => {
            setOpen(o);
            if (!o) commit();
          }}>
            <PopoverTrigger asChild>
              <span
                role="button"
                tabIndex={0}
                title={hasNotes ? trimmedNotesPreview : "Add notes"}
                onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); } }}
                className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded transition-colors",
                  hasNotes
                    ? "text-primary opacity-90"
                    : "text-muted-foreground opacity-0 group-hover:opacity-60 hover:opacity-100",
                )}
              >
                <MessageSquare className={cn("h-3 w-3", hasNotes && "fill-current")} />
              </span>
            </PopoverTrigger>
            <PopoverContent
              className="w-72 p-3"
              onClick={(e) => e.stopPropagation()}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-foreground">Notes (optional)</label>
                  <span className={cn(
                    "text-[10px]",
                    status === "saving" ? "text-muted-foreground" :
                    status === "saved" ? "text-emerald-600 dark:text-emerald-400" :
                    status === "error" ? "text-destructive" :
                    "text-muted-foreground",
                  )}>
                    {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Save failed" : ""}
                  </span>
                </div>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, NOTES_LIMIT))}
                  onBlur={() => commit()}
                  placeholder="Anything to remember about this block? (e.g. bring supplies, combined class, room change)"
                  rows={4}
                  maxLength={NOTES_LIMIT}
                  className="text-xs resize-none"
                  autoFocus
                />
                <div className="flex justify-end text-[10px] text-muted-foreground">
                  {draft.length}/{NOTES_LIMIT}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </span>
      )}
    </button>
  );
}
