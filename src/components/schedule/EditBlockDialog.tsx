import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lightbulb } from "lucide-react";
import type { BlockData } from "./ScheduleGrid";

interface Specialist { id: string; name: string; subject: string; }

interface EditBlockDialogProps {
  block: BlockData | null;
  specialists: Specialist[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (blockId: string, updates: { specialist_id?: string; room?: string; subject?: string }) => void;
}

export default function EditBlockDialog({ block, specialists, open, onOpenChange, onSave }: EditBlockDialogProps) {
  const [selectedSpecialist, setSelectedSpecialist] = useState("");
  const [room, setRoom] = useState("");

  const handleOpen = (isOpen: boolean) => {
    if (isOpen && block) {
      setRoom(block.room ?? "");
      setSelectedSpecialist("");
    }
    onOpenChange(isOpen);
  };

  if (!block) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Schedule Block</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="text-xs text-muted-foreground">
            {block.day_of_week} · {block.start_time}–{block.end_time}
          </div>
          <div className="space-y-2">
            <Label>Specialist</Label>
            <Select value={selectedSpecialist} onValueChange={setSelectedSpecialist}>
              <SelectTrigger><SelectValue placeholder={block.specialist_name ?? "Select specialist"} /></SelectTrigger>
              <SelectContent>
                {specialists.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} ({s.subject})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Room</Label>
            <Input value={room} onChange={(e) => setRoom(e.target.value)} />
          </div>
          {block.placement_reason && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <Lightbulb className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Why here</p>
                <p className="text-xs text-foreground">{block.placement_reason}</p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => {
            const spec = specialists.find((s) => s.id === selectedSpecialist);
            onSave(block.id, {
              specialist_id: selectedSpecialist || undefined,
              room: room || undefined,
              subject: spec?.subject ?? undefined,
            });
            onOpenChange(false);
          }}>
            Save Override
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
