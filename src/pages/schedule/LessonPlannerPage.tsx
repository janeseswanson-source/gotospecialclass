import { useEffect, useMemo, useRef, useState } from "react";
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
import { BookOpen, NotebookPen, CheckCircle2, FileText, Sparkles, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatTime, cn } from "@/lib/utils";
import { getSubjectBadgeClass } from "@/lib/subjectColors";
import BrandedScheduleHeader from "@/components/schedule/BrandedScheduleHeader";
import WeekCyclePicker from "@/components/schedule/WeekCyclePicker";
import { SaveStatusIndicator, type SaveStatus } from "@/components/setup/SaveStatusIndicator";
import { buildWeekCycle, type WeekStrategy, type RotationCycleFields } from '@/lib/weekCycle';
import { parseTime } from "@/lib/scheduleGrid";

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
  week_label: string | null;
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
  const { selectedSchoolId, schools } = useSchool();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [specialists, setSpecialists] = useState<SpecialistRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [plansByBlock, setPlansByBlock] = useState<Record<string, LessonPlan>>({});
  const [filterSpecialist, setFilterSpecialist] = useState<string>("all");
  const [filterDay, setFilterDay] = useState<string>("all");
  const [weekFilter, setWeekFilter] = useState<string>("all");
  const [openBlock, setOpenBlock] = useState<BlockRow | null>(null);
  const [draft, setDraft] = useState<Omit<LessonPlan, "id"> & { id?: string }>(emptyDraft());
  const [standardsInput, setStandardsInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [aiLoading, setAiLoading] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const editorLoaded = useRef(false);

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
          .select("id,day_of_week,start_time,end_time,subject,grade,specialist_id,teacher_id,room,week_label")
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

  // Infer the week strategy from the labels present → dated cycle for the selector.
  const activeSchool = schools.find((s) => s.id === selectedSchoolId);
  const weekLabelSet = new Set(blocks.map((b) => b.week_label).filter(Boolean) as string[]);
  const strategy: WeekStrategy =
    weekLabelSet.has("AA") || weekLabelSet.has("BB") ? "aa_bb_week"
      : weekLabelSet.has("A") || weekLabelSet.has("B") ? "ab_week"
        : "standard";
  const hasWeekCycle = strategy !== "standard";
  const weekCycle = useMemo(
    () => buildWeekCycle({
      strategy,
      startDate: (activeSchool as { school_year_start?: string | null })?.school_year_start ?? null,
      endDate: (activeSchool as { school_year_end?: string | null })?.school_year_end ?? null,
      schoolYear: (activeSchool as { school_year?: string | null })?.school_year ?? null,
      rotationsStartDate: (activeSchool as RotationCycleFields)?.rotations_start_date ?? null,
      weekAnchor: (activeSchool as RotationCycleFields)?.rotations_week_anchor ?? undefined,
    }),
    [strategy, activeSchool],
  );

  const filtered = useMemo(() => {
    return blocks
      .filter(b => filterSpecialist === "all" || b.specialist_id === filterSpecialist)
      .filter(b => filterDay === "all" || b.day_of_week === filterDay)
      .filter(b => weekFilter === "all" || !b.week_label || b.week_label === weekFilter)
      .sort((a, b) => {
        const d = DAYS.indexOf(a.day_of_week) - DAYS.indexOf(b.day_of_week);
        if (d !== 0) return d;
        return a.start_time.localeCompare(b.start_time);
      });
  }, [blocks, filterSpecialist, filterDay, weekFilter]);

  // Completeness → status chip. "ready" = objective + at least one activity.
  function planStatus(plan?: LessonPlan): "none" | "draft" | "ready" {
    if (!plan) return "none";
    const acts = Array.isArray(plan.activities) ? plan.activities.length : 0;
    return plan.objective && acts > 0 ? "ready" : "draft";
  }

  const specialistName = (id: string | null) =>
    id ? specialists.find(s => s.id === id)?.name ?? "—" : "—";

  function openEditor(block: BlockRow) {
    const existing = plansByBlock[block.id];
    editorLoaded.current = false; // suppress the first autosave after opening
    setSaveStatus("idle");
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

  /** Upsert the current draft. `silent` = autosave (no toast / no close). */
  async function persist(silent = false): Promise<LessonPlan | null> {
    if (!openBlock || !selectedSchoolId) return null;
    setSaveStatus("saving");
    if (!silent) setSaving(true);
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
    const q = draft.id
      ? supabase.from("lesson_plans").update(payload).eq("id", draft.id).select().single()
      : supabase.from("lesson_plans").insert(payload).select().single();
    const { data, error } = await q;
    if (error) {
      setSaveStatus("error");
      if (!silent) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); setSaving(false); }
      return null;
    }
    const saved = data as LessonPlan;
    setPlansByBlock(prev => ({ ...prev, [openBlock.id]: saved }));
    if (!draft.id && saved.id) setDraft(d => ({ ...d, id: saved.id })); // keep editing the same row
    setSaveStatus("saved");
    if (!silent) setSaving(false);
    return saved;
  }

  // Debounced autosave while the editor is open (skips the first load).
  useEffect(() => {
    if (!openBlock) return;
    if (!editorLoaded.current) { editorLoaded.current = true; return; }
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => { void persist(true); }, 1200);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.title, draft.objective, draft.materials, draft.activities, draft.notes, draft.plan_date, standardsInput]);

  /** Ask the AI for a starter and PROPOSE it into the draft — never auto-saved. */
  async function generateStarter() {
    if (!openBlock || aiLoading) return;
    setAiLoading(true);
    try {
      const minutes = Math.max(15, Math.round((parseTime(openBlock.end_time) - parseTime(openBlock.start_time)) || 45));
      const { data, error } = await supabase.functions.invoke("generate-lesson-starter", {
        body: { subject: openBlock.subject ?? "", grade: openBlock.grade ?? "", duration_minutes: minutes },
      });
      if (error || !(data as any)?.objective) throw new Error(error?.message ?? "No starter returned");
      const d = data as { objective: string; materials: string; activities: string[] };
      setDraft(prev => ({
        ...prev,
        objective: prev.objective?.trim() ? prev.objective : d.objective,
        materials: prev.materials?.trim() ? prev.materials : d.materials,
        activities: Array.isArray(prev.activities) && prev.activities.length ? prev.activities : d.activities,
      }));
      toast({ title: "Draft added", description: "Review and edit — it won't save until you do." });
    } catch (e: any) {
      toast({ title: "Couldn't generate a starter", description: e?.message, variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
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

      {hasWeekCycle && (
        <WeekCyclePicker cycle={weekCycle} value={weekFilter} onChange={setWeekFilter} />
      )}

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
            const status = planStatus(plan);
            return (
              <button
                key={b.id}
                onClick={() => openEditor(b)}
                className={cn(
                  "text-left rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                  status === "ready" ? "border-primary/40 ring-1 ring-primary/20" : status === "draft" ? "border-amber-400/50" : "border-border"
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5">
                    <Badge className={cn("text-[10px]", getSubjectBadgeClass(b.subject ?? ""))}>
                      {b.subject ?? "—"}
                    </Badge>
                    {b.week_label && (
                      <span className="rounded border border-amber-500/40 bg-amber-500/15 px-1 text-[9px] font-bold uppercase text-amber-700 dark:text-amber-300">{b.week_label}</span>
                    )}
                  </div>
                  {status === "ready" ? (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                    </span>
                  ) : status === "draft" ? (
                    <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Draft</span>
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

      <Dialog open={!!openBlock} onOpenChange={(o) => { if (!o) { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); void persist(true); setOpenBlock(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2 pr-6">
              <DialogTitle className="flex items-center gap-2">
                <NotebookPen className="h-5 w-5" />
                {draft.id ? "Edit Lesson Plan" : "New Lesson Plan"}
              </DialogTitle>
              <SaveStatusIndicator status={saveStatus} />
            </div>
            {openBlock && (
              <p className="text-xs text-muted-foreground">
                {openBlock.subject} · Gr. {openBlock.grade} · {openBlock.day_of_week} {formatTime(openBlock.start_time)}–{formatTime(openBlock.end_time)}
              </p>
            )}
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* Optional AI starter — proposes into the draft; never auto-fills over your work. */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2">
              <p className="text-xs text-muted-foreground">Need a starting point? Generate a draft objective, materials & activities.</p>
              <Button variant="outline" size="sm" className="h-7 shrink-0 gap-1.5" onClick={generateStarter} disabled={aiLoading}>
                {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                AI starter
              </Button>
            </div>
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
            <span className="self-center text-xs text-muted-foreground">Changes save automatically.</span>
            <Button onClick={async () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); await persist(false); setOpenBlock(null); }} disabled={saving}>
              {saving ? "Saving…" : "Done"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
