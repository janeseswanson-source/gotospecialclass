import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { exportTeacherPlanner } from "@/lib/exportTeacherPlanner";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string | null;
  generationId: string | null;
}

const WEEK_OPTIONS = [
  { value: "1", label: "1 week", count: 1 },
  { value: "4", label: "4 weeks", count: 4 },
  { value: "36", label: "Full year (~36 weeks)", count: 36 },
];

export default function TeacherPlannerModal({ open, onOpenChange, schoolId, generationId }: Props) {
  const { user } = useAuth();
  const [specialists, setSpecialists] = useState<{ id: string; name: string; subject: string }[]>([]);
  const [specialistId, setSpecialistId] = useState<string>("all");
  const [weeksValue, setWeeksValue] = useState<string>("1");
  const [includeNotesBox, setIncludeNotesBox] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!open || !schoolId) return;
    supabase
      .from("specialists")
      .select("id, name, subject")
      .eq("school_id", schoolId)
      .order("name")
      .then(({ data }) => setSpecialists(data ?? []));
  }, [open, schoolId]);

  const weeksCount = WEEK_OPTIONS.find((w) => w.value === weeksValue)?.count ?? 1;
  const canGenerate = !!schoolId && !!generationId && !!specialistId && weeksCount > 0 && !generating;

  async function handleGenerate() {
    if (!schoolId || !generationId) return;
    if (weeksCount > 12) {
      const specCount = specialistId === "all" ? specialists.length : 1;
      const estPages = specCount * weeksCount;
      if (!window.confirm(`That's ~${estPages} pages — continue?`)) return;
    }
    setGenerating(true);
    const ok = await exportTeacherPlanner({
      schoolId,
      generationId,
      specialistId,
      weeksCount,
      includeNotesBox,
      userId: user?.id,
    });
    setGenerating(false);
    if (ok) {
      toast({ title: "Teacher Planner exported!" });
      onOpenChange(false);
    } else {
      toast({
        title: "Export failed",
        description: "Couldn't generate the planner PDF.",
        variant: "destructive",
        action: (
          <Button size="sm" variant="outline" onClick={handleGenerate}>Retry</Button>
        ) as any,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Teacher Planner (PDF)</DialogTitle>
          <DialogDescription>
            Week-at-a-glance per specialist with space for handwritten notes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label>Specialist</Label>
            <Select value={specialistId} onValueChange={setSpecialistId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose specialist" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All specialists</SelectItem>
                {specialists.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} — {s.subject}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Weeks</Label>
            <RadioGroup value={weeksValue} onValueChange={setWeeksValue} className="space-y-1.5">
              {WEEK_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-center gap-2">
                  <RadioGroupItem value={opt.value} id={`weeks-${opt.value}`} />
                  <Label htmlFor={`weeks-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label htmlFor="notes-toggle" className="cursor-pointer">Include per-day notes box</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Adds a small handwriting area under each day.</p>
            </div>
            <Switch id="notes-toggle" checked={includeNotesBox} onCheckedChange={setIncludeNotesBox} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>Cancel</Button>
          <Button onClick={handleGenerate} disabled={!canGenerate}>
            {generating ? "Generating…" : "Generate PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
