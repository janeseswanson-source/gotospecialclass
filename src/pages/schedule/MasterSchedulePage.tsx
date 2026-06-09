import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSchool } from "@/contexts/SchoolContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Undo2, Redo2, Lock, GitCompare, AlertTriangle, X as XIcon, Printer, Sparkles, Loader2, BrainCircuit, Lightbulb, Download, FileText, ChevronDown, LayoutGrid } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTime as formatTimeDisplay, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import ScheduleGrid, { type BlockData } from "@/components/schedule/ScheduleGrid";
import ScrabbleTray from "@/components/schedule/ScrabbleTray";
import EditBlockDialog from "@/components/schedule/EditBlockDialog";
import QuoteBanner from "@/components/schedule/QuoteBanner";
import { toast } from "@/hooks/use-toast";
import { analyzeScheduleBlocks, type ScheduleWarning } from "@/lib/strategyFeasibility";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import SpecialistExportModal from "./exports/SpecialistExportModal";
import AdminExportModal from "./exports/AdminExportModal";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buildTimeSlots, buildCompactTimeSlots, buildRecessBands, computeConflictIds, computeAutoFit } from "@/lib/scheduleGrid";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

const FIX_STEP_MAP: Record<string, number> = {
  recess: 3, specialists: 4, teachers: 5, rotation: 6, clubs: 7, events: 8, conflicts: 9,
};

const STRATEGY_LABELS: Record<string, string> = {
  ab_week: "AB Week",
  aa_bb_week: "AA/BB Week",
  quick_30: "Quick 30",
  big_group: "Big Group",
  extra_rotation: "Extra Rotation",
  standard: "Standard",
  makeup: "Makeup",
  lunch_clubs: "Lunch Clubs",
  event_planning: "Event Planning",
};
const humanizeStrategy = (s?: string | null) =>
  s ? (STRATEGY_LABELS[s] ?? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())) : "";

function PrintViewButton({ label }: { label: string }) {
  return (
    <Button variant="outline" size="sm" className="h-8 no-print" onClick={() => window.print()}>
      <Printer className="h-3.5 w-3.5 mr-1.5" /> {label}
    </Button>
  );
}

