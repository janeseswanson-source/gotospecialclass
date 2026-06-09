import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSchool } from "@/contexts/SchoolContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, AlertCircle, XCircle, Loader2, Sparkles, RefreshCw, Info, AlertTriangle, GripVertical, X } from "lucide-react";
import QuoteBanner from "@/components/schedule/QuoteBanner";
import { toast } from "@/hooks/use-toast";
import { formatTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { getStrategyNote, getRecommendedStrategies, type StrategyContext } from "@/lib/strategyFeasibility";
import { analyzeContractFeasibility, type FeasibilityNote } from "@/lib/contractFeasibility";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface CheckItem {
  label: string;
  status: "ready" | "warning" | "missing";
  detail: string;
}

const ALL_STRATEGIES = [
  { key: "ab_week", label: "A/B Week" },
  { key: "aa_bb_week", label: "AA/BB (4-Week Rotation)" },
  { key: "quick_30", label: "Quick 30-Min Class" },
  { key: "lunch_clubs", label: "Lunch Clubs" },
  { key: "event_planning", label: "Event Planning Blocks" },
  { key: "big_group", label: "Big Group Split" },
  { key: "makeup", label: "Make-Up Sessions" },
];

const BASE_ROTATION_KEYS = ["ab_week", "aa_bb_week"];

function SortableStrategyItem({ strategyKey, index, onRemove, strategyCtx, recommendedKeys }: {
  strategyKey: string;
  index: number;
  onRemove: (key: string) => void;
  strategyCtx: StrategyContext;
  recommendedKeys: string[];
}) {
  const strat = ALL_STRATEGIES.find(s => s.key === strategyKey)!;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: strategyKey });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined, opacity: isDragging ? 0.5 : 1 };
  const note = getStrategyNote(strategyKey, strategyCtx);
  const NoteIcon = note.severity === "error" ? XCircle : note.severity === "warning" ? AlertTriangle : Info;
  const noteColor = note.severity === "error" ? "text-destructive" : note.severity === "warning" ? "text-warning" : "text-muted-foreground";
  const isRecommended = recommendedKeys.includes(strategyKey);

  return (
    <div ref={setNodeRef} style={style} className="space-y-1">
      <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
        <button {...attributes} {...listeners} className="cursor-grab touch-none p-0.5 text-muted-foreground hover:text-foreground">
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="text-xs font-bold text-primary w-5 text-center">{index + 1}</span>
        <span className="text-sm flex-1">{strat.label}</span>
        {isRecommended && <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">Rec</span>}
        <button onClick={() => onRemove(strategyKey)} className="text-xs text-destructive hover:text-destructive/80 ml-1"><X className="h-3.5 w-3.5" /></button>
      </div>
      {note.note && (
        <div className="flex items-start gap-1.5 pl-8">
          <NoteIcon className={cn("h-3 w-3 mt-0.5 shrink-0", noteColor)} />
          <p className={cn("text-xs", noteColor)}>{note.note}</p>
        </div>
      )}
    </div>
  );
}

