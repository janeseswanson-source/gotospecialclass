// BlockInspector — power 3 (explainability) + consolidation of edit/lock/notes.
//
// Selecting a block opens this single side panel, which answers "why is this
// here?" in plain language (placement_reason / ai_explanation, with a
// generate-on-demand fallback), and holds the block's edit, lock/unlock, notes,
// and any conflict action — replacing the scattered EditBlockDialog + notes
// popover + lock toggle. The UI never decides legality; edits persist via the
// caller's validated handlers and conflict fixes go through the engine.

import { useEffect, useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lightbulb, Lock, AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { getSubjectAccentTextClass } from "@/lib/subjectColors";
import { cn } from "@/lib/utils";
import type { BlockData } from "./ScheduleGrid";

interface Specialist { id: string; name: string; subject: string; }

interface BlockInspectorProps {
  block: BlockData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  specialists: Specialist[];
  locked: boolean;
  conflicted: boolean;
  resolvingConflicts?: boolean;
  /** True until AI explanations have been backfilled for the generation. */
  explanationPending?: boolean;
  onSave: (blockId: string, updates: { specialist_id?: string; room?: string; subject?: string }) => void;
  onToggleLock: (blockId: string) => void;
  onNotesChange: (blockId: string, notes: string) => Promise<boolean>;
  onResolveConflicts: () => void;
  onRequestExplain: () => void;
}

export default function BlockInspector({
  block, open, onOpenChange, specialists, locked, conflicted, resolvingConflicts,
  explanationPending, onSave, onToggleLock, onNotesChange, onResolveConflicts, onRequestExplain,
}: BlockInspectorProps) {
  const [specialistId, setSpecialistId] = useState("");
  const [room, setRoom] = useState("");
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  // Re-seed local state whenever a new block is opened.
  useEffect(() => {
    if (block) {
      setSpecialistId("");
      setRoom(block.room ?? "");
      setNotes(block.notes ?? "");
    }
  }, [block?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!block) return null;

  const why = block.ai_explanation ?? block.placement_reason ?? null;
  const title = [block.subject, block.grade && `Grade ${block.grade}`].filter(Boolean).join(" · ") || "Block";

  async function saveNotes() {
    if (!block) return;
    if ((block.notes ?? "") === (notes.trim() ? notes : "")) return;
    setSavingNotes(true);
    await onNotesChange(block.id, notes);
    setSavingNotes(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="space-y-1 text-left">
          <SheetTitle className={cn("text-lg", getSubjectAccentTextClass(block.subject))}>{title}</SheetTitle>
          <SheetDescription className="text-foreground">
            {block.day_of_week} · {block.start_time}–{block.end_time}
            {block.specialist_name ? ` · ${block.specialist_name}` : ""}
            {block.teacher_name ? ` · ${block.teacher_name}` : ""}
            {block.room ? ` · Room ${block.room}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          {/* Conflict action (power 5 entry from a block) */}
          {conflicted && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">This block is double-booked.</p>
                  <p className="text-xs text-muted-foreground">Let the scheduler fix it with the smallest possible change.</p>
                  <Button size="sm" className="mt-2 h-8 gap-1.5" onClick={onResolveConflicts} disabled={resolvingConflicts}>
                    {resolvingConflicts ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
                    Fix conflicts
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Why is this here? (power 3) */}
          <section aria-label="Why this block is here">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500" aria-hidden />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why is this here?</h3>
            </div>
            {why ? (
              <p className="text-sm leading-relaxed text-foreground">{why}</p>
            ) : explanationPending ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Generating an explanation…
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">No explanation recorded for this block yet.</p>
                <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onRequestExplain}>
                  <Sparkles className="h-3.5 w-3.5" aria-hidden /> Generate explanation
                </Button>
              </div>
            )}
          </section>

          <Separator />

          {/* Edit (replaces EditBlockDialog) */}
          <section aria-label="Edit block" className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Edit</h3>
            <div className="space-y-1.5">
              <Label htmlFor="inspector-specialist">Specialist</Label>
              <Select value={specialistId} onValueChange={setSpecialistId}>
                <SelectTrigger id="inspector-specialist"><SelectValue placeholder={block.specialist_name ?? "Select specialist"} /></SelectTrigger>
                <SelectContent>
                  {specialists.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.subject})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inspector-room">Room</Label>
              <Input id="inspector-room" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room" />
            </div>
            <Button
              size="sm"
              className="h-8"
              disabled={!specialistId && room === (block.room ?? "")}
              onClick={() => {
                const spec = specialists.find((s) => s.id === specialistId);
                onSave(block.id, {
                  specialist_id: specialistId || undefined,
                  room: room || undefined,
                  subject: spec?.subject ?? undefined,
                });
              }}
            >
              Save changes
            </Button>
          </section>

          <Separator />

          {/* Lock + Notes */}
          <section aria-label="Lock and notes" className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="inspector-lock" className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> Lock this block
              </Label>
              <Switch id="inspector-lock" checked={locked} onCheckedChange={() => onToggleLock(block.id)} aria-label="Lock this block" />
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">Locked blocks stay put when you edit or replan around them.</p>

            <div className="space-y-1.5">
              <Label htmlFor="inspector-notes">Notes</Label>
              <Textarea
                id="inspector-notes"
                value={notes}
                maxLength={200}
                rows={3}
                placeholder="Add a note for this block (visible on the printed schedule)…"
                onChange={(e) => setNotes(e.target.value)}
                onBlur={saveNotes}
              />
              <p className="text-[11px] text-muted-foreground">
                {savingNotes ? "Saving…" : `${notes.length}/200`}
              </p>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
