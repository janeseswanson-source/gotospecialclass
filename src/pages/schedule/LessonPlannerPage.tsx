import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, NotebookPen, CheckCircle2, FileText } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatTime, cn } from "@/lib/utils";
import { getSubjectBadgeClass } from "@/lib/subjectColors";
import BrandedScheduleHeader from "@/components/schedule/BrandedScheduleHeader";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

interface BlockRow {
  id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  subject: string | null;
  grade: string | null;
  specialist_id: string | null;
  teacher_id: string | null;
  room: string | null;
}
interface SpecialistRow { id: string; name: string; subject: string; }
interface LessonPlan {
  id: string;
  block_id: string | null;
  title: string;
  objective: string | null;
  materials: string | null;
  activities: any;
  standards: string[];
  notes: string | null;
  plan_date: string | null;
}

const emptyDraft = (): Omit<LessonPlan, "id"> => ({
  block_id: null,
  title: "",
  objective: "",
  materials: "",
  activities: [],
  standards: [],
  notes: "",
  plan_date: null,
});

export default function LessonPlannerPage() {
  const { selectedSchoolId } = useSchool();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [specialists, setSpecialists] = useState<SpecialistRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [plansByBlock, setPlansByBlock] = useState<Record<string, LessonPlan>>({});
  const [filterSpecialist, setFilterSpecialist] = useState<string>("all");
  const [filterDay, setFilterDay] = useState<string>("all");
  const [openBlock, setOpenBlock] = useState<BlockRow | null>(null);
  const [draft, setDraft] = useState<Omit<LessonPlan, "id"> & { id?: string }>(emptyDraft());
  const [standardsInput, setStandardsInput] = useState("");

  useEffect(() => {
    if (!selectedSchoolId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [specRes, genRes, plansRes] = await Promise.all([
        supabase.from("specialists").select("id,name,subject").eq("school_id", selectedSchoolId),
        supabase.from("schedule_generations").select("id").eq("school_id", selectedSchoolId).order("created_at", { ascending: false }).limit(1),
        supabase.from("lesson_plans").select("*").eq("school_id", selectedSchoolId),
      ]);
      if (cancelled) return;
      setSpecialists(specRes.data ?? []);
      const genId = genRes.data?.[0]?.id;
      if (genId) {
        const { data: bs } = await supabase
          .from("schedule_blocks")
          .select("id,day_of_week,start_time,end_time,subject,grade,specialist_id,teacher_id,room")
          .eq("generation_id", genId);
        if (!cancelled) setBlocks(bs ?? []);
      } else {
        setBlocks([]);
      }
      const map: Record<string, LessonPlan> = {};
      (plansRes.data ?? []).forEach((p: any) => { if (p.block_id) map[p.block_id] = p; });
      setPlansByBlock(map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedSchoolId]);

  const filtered = useMemo(() => {
    return blocks
      .filter(b => filterSpecialist === "all" || b.specialist_id === filterSpecialist)
      .filter(b => filterDay === "all" || b.day_of_week === filterDay)
      .sort((a, b) => {
        const d = DAYS.indexOf(a.day_of_week) - DAYS.indexOf(b.day_of_week);
        if (d !== 0) return d;
        return a.start_time.localeCompare(b.start_time);
      });
  }, [blocks, filterSpecialist, filterDay]);

  const specialistName = (id: string | null) =>
    id ? specialists.find(s => s.id === id)?.name ?? "—" : "—";

  function openEditor(block: BlockRow) {
    const existing = plansByBlock[block.id];
    setOpenBlock(block);
    if (existing) {
      setDraft({ ...existing });
      setStandardsInput(existing.standards.join(", "));
    } else {
      setDraft({
        ...emptyDraft(),
        block_id: block.id,
        title: `${block.subject ?? "Lesson"} — Gr. ${block.grade ?? ""}`.trim(),
      });
      setStandardsInput("");
    }
  }

  async function saveDraft() {
    if (!openBlock || !selectedSchoolId) return;
    setSaving(true);
    const standards = standardsInput.split(",").map(s => s.trim()).filter(Boolean);
    const payload: any = {
      school_id: selectedSchoolId,
      block_id: openBlock.id,
      specialist_id: openBlock.specialist_id,
      title: draft.title || "Untitled lesson",
      objective: draft.objective || null,
      materials: draft.materials || null,
      activities: draft.activities ?? [],
      standards,
      notes: draft.notes || null,
      plan_date: draft.plan_date || null,
      created_by: user?.id ?? null,
    };
    let saved: LessonPlan | null = null;
    if (draft.id) {
      const { data, error } = await supabase.from("lesson_plans").update(payload).eq("id", draft.id).select().single();
      if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); setSaving(false); return; }
      saved = data as any;
    } else {
      const { data, error } = await supabase.from("lesson_plans").insert(payload).select().single();
      if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); setSaving(false); return; }
      saved = data as any;
    }
    if (saved) setPlansByBlock(prev => ({ ...prev, [openBlock.id]: saved! }));
    toast({ title: "Lesson plan saved" });
    setSaving(false);
    setOpenBlock(null);
  }

  async function deletePlan() {
    if (!draft.id || !openBlock) return;
    const { error } = await supabase.from("lesson_plans").delete().eq("id", draft.id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    setPlansByBlock(prev => { const cp = { ...prev }; delete cp[openBlock.id]; return cp; });
    toast({ title: "Lesson plan removed" });
    setOpenBlock(null);
  }

  if (!selectedSchoolId) {
    return <div className="p-6 text-sm text-muted-foreground">Select a school to start planning lessons.</div>;
  }

  const activeSchool = useSchool().schools.find((s) => s.id === selectedSchoolId);

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <BrandedScheduleHeader
        title="Lesson Planner"
        subtitle="Specialist Ops! · Plan Weekly Sessions"
        schoolName={activeSchool?.name}
        schoolYear={(activeSchool as any)?.school_year ?? undefined}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <NotebookPen className="h-6 w-6 text-primary" />
            Lesson Planner
          </h1>
          <p className="text-sm text-muted-foreground">
            Plan objectives, materials, activities and standards for each scheduled block.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={filterSpecialist} onValueChange={setFilterSpecialist}>
            <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All specialists" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All specialists</SelectItem>
              {specialists.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterDay} onValueChange={setFilterDay}>
            <SelectTrigger className="w-32 h-9"><SelectValue placeholder="All days" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All days</SelectItem>
              {DAYS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          <BookOpen className="mx-auto h-8 w-8 mb-2 opacity-50" />
          No scheduled blocks found. Generate a schedule first to start planning lessons.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(b => {
            const plan = plansByBlock[b.id];
            const has = !!plan;
            return (
              <button
                key={b.id}
                onClick={() => openEditor(b)}
                className={cn(
                  "text-left rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5",
                  has ? "border-primary/40 ring-1 ring-primary/20" : "border-border"
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <Badge className={cn("text-[10px]", getSubjectBadgeClass(b.subject ?? ""))}>
                    {b.subject ?? "—"}
                  </Badge>
                  {has ? (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Planned
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">No plan</span>
                  )}
                </div>
                <p className="text-sm font-semibold truncate">
                  {plan?.title || `Gr. ${b.grade ?? "—"} · ${specialistName(b.specialist_id)}`}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {b.day_of_week} · {formatTime(b.start_time)}–{formatTime(b.end_time)}
                  {b.room ? ` · ${b.room}` : ""}
                </p>
                {plan?.objective && (
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                    <FileText className="inline h-3 w-3 mr-1" />
                    {plan.objective}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={!!openBlock} onOpenChange={(o) => !o && setOpenBlock(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <NotebookPen className="h-5 w-5" />
              {draft.id ? "Edit Lesson Plan" : "New Lesson Plan"}
            </DialogTitle>
            {openBlock && (
              <p className="text-xs text-muted-foreground">
                {openBlock.subject} · Gr. {openBlock.grade} · {openBlock.day_of_week} {formatTime(openBlock.start_time)}–{formatTime(openBlock.end_time)}
              </p>
            )}
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium">Title</label>
              <Input value={draft.title} onChange={(e) => setDraft(d => ({ ...d, title: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium">Lesson date (optional)</label>
              <Input type="date" value={draft.plan_date ?? ""} onChange={(e) => setDraft(d => ({ ...d, plan_date: e.target.value || null }))} />
            </div>
            <div>
              <label className="text-xs font-medium">Objective</label>
              <Textarea rows={2} value={draft.objective ?? ""} onChange={(e) => setDraft(d => ({ ...d, objective: e.target.value }))} placeholder="Students will be able to…" />
            </div>
            <div>
              <label className="text-xs font-medium">Materials</label>
              <Textarea rows={2} value={draft.materials ?? ""} onChange={(e) => setDraft(d => ({ ...d, materials: e.target.value }))} placeholder="Markers, sheet music, manipulatives…" />
            </div>
            <div>
              <label className="text-xs font-medium">Activities</label>
              <Textarea
                rows={4}
                value={Array.isArray(draft.activities) ? draft.activities.join("\n") : ""}
                onChange={(e) => setDraft(d => ({ ...d, activities: e.target.value.split("\n").filter(Boolean) }))}
                placeholder="One activity per line"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Standards (comma-separated)</label>
              <Input value={standardsInput} onChange={(e) => setStandardsInput(e.target.value)} placeholder="MU.2.C.1, CCSS.MATH.1.OA.3" />
            </div>
            <div>
              <label className="text-xs font-medium">Notes</label>
              <Textarea rows={2} value={draft.notes ?? ""} onChange={(e) => setDraft(d => ({ ...d, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            {draft.id && (
              <Button variant="destructive" onClick={deletePlan} className="mr-auto">Delete</Button>
            )}
            <Button variant="outline" onClick={() => setOpenBlock(null)}>Cancel</Button>
            <Button onClick={saveDraft} disabled={saving}>{saving ? "Saving…" : "Save plan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