export default function PrepPage() {
  const { user } = useAuth();
  const { selectedSchoolId, loading: schoolLoading } = useSchool();
  const navigate = useNavigate();
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatedQuote, setGeneratedQuote] = useState<{ text: string; author: string } | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Conflict strategy state
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>([]);
  const [conflictGrades, setConflictGrades] = useState<string[]>([]);
  const [availableGrades, setAvailableGrades] = useState<string[]>([]);
  const [savingStrategy, setSavingStrategy] = useState(false);

  // Feasibility context
  const [teachersByGrade, setTeachersByGrade] = useState<Record<string, number>>({});
  const [specialistCount, setSpecialistCount] = useState(0);
  const [hasLunchConfig, setHasLunchConfig] = useState(false);
  const [hasClubs, setHasClubs] = useState(false);
  const [classDuration, setClassDuration] = useState(45);
  const [bigGroupConfig, setBigGroupConfig] = useState<Array<{ grade: string; teacherIds: string[] }>>([]);
  const [contractNotes, setContractNotes] = useState<FeasibilityNote[]>([]);


  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!user || schoolLoading) return;
    if (selectedSchoolId) loadReadiness();
    else {
      setChecks([{ label: "School", status: "missing", detail: "No school configured — complete Setup first" }]);
      setLoading(false);
    }
  }, [user, selectedSchoolId, schoolLoading]);

  async function loadReadiness() {
    setLoading(true);
    setLoadError(false);
    try {
      const { data: school, error: schoolErr } = await supabase
        .from("schools")
        .select("*")
        .eq("id", selectedSchoolId!)
        .single();

      if (schoolErr || !school) { setLoadError(true); setLoading(false); return; }

      const grades = (school.grades_served as string[]) ?? [];
      setAvailableGrades(grades);
      setSelectedStrategies((school.conflict_strategies as string[]) ?? []);
      setConflictGrades((school.conflict_grades as string[]) ?? []);

      const [specialistsRes, teachersRes, recessRes, eventsRes, clubsRes] = await Promise.all([
        supabase.from("specialists").select("id, name, subject, working_days, class_duration, lunch_minutes, weekly_planning_minutes, is_part_time").eq("school_id", school.id),
        supabase.from("classroom_teachers").select("id, name, grade").eq("school_id", school.id),
        supabase.from("recess_lunch_config").select("id").eq("school_id", school.id),
        supabase.from("parsed_calendar_events").select("id").eq("school_id", school.id),
        supabase.from("clubs").select("id").eq("school_id", school.id),
      ]);


      const specialists = specialistsRes.data ?? [];
      setSpecialistCount(specialists.length);
      setHasLunchConfig((recessRes.data?.length ?? 0) > 0);
      setHasClubs((clubsRes.data?.length ?? 0) > 0);
      setClassDuration(school.class_duration ?? 45);
      setBigGroupConfig((school.big_group_config as Array<{ grade: string; teacherIds: string[] }>) ?? []);
      const tByG: Record<string, number> = {};
      for (const t of (teachersRes.data ?? [])) {
        tByG[t.grade] = (tByG[t.grade] ?? 0) + 1;
      }
      setTeachersByGrade(tByG);

      // ── Contract / scheduler-data feasibility (pre-flight) ──
      setContractNotes(analyzeContractFeasibility(school, specialistsRes.data ?? [], teachersRes.data ?? []));


      // ── Coverage forecast: demand vs supply per grade ──
      const PRIORITY = ["6","5","4","3","2","1","K","TK","PreK","Pre-K"];
      const orderedGrades = [...grades].sort((a, b) => {
        const ai = PRIORITY.indexOf(a), bi = PRIORITY.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
      const toMin = (t?: string | null) => {
        if (!t) return null;
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m;
      };
      const startMin = toMin(school.start_time) ?? 8 * 60;
      const endMin = toMin(school.end_time) ?? 15 * 60;
      const dayMinutes = Math.max(0, endMin - startMin);
      const passing = school.passing_time ?? 5;
      const defaultClassDur = school.class_duration ?? 45;
      // Total weekly specialist slot supply
      let totalSupply = 0;
      for (const s of specialists) {
        const dur = (s.class_duration ?? defaultClassDur) || 45;
        const workingDays = (s.working_days ?? ["Mon","Tue","Wed","Thu","Fri"]).length;
        const lunchPerDay = s.lunch_minutes ?? 30;
        const planningPerWeek = s.weekly_planning_minutes ?? 0;
        const usableDay = Math.max(0, dayMinutes - lunchPerDay - 30); // 30min reserve for transitions/admin
        const slotsPerDay = Math.max(0, Math.floor(usableDay / (dur + passing)));
        const weekly = slotsPerDay * workingDays - Math.ceil(planningPerWeek / (dur + passing));
        totalSupply += Math.max(0, weekly);
      }
      // Demand per grade = teachers × number of specialists (one weekly session per subject)
      const demandByGrade: Record<string, number> = {};
      let totalDemand = 0;
      for (const g of orderedGrades) {
        const d = (tByG[g] ?? 1) * Math.max(1, specialists.length);
        demandByGrade[g] = d;
        totalDemand += d;
      }
      // Walk in priority order, assigning supply
      const coverageItems: CheckItem[] = [];
      let remaining = totalSupply;
      const shortGrades: string[] = [];
      for (const g of orderedGrades) {
        const need = demandByGrade[g];
        if (remaining >= need) {
          remaining -= need;
        } else {
          shortGrades.push(g);
          coverageItems.push({
            label: `Grade ${g} coverage`,
            status: "warning",
            detail: `Likely under-covered: needs ~${need} sessions, ~${Math.max(0, remaining)} available after higher-priority grades.`,
          });
          remaining = 0;
        }
      }

      const items: CheckItem[] = [
        {
          label: "School Info",
          status: school.start_time && school.end_time ? "ready" : "warning",
          detail: school.start_time && school.end_time
            ? `${school.name} · ${formatTime(school.start_time)}–${formatTime(school.end_time)}`
            : "Start/end time not set",
        },
        {
          label: "Grades",
          status: (school.grades_served?.length ?? 0) > 0 ? "ready" : "missing",
          detail: (school.grades_served?.length ?? 0) > 0 ? `${school.grades_served!.length} grades configured` : "No grades selected",
        },
        {
          label: "Specialists",
          status: specialists.length > 0 ? "ready" : "missing",
          detail: specialists.length > 0 ? `${specialists.length} specialist(s) added` : "No specialists added",
        },
        {
          label: "Teachers",
          status: (teachersRes.data?.length ?? 0) > 0 ? "ready" : "warning",
          detail: (teachersRes.data?.length ?? 0) > 0 ? `${teachersRes.data!.length} teacher(s) added` : "No teachers — schedule will use grades only",
        },
        {
          label: "Coverage Forecast",
          status: shortGrades.length === 0 ? "ready" : "warning",
          detail: shortGrades.length === 0
            ? `Supply ~${totalSupply} sessions/week covers demand ~${totalDemand}.`
            : `Demand ~${totalDemand} > supply ~${totalSupply}. Short grades: ${shortGrades.join(", ")}.`,
        },
        ...coverageItems,
        {
          label: "Recess & Lunch",
          status: (recessRes.data?.length ?? 0) > 0 ? "ready" : "warning",
          detail: (recessRes.data?.length ?? 0) > 0 ? "Configured" : "Using defaults",
        },
        {
          label: "Calendar Events",
          status: (eventsRes.data?.length ?? 0) > 0 ? "ready" : "warning",
          detail: (eventsRes.data?.length ?? 0) > 0 ? `${eventsRes.data!.length} event(s) imported` : "No calendar uploaded — non-blocking",
        },
        {
          label: "Conflict Strategy",
          status: (school.conflict_strategies as string[])?.length > 0 ? "ready" : "warning",
          detail: (school.conflict_strategies as string[])?.length > 0
            ? `${(school.conflict_strategies as string[]).length} strategy/ies selected`
            : "No conflict strategies — using standard scheduling",
        },
      ];

      setChecks(items);
    } catch (err: any) {
      console.error("Readiness check error:", err);
      setLoadError(true);
      toast({ title: "Error loading readiness", description: err?.message, variant: "destructive" });
    }
    setLoading(false);
  }

  function toggleStrategy(key: string) {
    setSelectedStrategies(prev => {
      if (prev.includes(key)) return prev.filter(s => s !== key);
      // Mutual exclusion for base rotation
      let next = [...prev];
      if (BASE_ROTATION_KEYS.includes(key)) {
        const other = BASE_ROTATION_KEYS.find(k => k !== key);
        if (other) next = next.filter(s => s !== other);
      }
      return [...next, key];
    });
  }

  function removeStrategy(key: string) {
    setSelectedStrategies(prev => prev.filter(s => s !== key));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSelectedStrategies(prev => {
        const oldIndex = prev.indexOf(active.id as string);
        const newIndex = prev.indexOf(over.id as string);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  function toggleConflictGrade(grade: string) {
    setConflictGrades(prev =>
      prev.includes(grade) ? prev.filter(g => g !== grade) : [...prev, grade]
    );
  }

  async function saveStrategies() {
    if (!selectedSchoolId) return;
    setSavingStrategy(true);
    const { error } = await supabase
      .from("schools")
      .update({ conflict_strategies: selectedStrategies, conflict_grades: conflictGrades })
      .eq("id", selectedSchoolId);
    setSavingStrategy(false);
    if (error) {
      toast({ title: "Failed to save strategies", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Strategies saved" });
      loadReadiness();
    }
  }

  const [genProgress, setGenProgress] = useState<string>('');
  const [genHistory, setGenHistory] = useState<Array<{ id: string; version: number; status: string; created_at: string }>>([]);

  useEffect(() => {
    if (selectedSchoolId) loadHistory();
  }, [selectedSchoolId]);

  async function loadHistory() {
    if (!selectedSchoolId) return;
    const { data } = await supabase
      .from('schedule_generations')
      .select('id, version, status, created_at')
      .eq('school_id', selectedSchoolId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (data) setGenHistory(data);
  }

  async function handleGenerate() {
    if (!selectedSchoolId) return;
    setGenerating(true);
    setGenProgress('Saving strategies…');
    try {
      // Mark the most recent generation as 'regenerated' (user requested a new one)
      if (genHistory[0]?.id) {
        await supabase.from('schedule_generations')
          .update({ feedback_signal: 'regenerated' })
          .eq('id', genHistory[0].id);
        // Trigger weight update for that generation
        supabase.functions.invoke('update-scoring-weights', {
          body: { school_id: selectedSchoolId, generation_id: genHistory[0].id },
        }).catch(() => {});
      }

      const { error: saveErr } = await supabase
        .from("schools")
        .update({ conflict_strategies: selectedStrategies, conflict_grades: conflictGrades })
        .eq("id", selectedSchoolId);
      if (saveErr) throw saveErr;

      setGenProgress('Analyzing conflicts & placing blocks…');
      const { data, error } = await supabase.functions.invoke("generate-schedule", {
        body: { school_id: selectedSchoolId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setGeneratedQuote(data.quote);
      setGenProgress('');
      toast({ title: "Schedule generated!", description: `${data.blocks_count} blocks created. View it on the Master Schedule page.` });

      // Schedule 'accepted' signal after 5 minutes of no regeneration
      const newGenId: string | undefined = data.generation_id;
      if (newGenId) {
        setTimeout(async () => {
          await supabase.from('schedule_generations')
            .update({ feedback_signal: 'accepted' })
            .eq('id', newGenId)
            .is('feedback_signal', null);
          supabase.functions.invoke('update-scoring-weights', {
            body: { school_id: selectedSchoolId, generation_id: newGenId },
          }).catch(() => {});
        }, 5 * 60 * 1000);
      }

      loadHistory();
    } catch (err: any) {
      setGenProgress('');
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    }
    setGenerating(false);
  }

  const allReady = checks.length > 0 && checks.every((c) => c.status !== "missing");

  const strategyCtx: StrategyContext = useMemo(() => ({
    conflictGrades,
    gradesServed: availableGrades,
    specialistCount,
    teachersByGrade,
    hasLunchConfig,
    hasClubs,
    classDuration,
    bigGroupConfig,
  }), [conflictGrades, availableGrades, specialistCount, teachersByGrade, hasLunchConfig, hasClubs, classDuration, bigGroupConfig]);

  const recommendations = useMemo(() => getRecommendedStrategies(strategyCtx), [strategyCtx]);
  const recommendedKeys = useMemo(() => recommendations.map(r => r.key), [recommendations]);

  const handleAutoRecommend = () => {
    const recKeys = recommendations.map(r => r.key);
    const youngGrades = availableGrades.filter(g => g === "K" || g === "1");
    const newConflictGrades = recKeys.includes("quick_30") ? [...new Set([...conflictGrades, ...youngGrades])] : conflictGrades;
    setSelectedStrategies(recKeys);
    setConflictGrades(newConflictGrades);
    toast({
      title: "✨ Strategies auto-selected",
      description: recommendations.map(r => `${ALL_STRATEGIES.find(s => s.key === r.key)?.label}: ${r.reason}`).join("\n"),
    });
  };

  const StatusIcon = ({ status }: { status: CheckItem["status"] }) => {
    if (status === "ready") return <CheckCircle2 className="h-5 w-5 text-success" />;
    if (status === "warning") return <AlertCircle className="h-5 w-5 text-warning" />;
    return <XCircle className="h-5 w-5 text-destructive" />;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Prep & Generate</h1>
        <p className="text-sm text-muted-foreground">Review readiness, configure conflict strategies, and generate your master schedule.</p>
      </div>

      {loadError && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-destructive/30 bg-card p-10">
          <p className="text-sm text-muted-foreground">Failed to load readiness data.</p>
          <Button variant="outline" size="sm" onClick={loadReadiness} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Retry
          </Button>
        </div>
      )}

      {generatedQuote && <QuoteBanner text={generatedQuote.text} author={generatedQuote.author} />}

      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Readiness Checklist</h2>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="h-5 w-5 animate-spin" /> Checking…
            </div>
          ) : (
            <div className="space-y-3">
              {checks.map((c) => (
                <div key={c.label} className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
                  <StatusIcon status={c.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{c.label}</p>
                    <p className="text-xs text-muted-foreground">{c.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contract & scheduler-data feasibility (pre-flight) */}
      {!loading && !loadError && contractNotes.length > 0 && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">Contract & Scheduling Preflight</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Heads-up before you generate. These won't block scheduling but may show up as warnings after.
            </p>
            <div className="space-y-2">
              {contractNotes.map((n, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border px-3 py-2 text-sm",
                    n.level === "warning"
                      ? "border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/15"
                      : "border-sky-500/30 bg-sky-50/40 dark:bg-sky-950/15"
                  )}
                >
                  {n.level === "warning"
                    ? <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                    : <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground">{n.message}</p>
                    {n.suggestion && <p className="text-xs text-muted-foreground mt-0.5">{n.suggestion}</p>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}


      {/* Conflict Strategy Picker */}
      {!loading && !loadError && (
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Conflict Strategies</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Select and prioritize strategies. Drag to reorder priority.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleAutoRecommend} className="gap-2">
                <Sparkles className="h-4 w-4" /> Auto-Recommend
              </Button>
            </div>

            <div className="space-y-2">
              {/* Selected strategies with drag-and-drop */}
              {selectedStrategies.length > 0 && (
                <div className="space-y-1 mb-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Priority Order (drag to reorder)</p>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={selectedStrategies} strategy={verticalListSortingStrategy}>
                      <div className="space-y-1">
                        {selectedStrategies.map((key, idx) => (
                          <SortableStrategyItem
                            key={key}
                            strategyKey={key}
                            index={idx}
                            onRemove={removeStrategy}
                            strategyCtx={strategyCtx}
                            recommendedKeys={recommendedKeys}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              )}

              {/* Unselected strategies */}
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Available Strategies</p>
              {ALL_STRATEGIES.filter(s => !selectedStrategies.includes(s.key)).map(strat => {
                const note = getStrategyNote(strat.key, strategyCtx);
                const NoteIcon = note.severity === "error" ? XCircle : note.severity === "warning" ? AlertTriangle : Info;
                const noteColor = note.severity === "error" ? "text-destructive" : note.severity === "warning" ? "text-warning" : "text-primary";
                const isDisabled = note.severity === "error";
                const isRecommended = recommendedKeys.includes(strat.key);
                return (
                  <div key={strat.key} className="space-y-1">
                    <label className={cn(
                      "flex items-center gap-3 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/50",
                      isDisabled && "opacity-60 cursor-not-allowed"
                    )}>
                      <Checkbox
                        checked={false}
                        onCheckedChange={() => toggleStrategy(strat.key)}
                        disabled={isDisabled}
                      />
                      <span className="text-sm flex-1">{strat.label}</span>
                      {isRecommended && <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">Rec</span>}
                    </label>
                    {note.note && (
                      <div className={cn("flex items-start gap-1.5 pl-8")}>
                        <NoteIcon className={cn("h-3 w-3 mt-0.5 shrink-0", noteColor)} />
                        <p className={cn("text-xs", noteColor)}>{note.note}</p>
                      </div>
                    )}
                  </div>
                );
              })}
              {ALL_STRATEGIES.filter(s => !selectedStrategies.includes(s.key)).length === 0 && (
                <p className="text-xs text-muted-foreground italic">All strategies selected</p>
              )}
            </div>

            {/* Conflict Grades */}
            {availableGrades.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Affected Grades</p>
                <div className="flex flex-wrap gap-2">
                  {availableGrades.map(grade => (
                    <label key={grade} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 cursor-pointer hover:bg-muted/50 text-sm">
                      <Checkbox
                        checked={conflictGrades.includes(grade)}
                        onCheckedChange={() => toggleConflictGrade(grade)}
                      />
                      {grade}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <Button variant="outline" size="sm" onClick={saveStrategies} disabled={savingStrategy} className="gap-2">
              {savingStrategy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Save Strategies
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Button
          size="lg"
          disabled={!allReady || generating}
          onClick={handleGenerate}
          className="gap-2"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {generating ? "Generating…" : "Generate Schedule"}
        </Button>
        {generatedQuote && (
          <Button variant="outline" onClick={() => navigate("/app/schedule")}>
            View Schedule →
          </Button>
        )}
      </div>

      {generating && genProgress && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
          <Loader2 className="h-4 w-4 animate-spin" />
          {genProgress}
        </div>
      )}

      {/* Generation History */}
      {genHistory.length > 0 && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Generation History</h2>
            <div className="space-y-2">
              {genHistory.map(gen => (
                <div key={gen.id} className="flex items-center gap-3 rounded-lg border border-border px-4 py-2.5">
                  <div className="flex-1">
                    <p className="text-sm font-medium">Version {gen.version}</p>
                    <p className="text-xs text-muted-foreground">{new Date(gen.created_at).toLocaleString()}</p>
                  </div>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-medium",
                    gen.status === 'complete' ? 'bg-green-100 text-green-700' : gen.status === 'draft' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                  )}>
                    {gen.status}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