export default function MasterSchedulePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedSchoolId, selectedSchool, loading: schoolLoading } = useSchool();
  const [generations, setGenerations] = useState<any[]>([]);
  const [selectedGen, setSelectedGen] = useState<string>("");
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const [specialists, setSpecialists] = useState<{ id: string; name: string; subject: string }[]>([]);
  const [teachers, setTeachers] = useState<{ id: string; name: string; grade: string; combo_partner_id?: string | null }[]>([]);
  const [recessConfig, setRecessConfig] = useState<any[]>([]);
  const [clubs, setClubs] = useState<any[]>([]);
  const [schoolYear, setSchoolYear] = useState<string | undefined>(undefined);
  const [schoolStartTime, setSchoolStartTime] = useState<string | null>(null);
  const [schoolEndTime, setSchoolEndTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editBlock, setEditBlock] = useState<BlockData | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [filterSpecialist, setFilterSpecialist] = useState<string>("all");
  const [filterTeacher, setFilterTeacher] = useState<string>("all");
  const [filterDay, setFilterDay] = useState<string>("Mon");
  const [quote, setQuote] = useState<{ text: string; author: string } | null>(null);
  const [weekFilter, setWeekFilter] = useState<string>("all");
  const [scheduleWarnings, setScheduleWarnings] = useState<ScheduleWarning[]>([]);
  const [warningsDismissed, setWarningsDismissed] = useState(false);
  const [resolvingAI, setResolvingAI] = useState(false);
  const [showExplain, setShowExplain] = useState(false);
  const [specExportOpen, setSpecExportOpen] = useState(false);
  const [adminExportOpen, setAdminExportOpen] = useState(false);
  const [replanSuggestion, setReplanSuggestion] = useState<{ specialistId: string; specialistName: string } | null>(null);
  const [replanLoading, setReplanLoading] = useState(false);
  const [density, setDensity] = useState<"compact" | "fine">("compact");


  // Locked blocks
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());

  // Feedback signal: track manual overrides and fire 'heavily_edited' after 3+
  const manualEditCountRef = useRef(0);
  const heavilyEditedFiredRef = useRef(false);

  // Diff view
  const [diffGenId, setDiffGenId] = useState<string | null>(null);
  const [diffBlocks, setDiffBlocks] = useState<BlockData[]>([]);
  const [showDiff, setShowDiff] = useState(false);

  // Undo/Redo history
  const [history, setHistory] = useState<BlockData[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const pushHistory = useCallback((snapshot: BlockData[]) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      return [...trimmed, snapshot];
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    setBlocks(history[newIndex]);
  }, [canUndo, historyIndex, history]);

  const handleRedo = useCallback(() => {
    if (!canRedo) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    setBlocks(history[newIndex]);
  }, [canRedo, historyIndex, history]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); handleRedo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo]);

  const toggleLock = useCallback((blockId: string) => {
    setLockedIds(prev => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!user || schoolLoading) return;
    if (selectedSchoolId) loadGenerations();
    else setLoading(false);
  }, [user, selectedSchoolId, schoolLoading]);

  useEffect(() => {
    if (selectedGen && specialists.length > 0) loadBlocks(selectedGen);
  }, [selectedGen, specialists, teachers]);

  async function loadGenerations() {
    setLoading(true);
    setLoadError(false);

    const [genRes, specRes, teachRes, recessRes, clubsRes, schoolRes] = await Promise.all([
      supabase.from("schedule_generations").select("*").eq("school_id", selectedSchoolId!).order("version", { ascending: false }),
      supabase.from("specialists").select("id, name, subject").eq("school_id", selectedSchoolId!),
      supabase.from("classroom_teachers").select("id, name, grade, combo_partner_id").eq("school_id", selectedSchoolId!),
      supabase.from("recess_lunch_config").select("*").eq("school_id", selectedSchoolId!),
      supabase.from("clubs").select("*").eq("school_id", selectedSchoolId!),
      supabase.from("schools").select("school_year, start_time, end_time").eq("id", selectedSchoolId!).maybeSingle(),
    ]);

    setSchoolStartTime(schoolRes.data?.start_time ?? null);
    setSchoolEndTime(schoolRes.data?.end_time ?? null);

    setSpecialists(specRes.data ?? []);
    setTeachers(teachRes.data ?? []);
    setRecessConfig(recessRes.data ?? []);
    setClubs(clubsRes.data ?? []);
    setSchoolYear(schoolRes.data?.school_year ?? undefined);
    setGenerations(genRes.data ?? []);
    if (genRes.data?.[0]) {
      setSelectedGen(genRes.data[0].id);
      if (genRes.data[0].quote) {
        try {
          const q = JSON.parse(genRes.data[0].quote);
          setQuote(q);
        } catch {
          setQuote({ text: genRes.data[0].quote, author: "" });
        }
      }
    }
    setLoading(false);
  }

  function mapBlocks(data: any[]): BlockData[] {
    const specMap = Object.fromEntries(specialists.map((s) => [s.id, s]));
    const teachMap = Object.fromEntries(teachers.map((t) => [t.id, t]));
    return data.map((b: any) => ({
      id: b.id,
      day_of_week: b.day_of_week,
      start_time: b.start_time,
      end_time: b.end_time,
      subject: b.subject,
      specialist_name: b.specialist_id ? specMap[b.specialist_id]?.name : null,
      teacher_name: b.teacher_id ? teachMap[b.teacher_id]?.name : null,
      room: b.room,
      grade: b.grade,
      is_override: b.is_override ?? false,
      week_label: b.week_label ?? null,
      specialist_id: b.specialist_id ?? null,
      teacher_id: b.teacher_id ?? null,
      notes: b.notes ?? null,
      placement_reason: b.placement_reason ?? null,
    }));
  }

  async function loadBlocks(genId: string) {
    const { data } = await supabase.from("schedule_blocks").select("*").eq("generation_id", genId);
    const mappedBlocks = mapBlocks(data ?? []);
    setBlocks(mappedBlocks);
    setLockedIds(new Set());
    manualEditCountRef.current = 0;
    heavilyEditedFiredRef.current = false;

    setHistory([mappedBlocks]);
    setHistoryIndex(0);

    const hasWeekLabels = mappedBlocks.some((b: any) => b.week_label);
    if (!hasWeekLabels) setWeekFilter("all");

    // Fetch school grades for analysis
    if (selectedSchoolId) {
      const { data: school } = await supabase.from("schools").select("grades_served").eq("id", selectedSchoolId).single();
      const grades = (school?.grades_served as string[]) ?? [];
      const warnings = analyzeScheduleBlocks(mappedBlocks, specialists, grades);
      setScheduleWarnings(warnings);
      setWarningsDismissed(false);
    }
  }

  async function loadDiffBlocks(genId: string) {
    const { data } = await supabase.from("schedule_blocks").select("*").eq("generation_id", genId);
    setDiffBlocks(mapBlocks(data ?? []));
    setDiffGenId(genId);
    setShowDiff(true);
  }

  // Diff computation
  const diffData = useMemo(() => {
    if (!showDiff || !diffBlocks.length) return null;
    const currentKeys = new Set(blocks.map(b => `${b.day_of_week}:${b.start_time}:${b.subject}:${b.grade}`));
    const prevKeys = new Set(diffBlocks.map(b => `${b.day_of_week}:${b.start_time}:${b.subject}:${b.grade}`));
    const added = blocks.filter(b => !prevKeys.has(`${b.day_of_week}:${b.start_time}:${b.subject}:${b.grade}`));
    const removed = diffBlocks.filter(b => !currentKeys.has(`${b.day_of_week}:${b.start_time}:${b.subject}:${b.grade}`));
    return { added: added.length, removed: removed.length, total: blocks.length };
  }, [showDiff, blocks, diffBlocks]);

  const recessBands = useMemo(() => buildRecessBands(recessConfig), [recessConfig]);

  const timeSlots = useMemo(
    () => density === "compact"
      ? buildCompactTimeSlots(schoolStartTime, schoolEndTime, blocks, recessBands)
      : buildTimeSlots(schoolStartTime, schoolEndTime, blocks),
    [density, schoolStartTime, schoolEndTime, blocks, recessBands],
  );


  const conflictIds = useMemo(() => computeConflictIds(blocks), [blocks]);

  /** Blocks lifted into the Scrabble tray = current conflicts, excluding locked ones. */
  const trayBlocks = useMemo(
    () => blocks.filter((b) => conflictIds.has(b.id) && !lockedIds.has(b.id)),
    [blocks, conflictIds, lockedIds],
  );
  const trayIds = useMemo(() => new Set(trayBlocks.map((b) => b.id)), [trayBlocks]);

  async function handleBlockDrop(blockId: string, newDay: string, newTime: string) {
    if (lockedIds.has(blockId)) {
      toast({ title: "Block is locked", variant: "destructive" });
      return;
    }
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;
    if (block.day_of_week === newDay && block.start_time === newTime) return;

    const fit = computeAutoFit({
      movingBlock: block,
      targetDay: newDay,
      targetTime: newTime,
      allBlocks: blocks,
      recessBands,
      schoolEnd: schoolEndTime,
    });

    if (!fit.ok) {
      toast({ title: "Can't drop here", description: fit.reason, variant: "destructive" });
      return;
    }

    const newBlocks = blocks.map((b) =>
      b.id === blockId
        ? { ...b, day_of_week: newDay, start_time: fit.start, end_time: fit.end, is_override: true }
        : b,
    );
    setBlocks(newBlocks);
    pushHistory(newBlocks);

    const { error } = await supabase
      .from("schedule_blocks")
      .update({ day_of_week: newDay, start_time: fit.start, end_time: fit.end, is_override: true })
      .eq("id", blockId);

    if (error) {
      toast({ title: "Failed to move block", variant: "destructive" });
      loadBlocks(selectedGen);
    } else {
      toast({
        title: "Block moved",
        description: fit.shortened
          ? `Shortened to ${fit.duration} min to fit the slot.`
          : undefined,
      });
      const spec = specialists.find(s => s.id === block.specialist_id || s.name === block.specialist_name);
      if (spec) setReplanSuggestion({ specialistId: spec.id, specialistName: spec.name });
    }
  }

  /** Drag handler used by the Scrabble tray. */
  function handleTrayDragStart(e: React.DragEvent, block: BlockData) {
    e.dataTransfer.setData("text/plain", block.id);
    e.dataTransfer.effectAllowed = "move";
  }


  async function handleSaveOverride(blockId: string, updates: { specialist_id?: string; room?: string; subject?: string }) {
    const { error } = await supabase
      .from("schedule_blocks")
      .update({ ...updates, is_override: true })
      .eq("id", blockId);
    if (error) {
      toast({ title: "Failed to save", variant: "destructive" });
    } else {
      toast({ title: "Override saved" });
      loadBlocks(selectedGen);

      // Track manual edits for feedback signal
      manualEditCountRef.current++;
      if (manualEditCountRef.current >= 3 && !heavilyEditedFiredRef.current && selectedGen && selectedSchoolId) {
        heavilyEditedFiredRef.current = true;
        await supabase.from('schedule_generations')
          .update({ feedback_signal: 'heavily_edited' })
          .eq('id', selectedGen);
        supabase.functions.invoke('update-scoring-weights', {
          body: { school_id: selectedSchoolId, generation_id: selectedGen },
        }).catch(() => {});
      }

      // Suggest replan when specialist changed
      if (updates.specialist_id) {
        const spec = specialists.find(s => s.id === updates.specialist_id);
        if (spec) setReplanSuggestion({ specialistId: spec.id, specialistName: spec.name });
      }
    }
  }

  async function handleNotesChange(blockId: string, notes: string): Promise<boolean> {
    const trimmed = notes.slice(0, 200);
    const nextValue = trimmed.trim() ? trimmed : null;
    setBlocks((prev) => prev.map((b) => (b.id === blockId ? { ...b, notes: nextValue } : b)));
    const { error } = await supabase
      .from("schedule_blocks")
      .update({ notes: nextValue })
      .eq("id", blockId);
    if (error) {
      toast({ title: "Failed to save notes", variant: "destructive" });
      loadBlocks(selectedGen);
      return false;
    }
    return true;
  }

  async function handleResolveWithAI() {
    if (!selectedGen) return;
    const errors = scheduleWarnings.filter(w => w.severity === 'error');
    if (errors.length === 0) {
      toast({ title: "No conflicts to resolve" });
      return;
    }
    setResolvingAI(true);
    try {
      const { data, error } = await supabase.functions.invoke('resolve-conflicts-ai', {
        body: {
          generation_id: selectedGen,
          conflicts: errors.map(w => ({ type: (w as any).type, message: w.message, suggestion: w.suggestion })),
        },
      });
      if (error) {
        toast({ title: "AI resolution failed", description: error.message, variant: "destructive" });
        return;
      }
      if ((data as any)?.error) {
        toast({ title: "AI resolution failed", description: (data as any).error, variant: "destructive" });
        return;
      }
      const applied = (data as any)?.applied ?? 0;
      const updates = (data as any)?.updates ?? 0;
      const deletes = (data as any)?.deletes ?? 0;
      const inserts = (data as any)?.inserts ?? 0;
      const summary = (data as any)?.summary ?? "";
      if (applied === 0) {
        toast({
          title: "AI couldn't resolve automatically",
          description: summary || "Try editing manually or adjusting specialists/strategies.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Schedule updated by AI",
          description: `${updates} moved, ${deletes} removed, ${inserts} added. ${summary ? summary : ""}`.trim(),
        });
      }
      await loadBlocks(selectedGen);
    } catch (e: any) {
      toast({ title: "AI resolution failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setResolvingAI(false);
    }
  }

  const activeGen = useMemo(
    () => (generations.find((g: any) => g.id === selectedGen) as any) ?? null,
    [generations, selectedGen],
  );

  async function handleReplan() {
    if (!replanSuggestion || !selectedGen) return;
    setReplanLoading(true);
    try {
      const { error } = await supabase.functions.invoke('replan-subgraph', {
        body: { generation_id: selectedGen, scope: { specialist_ids: [replanSuggestion.specialistId] } },
      });
      if (error) throw error;
      toast({ title: "Replan complete", description: `${replanSuggestion.specialistName}'s slots have been replanned.` });
      setReplanSuggestion(null);
      await loadBlocks(selectedGen);
    } catch (e: any) {
      toast({ title: "Replan failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setReplanLoading(false);
    }
  }

  const hasWeekLabels = blocks.some((b: any) => b.week_label);
  const weekFiltered = weekFilter === "all"
    ? blocks
    : blocks.filter((b: any) => !b.week_label || b.week_label === weekFilter);

  const filteredBySpecialist = filterSpecialist === "all" ? weekFiltered : weekFiltered.filter((b) => {
    const spec = specialists.find((s) => s.name === b.specialist_name);
    return spec?.id === filterSpecialist;
  });

  const filteredByTeacher = filterTeacher === "all" ? weekFiltered : weekFiltered.filter((b) => {
    const t = teachers.find((t) => t.name === b.teacher_name);
    return t?.id === filterTeacher;
  });

  const filteredByDay = weekFiltered.filter((b) => b.day_of_week === filterDay);

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-9 w-48" />
        </div>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-2">
                <Skeleton className="h-10 w-20" />
                {DAYS.map(d => <Skeleton key={d} className="h-10 flex-1" />)}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4 animate-fade-in">
        <h1 className="text-2xl font-bold text-foreground">Master Schedule</h1>
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card p-20">
          <p className="text-sm text-muted-foreground">Failed to load schedule data.</p>
          <Button variant="outline" onClick={loadGenerations}>Retry</Button>
        </div>
      </div>
    );
  }

  if (generations.length === 0) {
    return (
      <div className="space-y-4 animate-fade-in">
        <h1 className="text-2xl font-bold text-foreground">Master Schedule</h1>
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border bg-card p-20">
          <p className="text-sm text-muted-foreground">No schedule generated yet. Go to Prep to generate one.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ─── Toolbar ─── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Master Schedule</h1>
          <p className="text-sm text-muted-foreground">
            {selectedSchool?.name ?? 'View, filter, and edit your generated schedule.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap no-print">
          {/* Undo / Redo */}
          <div className="flex items-center rounded-lg border border-border bg-background p-0.5 gap-0.5">
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!canUndo} onClick={handleUndo} title="Undo (Ctrl+Z)">
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!canRedo} onClick={handleRedo} title="Redo (Ctrl+Shift+Z)">
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          {lockedIds.size > 0 && (
            <Badge variant="secondary" className="gap-1 h-7">
              <Lock className="h-3 w-3" /> {lockedIds.size} locked
            </Badge>
          )}

          {/* Version tab bar */}
          {generations.length > 1 && (
            <div className="flex items-center rounded-lg border border-border bg-background p-0.5 gap-0.5">
              {generations.map((g) => {
                const isActive = selectedGen === g.id;
                const verified = g.verify_quality_score != null && g.verify_quality_score >= 80;
                const reviewed = !verified && g.verify_quality_score != null && g.verify_issues_found != null && g.verify_issues_found > 0;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => { setSelectedGen(g.id); setShowDiff(false); }}
                    className={cn(
                      'rounded-md px-3 py-1 text-xs font-medium transition-all flex items-center gap-1.5',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                  >
                    v{g.version}
                    {verified && (
                      <span className={cn(
                        "text-[9px] font-bold px-1 py-px rounded leading-none",
                        isActive ? "bg-white/25 text-white" : "bg-green-500/15 text-green-700 dark:text-green-400",
                      )}>✓ AI</span>
                    )}
                    {reviewed && (
                      <span className={cn(
                        "text-[9px] font-bold px-1 py-px rounded leading-none",
                        isActive ? "bg-white/25 text-white" : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                      )}>{g.verify_issues_found} fixed</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Compare with */}
          {generations.length > 1 && (
            <Select value={diffGenId ?? ""} onValueChange={(v) => v ? loadDiffBlocks(v) : setShowDiff(false)}>
              <SelectTrigger className="w-40 h-8">
                <div className="flex items-center gap-1.5">
                  <GitCompare className="h-3.5 w-3.5 shrink-0" />
                  <SelectValue placeholder="Compare…" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {generations.filter(g => g.id !== selectedGen).map((g) => (
                  <SelectItem key={g.id} value={g.id}>vs v{g.version}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Explain toggle */}
          <Button
            variant={showExplain ? "secondary" : "ghost"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setShowExplain(v => !v)}
            title="Toggle AI Explain panel"
          >
            <BrainCircuit className="h-3.5 w-3.5" />
            Explain
          </Button>

          {/* Export dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Export
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSpecExportOpen(true)}>
                <FileText className="h-4 w-4 mr-2" /> Specialist Planner (PDF)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAdminExportOpen(true)}>
                <LayoutGrid className="h-4 w-4 mr-2" /> Admin Overview (PDF)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-2" /> Print Current View
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {(() => {
        if (!activeGen?.chosen_strategy) return null;
        const attempted: Array<{ strategy: string; error_count: number; warning_count: number }> =
          Array.isArray(activeGen.attempted_strategies) ? activeGen.attempted_strategies : [];
        const first = attempted[0];
        const chosenAttempt = attempted.find((a: any) => a.strategy === activeGen.chosen_strategy);
        const delta = Math.max(0, (first?.error_count ?? 0) - (chosenAttempt?.error_count ?? 0));
        return (
          <div className="flex flex-col gap-2 no-print">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="h-3 w-3" /> Strategy: {humanizeStrategy(activeGen.chosen_strategy)}
              </Badge>
              {attempted.length > 1 && (
                <span className="text-xs text-muted-foreground">
                  Tried {attempted.length} {attempted.length === 1 ? "strategy" : "strategies"} in priority order
                </span>
              )}
            </div>
            {activeGen.fallback_reason && first && first.strategy !== activeGen.chosen_strategy && (
              <Alert className="border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-sm">
                  Your priority 1 choice (<strong>{humanizeStrategy(first.strategy)}</strong>) couldn't produce a clean schedule.
                  We fell back to <strong>{humanizeStrategy(activeGen.chosen_strategy)}</strong>
                  {delta > 0 ? <>, which had <strong>{delta}</strong> fewer issues.</> : "."}
                </AlertDescription>
              </Alert>
            )}
          </div>
        );
      })()}


      {showDiff && diffData && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 no-print">
          <GitCompare className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            <span className="font-medium text-success">+{diffData.added} added</span>
            {" · "}
            <span className="font-medium text-destructive">-{diffData.removed} removed</span>
            {" · "}
            <span className="font-medium text-foreground">{diffData.total} total blocks</span>
          </span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { setShowDiff(false); setDiffGenId(null); }}>
            Close
          </Button>
        </div>
      )}

      {quote && <QuoteBanner text={quote.text} author={quote.author} />}

      <p className="text-xs text-muted-foreground no-print">
        Master Grid is the admin overview. Use the other tabs for at-a-glance views per specialist, teacher, week, or day. Use Export in the toolbar to download PDFs.
      </p>

      {/* ─── Replan banner (4C) ─── */}
      {replanSuggestion && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 no-print">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-sm text-foreground flex-1">
            The schedule may have gaps after this change.{' '}
            <strong>Replan {replanSuggestion.specialistName}'s slots?</strong>
          </span>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleReplan} disabled={replanLoading}>
            {replanLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            {replanLoading ? 'Replanning…' : 'Replan'}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setReplanSuggestion(null)}>
            <XIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* ─── Structured Warning Panel ─── */}
      {scheduleWarnings.length > 0 && !warningsDismissed && (() => {
        const errors = scheduleWarnings.filter(w => w.severity === 'error');
        const warnings = scheduleWarnings.filter(w => w.severity === 'warning');
        const renderRow = (w: ScheduleWarning, i: number, isError: boolean) => (
          <div key={i} className="flex items-start gap-2 text-xs py-0.5">
            <span className={cn('shrink-0 mt-1.5 h-1.5 w-1.5 rounded-full', isError ? 'bg-destructive' : 'bg-amber-500')} />
            <div className="flex-1 min-w-0">
              <span className="text-foreground">{w.message}</span>
              {w.suggestion && <span className="text-muted-foreground ml-1">— {w.suggestion}</span>}
              {w.fixAction && (
                <button
                  type="button"
                  className="ml-2 text-[11px] font-semibold text-primary hover:underline"
                  onClick={() => {
                    const step = FIX_STEP_MAP[w.fixAction!.target] ?? 0;
                    const qs = new URLSearchParams({ step: String(step) });
                    if (w.fixAction!.anchor) qs.set('anchor', w.fixAction!.anchor);
                    navigate(`/app/setup?${qs.toString()}`);
                  }}
                >
                  {w.fixAction.label} →
                </button>
              )}
            </div>
          </div>
        );
        return (
          <div className="rounded-xl border border-border bg-card overflow-hidden no-print">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <div className="flex items-center gap-2 flex-wrap">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                <span className="text-sm font-semibold text-foreground">Schedule Notes</span>
                {errors.length > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-destructive text-destructive-foreground">
                    {errors.length} error{errors.length !== 1 ? 's' : ''}
                  </span>
                )}
                {warnings.length > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400">
                    {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {errors.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs"
                    onClick={handleResolveWithAI}
                    disabled={resolvingAI}
                  >
                    {resolvingAI
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Fixing…</>
                      : <><Sparkles className="h-3.5 w-3.5" /> Fix with AI</>
                    }
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setWarningsDismissed(true)}>
                  <XIcon className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="max-h-52 overflow-y-auto divide-y divide-border">
              {errors.length > 0 && (
                <div className="px-4 py-2.5 space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-destructive mb-1.5">Errors</p>
                  {errors.map((w, i) => renderRow(w, i, true))}
                </div>
              )}
              {warnings.length > 0 && (
                <div className="px-4 py-2.5 space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1.5">Warnings</p>
                  {warnings.slice(0, 10).map((w, i) => renderRow(w, i, false))}
                  {warnings.length > 10 && (
                    <p className="text-xs text-muted-foreground italic mt-1">+ {warnings.length - 10} more</p>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ─── Schedule grid + optional XAI sidebar (7D-4) ─── */}
      <div className={showExplain ? "flex gap-4 items-start" : undefined}>
        {/* Main content column */}
        <div className="flex-1 min-w-0 space-y-4">
          {hasWeekLabels && (
            <div className="flex items-center gap-2 no-print">
              <span className="text-sm font-medium text-muted-foreground">Week:</span>
              <Tabs value={weekFilter} onValueChange={setWeekFilter} className="w-auto">
                <TabsList className="h-8">
                  <TabsTrigger value="all" className="text-xs px-3 h-7">All</TabsTrigger>
                  <TabsTrigger value="A" className="text-xs px-3 h-7">Week A</TabsTrigger>
                  <TabsTrigger value="B" className="text-xs px-3 h-7">Week B</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          )}

          <Tabs defaultValue="master">
            <TabsList className="no-print">
              <TabsTrigger value="master">Master Grid</TabsTrigger>
              <TabsTrigger value="specialist">By Specialist</TabsTrigger>
              <TabsTrigger value="teacher">By Teacher</TabsTrigger>
            </TabsList>

            <TabsContent value="master">
              <div className="flex justify-end mb-2 no-print">
                <PrintViewButton label="Print Master Grid" />
              </div>
              {trayBlocks.length > 0 && (
                <div className="mb-3">
                  <ScrabbleTray blocks={trayBlocks} onDragStart={handleTrayDragStart} />
                </div>
              )}
              <ScheduleGrid
                blocks={blocks}
                timeSlots={timeSlots}
                recessBands={recessBands}
                conflictIds={conflictIds}
                liftedIds={trayIds}
                onBlockClick={(b) => { setEditBlock(b); setEditOpen(true); }}
                onBlockDrop={handleBlockDrop}
                lockedIds={lockedIds}
                onToggleLock={toggleLock}
                notesEditable
                onNotesChange={handleNotesChange}
              />
            </TabsContent>

            <TabsContent value="specialist">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2 no-print">
                  <Select value={filterSpecialist} onValueChange={setFilterSpecialist}>
                    <SelectTrigger className="w-56"><SelectValue placeholder="Select a specialist…" /></SelectTrigger>
                    <SelectContent>
                      {specialists.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.subject})</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <PrintViewButton label="Print Specialist View" />
                </div>
                {filterSpecialist === "all" ? (
                  <div className="flex items-center justify-center rounded-xl border border-dashed border-border bg-card p-16 text-sm text-muted-foreground">
                    Pick a specialist above to see their week.
                  </div>
                ) : (
                  <ScheduleGrid
                    blocks={filteredBySpecialist}
                    timeSlots={timeSlots}
                    recessBands={recessBands}
                    conflictIds={conflictIds}
                    onBlockClick={(b) => { setEditBlock(b); setEditOpen(true); }}
                    onBlockDrop={handleBlockDrop}
                    lockedIds={lockedIds}
                    onToggleLock={toggleLock}
                    notesEditable
                    onNotesChange={handleNotesChange}
                  />
                )}
              </div>
            </TabsContent>

            <TabsContent value="teacher">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2 no-print">
                  <Select value={filterTeacher} onValueChange={setFilterTeacher}>
                    <SelectTrigger className="w-56"><SelectValue placeholder="All Teachers" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Teachers</SelectItem>
                      {teachers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} ({t.grade})</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <PrintViewButton label="Print Teacher View" />
                </div>
                <ScheduleGrid
                  blocks={filteredByTeacher}
                  timeSlots={timeSlots}
                  recessBands={recessBands}
                  conflictIds={conflictIds}
                  onBlockClick={(b) => { setEditBlock(b); setEditOpen(true); }}
                  onBlockDrop={handleBlockDrop}
                  lockedIds={lockedIds}
                  onToggleLock={toggleLock}
                  notesEditable
                  onNotesChange={handleNotesChange}
                />
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end no-print">
            <PrintViewButton label="Print this view" />
          </div>
        </div>

        {/* ─── XAI Explain sidebar ─── */}
        {showExplain && (
          <aside className="w-72 shrink-0 space-y-3 sticky top-4 no-print">
            {/* Schedule Insights */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2">
                <BrainCircuit className="h-4 w-4 text-primary shrink-0" />
                <h3 className="text-sm font-semibold">Schedule Insights</h3>
              </div>
              {activeGen?.verify_summary && (
                <p className="text-xs text-foreground">{activeGen.verify_summary}</p>
              )}
              {activeGen?.verify_quality_score != null && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">AI Quality:</span>
                  <span className={cn(
                    "text-xs font-bold",
                    activeGen.verify_quality_score >= 80 ? "text-success" :
                    activeGen.verify_quality_score >= 60 ? "text-amber-600 dark:text-amber-400" : "text-destructive",
                  )}>
                    {activeGen.verify_quality_score}/100
                  </span>
                </div>
              )}
              {activeGen?.chosen_strategy && (
                <p className="text-xs text-muted-foreground">
                  Strategy: <span className="font-medium text-foreground">{humanizeStrategy(activeGen.chosen_strategy)}</span>
                </p>
              )}
              {activeGen?.winning_score != null && (
                <p className="text-xs text-muted-foreground">
                  Optimizer score: <span className="font-medium text-foreground">{Math.round(activeGen.winning_score)}</span>
                </p>
              )}
              {!activeGen && (
                <p className="text-xs text-muted-foreground">Select a generation to see insights.</p>
              )}
            </div>

            {/* Block Explanation */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500 shrink-0" />
                <h3 className="text-sm font-semibold">Block Explanation</h3>
              </div>
              {editBlock ? (
                <>
                  <p className="text-xs font-medium text-foreground">
                    {[editBlock.subject, editBlock.grade && `Gr. ${editBlock.grade}`, editBlock.day_of_week].filter(Boolean).join(' · ')}
                  </p>
                  <p className="text-xs text-foreground leading-relaxed">
                    {editBlock.placement_reason ?? "No explanation recorded for this block."}
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Click any block to see why it was placed there.</p>
              )}
            </div>

            {/* Strategy Rationale */}
            {activeGen && (
              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary shrink-0" />
                  <h3 className="text-sm font-semibold">Strategy Rationale</h3>
                </div>
                {(() => {
                  const attempted: Array<{ strategy: string; error_count: number }> =
                    Array.isArray(activeGen.attempted_strategies) ? activeGen.attempted_strategies : [];
                  const first = attempted[0];
                  const chosen = activeGen.chosen_strategy;
                  const fellBack = first && first.strategy !== chosen;
                  return (
                    <div className="space-y-1">
                      <p className="text-xs text-foreground">
                        Used <span className="font-medium">{humanizeStrategy(chosen)}</span>
                        {fellBack && (
                          <> — fell back from <span className="font-medium">{humanizeStrategy(first.strategy)}</span></>
                        )}.
                      </p>
                      {activeGen.fallback_reason && (
                        <p className="text-xs text-muted-foreground">{activeGen.fallback_reason}</p>
                      )}
                      {attempted.length > 1 && (
                        <p className="text-xs text-muted-foreground">{attempted.length} strategies evaluated.</p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </aside>
        )}
      </div>

      <EditBlockDialog
        block={editBlock}
        specialists={specialists}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSave={handleSaveOverride}
      />

      <SpecialistExportModal
        open={specExportOpen}
        onOpenChange={setSpecExportOpen}
        specialists={specialists}
        blocks={blocks}
        schoolName={selectedSchool?.name}
        schoolYear={schoolYear}
        recessConfig={recessConfig}
      />
      <AdminExportModal
        open={adminExportOpen}
        onOpenChange={setAdminExportOpen}
        specialists={specialists}
        blocks={blocks}
        schoolName={selectedSchool?.name}
        schoolYear={schoolYear}
        teachers={teachers}
        clubs={clubs}
        recessConfig={recessConfig}
      />
    </div>
  );
}
