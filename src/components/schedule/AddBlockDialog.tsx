// AddBlockDialog — create a new class tile on an empty grid slot ("CAN the
// SCHEDULER CREATE TIME BLOCKS TO ADD TILES?"). Deliberately dumb: collects the
// specialist + class (a teacher, or a whole grade) + duration and hands the
// payload to the page, which owns legality (placementProblem / computeAutoFit)
// and persistence — the same split every other grid edit uses.
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { formatTime } from "@/lib/utils";

export interface AddBlockPayload {
  specialistId: string;
  /** A classroom teacher id, or null for a whole-grade block. */
  teacherId: string | null;
  grade: string;
  durationMin: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: string;
  time: string; // "HH:MM"
  specialists: { id: string; name: string; subject: string }[];
  teachers: { id: string; name: string; grade: string }[];
  onAdd: (payload: AddBlockPayload) => Promise<boolean>;
}

const GRADE_PREFIX = "grade:";

export default function AddBlockDialog({ open, onOpenChange, day, time, specialists, teachers, onAdd }: Props) {
  const [specialistId, setSpecialistId] = useState<string>("");
  const [classKey, setClassKey] = useState<string>(""); // teacher id or "grade:<g>"
  const [durationMin, setDurationMin] = useState<number>(45);
  const [saving, setSaving] = useState(false);

  // Reset per opening so a previous add doesn't leak into the next slot.
  useEffect(() => {
    if (open) { setSpecialistId(specialists[0]?.id ?? ""); setClassKey(""); setSaving(false); }
  }, [open, specialists]);

  const grades = useMemo(
    () => Array.from(new Set(teachers.map((t) => t.grade).filter(Boolean))).sort(),
    [teachers],
  );
  const spec = specialists.find((s) => s.id === specialistId);

  const submit = async () => {
    if (!specialistId || !classKey) return;
    setSaving(true);
    const isGrade = classKey.startsWith(GRADE_PREFIX);
    const teacher = isGrade ? null : teachers.find((t) => t.id === classKey);
    const ok = await onAdd({
      specialistId,
      teacherId: isGrade ? null : classKey,
      grade: isGrade ? classKey.slice(GRADE_PREFIX.length) : (teacher?.grade ?? ""),
      durationMin,
    });
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="h-4 w-4" /> Add class</DialogTitle>
          <DialogDescription>
            {day} at {formatTime(time)} — pick who teaches and which class comes. The slot is checked
            against the same rules as drag-and-drop before anything is saved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Specialist</label>
            <Select value={specialistId} onValueChange={setSpecialistId}>
              <SelectTrigger><SelectValue placeholder="Pick a specialist…" /></SelectTrigger>
              <SelectContent>
                {specialists.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} ({s.subject})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Class</label>
            <Select value={classKey} onValueChange={setClassKey}>
              <SelectTrigger><SelectValue placeholder="Pick a class…" /></SelectTrigger>
              <SelectContent>
                {teachers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name} (Gr {t.grade})</SelectItem>
                ))}
                {grades.map((g) => (
                  <SelectItem key={`${GRADE_PREFIX}${g}`} value={`${GRADE_PREFIX}${g}`}>Whole grade {g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Length</label>
            <Select value={String(durationMin)} onValueChange={(v) => setDurationMin(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[30, 40, 45, 50, 60].map((d) => (
                  <SelectItem key={d} value={String(d)}>{d} min</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !specialistId || !classKey}>
            {saving ? "Adding…" : `Add ${spec?.subject ?? "class"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
