import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSchool } from "@/contexts/SchoolContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Undo2, Redo2, Lock, GitCompare, AlertTriangle, X as XIcon, Printer, Sparkles, Loader2, BrainCircuit, Lightbulb, Download, FileText, ChevronDown, LayoutGrid, MessageSquare, Check, RotateCcw } from "lucide-react";
import ScheduleChatPanel from "@/components/schedule/ScheduleChatPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTime as formatTimeDisplay, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import ScheduleGrid, { type BlockData } from "@/components/schedule/ScheduleGrid";
import ScrabbleTray from "@/components/schedule/ScrabbleTray";
import EditBlockDialog from "@/components/schedule/EditBlockDialog";
import QuoteBanner from "@/components/schedule/QuoteBanner";
import { toast } from "@/hooks/use-toast";
import { analyzeScheduleBlocks, type ScheduleWarning } from "@/lib/strategyFeasibility";
import { warningMeta } from "@/lib/warningMeta";
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

function PrintViewButton({ label, disabled, disabledReason }: { label: string; disabled?: boolean; disabledReason?: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 no-print"
      onClick={() => !disabled && window.print()}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
    >
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
  const [recessBandLabels, setRecessBandLabels] = useState<Record<string, string>>({});
  const [clubs, setClubs] = useState<any[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
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
  const [chatOpen, setChatOpen] = useState(false);
  const [updatingReview, setUpdatingReview] = useState(false);
  const [specExportOpen, setSpecExportOpen] = useState(false);
  const [adminExportOpen, setAdminExportOpen] = useState(false);
  const [replanSuggestion, setReplanSuggestion] = useState<{ specialistId: string; specialistName: string } | null>(null);
  const [replanLoading, setReplanLoading] = useState(false);
  // Blocks recently changed by the AI editor — highlighted in the grid so the
  // user can SEE what changed. Cleared automatically.
  const [recentChangedIds, setRecentChangedIds] = useState<Set<string>>(new Set());
  const changedClearTimer = useRef<number | null>(null);
  const flagChangedBlocks = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setRecentChangedIds(new Set(ids));
    if (changedClearTimer.current) window.clearTimeout(changedClearTimer.current);
    changedClearTimer.current = window.setTimeout(() => setRecentChangedIds(new Set()), 12_000);
  }, []);
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

    const [genRes, specRes, teachRes, recessRes, clubsRes, schoolRes, calRes] = await Promise.all([
      supabase.from("schedule_generations").select("*").eq("school_id", selectedSchoolId!).order("version", { ascending: false }),
      supabase.from("specialists").select("id, name, subject").eq("school_id", selectedSchoolId!),
      supabase.from("classroom_teachers").select("id, name, grade, combo_partner_id").eq("school_id", selectedSchoolId!),
      supabase.from("recess_lunch_config").select("*").eq("school_id", selectedSchoolId!),
      supabase.from("clubs").select("*").eq("school_id", selectedSchoolId!),
      supabase.from("schools").select("school_year, start_time, end_time, recess_grade_bands").eq("id", selectedSchoolId!).maybeSingle(),
      supabase.from("parsed_calendar_events").select("event_date, end_date, title, event_type").eq("school_id", selectedSchoolId!).eq("approved", true),
    ]);

    setSchoolStartTime(schoolRes.data?.start_time ?? null);
    setSchoolEndTime(schoolRes.data?.end_time ?? null);

    setSpecialists(specRes.data ?? []);
    setTeachers(teachRes.data ?? []);
    setRecessConfig(recessRes.data ?? []);
    const rawBands = (schoolRes.data as any)?.recess_grade_bands;
    if (Array.isArray(rawBands)) {
      const map: Record<string, string> = {};
      rawBands.forEach((b: any) => { if (b?.key && b?.label) map[b.key] = b.label; });
      setRecessBandLabels(map);
    } else {
      setRecessBandLabels({});
    }
    setClubs(clubsRes.data ?? []);
    setCalendarEvents(calRes.data ?? []);
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
      ai_explanation: b.ai_explanation ?? null,
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

    const labels = new Set(mappedBlocks.map((b: any) => b.week_label).filter(Boolean));
    if (labels.has("AA") || labels.has("BB")) setWeekFilter("AA");
    else if (labels.has("A") || labels.has("B")) setWeekFilter("A");
    else setWeekFilter("all");

    // Fetch school grades for analysis
    if (selectedSchoolId) {
      const { data: school } = await supabase.from("schools").select("grades_served").eq("id", selectedSchoolId).single();
      const grades = (school?.grades_served as string[]) ?? [];
      const warnings = analyzeScheduleBlocks(mappedBlocks, specialists, grades);
      setScheduleWarnings(warnings);
      setWarningsDismissed(false);
    }

    // Fire-and-forget AI explanations for blocks that lack them.
    const missingExplanations = mappedBlocks.some((b: any) => !b.ai_explanation);
    if (missingExplanations) {
      supabase.functions.invoke("explain-schedule", { body: { generation_id: genId } })
        .then(async () => {
          // Re-fetch only the explanation column and merge.
          const { data: refreshed } = await supabase.from("schedule_blocks").select("id, ai_explanation").eq("generation_id", genId);
          if (!refreshed) return;
          const explMap = new Map(refreshed.map((r: any) => [r.id, r.ai_explanation]));
          setBlocks((prev) => prev.map((b) => ({ ...b, ai_explanation: explMap.get(b.id) ?? b.ai_explanation })));
        })
        .catch((err) => console.warn("[explain-schedule] failed", err));
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

  const recessBands = useMemo(() => buildRecessBands(recessConfig, recessBandLabels), [recessConfig, recessBandLabels]);

  const timeSlots = useMemo(
    () => density === "compact"
      ? buildCompactTimeSlots(schoolStartTime, schoolEndTime, blocks, recessBands)
      : buildTimeSlots(schoolStartTime, schoolEndTime, blocks),
    [density, schoolStartTime, schoolEndTime, blocks, recessBands],
  );


  const conflictIds = useMemo(() => computeConflictIds(blocks), [blocks]);

  /**
   * Error-severity issues that must block Accept/Export. `conflictIds` is the
   * LIVE interval-overlap set (updates on every edit/drag); the warning panel's
   * non-overlap errors (e.g. no_coverage) are added on top. When either exists,
   * the schedule can't be accepted or exported until it's resolved.
   */
  const blockingError = useMemo(() => {
    const parts: string[] = [];
    if (conflictIds.size > 0) {
      parts.push(`${conflictIds.size} double-booked block${conflictIds.size !== 1 ? "s" : ""}`);
    }
    const nonOverlap = scheduleWarnings.filter((w) => w.severity === "error" && w.type !== "double_booked");
    if (nonOverlap.length) {
      parts.push(`${nonOverlap.length} unresolved error${nonOverlap.length !== 1 ? "s" : ""}`);
    }
    return { blocked: parts.length > 0, reason: parts.join(" and ") };
  }, [conflictIds, scheduleWarnings]);

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

    // Detect a block whose interval CONTAINS the target time (any subject) on
    // the same day & coinciding week → attempt a swap. Using interval-contains
    // (not exact start-time equality) is important: compact-view rows only
    // expose the start-time of one column's block, so a Tuesday block that
    // starts a few minutes earlier than the displayed row would otherwise be
    // invisible to this check and the drop would be rejected as "occupied".
    const newTimeMin = (() => { const [h, m] = newTime.split(":").map(Number); return h * 60 + m; })();
    const targetBlock = blocks.find((b) => {
      if (b.id === blockId) return false;
      if (b.day_of_week !== newDay) return false;
      if (b.week_label && block.week_label && b.week_label !== block.week_label) return false;
      const [bh, bm] = b.start_time.split(":").map(Number);
      const [eh, em] = b.end_time.split(":").map(Number);
      const bs = bh * 60 + bm;
      const be = eh * 60 + em;
      return newTimeMin >= bs && newTimeMin < be;
    });

    if (targetBlock) {
      if (lockedIds.has(targetBlock.id)) {
        toast({ title: "Target block is locked", variant: "destructive" });
        return;
      }
      // Swap day/time of the two blocks (keep durations unchanged).
      const aSlot = { day: block.day_of_week, start: block.start_time, end: block.end_time };
      const bSlot = { day: targetBlock.day_of_week, start: targetBlock.start_time, end: targetBlock.end_time };
      const newBlocks = blocks.map((b) => {
        if (b.id === block.id) return { ...b, day_of_week: bSlot.day, start_time: bSlot.start, end_time: bSlot.end, is_override: true };
        if (b.id === targetBlock.id) return { ...b, day_of_week: aSlot.day, start_time: aSlot.start, end_time: aSlot.end, is_override: true };
        return b;
      });
      setBlocks(newBlocks);
      pushHistory(newBlocks);
      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.from("schedule_blocks").update({ day_of_week: bSlot.day, start_time: bSlot.start, end_time: bSlot.end, is_override: true }).eq("id", block.id),
        supabase.from("schedule_blocks").update({ day_of_week: aSlot.day, start_time: aSlot.start, end_time: aSlot.end, is_override: true }).eq("id", targetBlock.id),
      ]);
      if (e1 || e2) {
        toast({ title: "Swap failed", variant: "destructive" });
        loadBlocks(selectedGen);
      } else {
        toast({ title: "Blocks swapped", description: `${block.subject ?? "Block"} ⇄ ${targetBlock.subject ?? "block"}` });
      }
      return;
    }

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
      const { data, error } = await supabase.functions.invoke('replan-subgraph', {
        body: { generation_id: selectedGen, scope: { specialist_ids: [replanSuggestion.specialistId] } },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setReplanSuggestion(null);
      // Replan creates a NEW version (the current one is left intact). If nothing
      // matched the scope, no version is created — just inform the user.
      if (!(data as any)?.new_generation_id) {
        toast({ title: "Nothing to replan", description: (data as any)?.message ?? "No matching slots were found." });
        return;
      }
      toast({ title: "Replan complete", description: `${replanSuggestion.specialistName}'s slots were replanned into a new version.` });
      // Refresh the version list and switch to the newest version (the replan
      // result); loadGenerations selects the highest version.
      await loadGenerations();
    } catch (e: any) {
      toast({ title: "Replan failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setReplanLoading(false);
    }
  }

  async function setReviewState(next: "accepted" | "rejected") {
    if (!selectedGen) return;
    if (next === "accepted" && blockingError.blocked) {
      toast({
        title: "Resolve errors before accepting",
        description: `This schedule still has ${blockingError.reason}. Fix or remove them, then accept.`,
        variant: "destructive",
      });
      return;
    }
    setUpdatingReview(true);
    try {
      const { error } = await supabase
        .from("schedule_generations")
        .update({ review_state: next })
        .eq("id", selectedGen);
      if (error) throw error;
      // Accept = the positive learning signal for the scorer's weights (only
      // if no stronger signal like 'regenerated' was already recorded).
      if (next === "accepted" && selectedSchoolId) {
        await supabase
          .from("schedule_generations")
          .update({ feedback_signal: "accepted" })
          .eq("id", selectedGen)
          .is("feedback_signal", null);
        supabase.functions.invoke("update-scoring-weights", {
          body: { school_id: selectedSchoolId, generation_id: selectedGen },
        }).catch(() => {});
      }
      setGenerations((prev) => prev.map((g) => g.id === selectedGen ? { ...g, review_state: next } : g));
      toast({
        title: next === "accepted" ? "Schedule accepted" : "Schedule marked for changes",
        description: next === "accepted"
          ? "Exports and manual edits are unlocked."
          : "Opening the AI editor — describe what to change.",
      });
      if (next === "rejected") setChatOpen(true);
    } catch (e: any) {
      toast({ title: "Update failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setUpdatingReview(false);
    }
  }

  const hasWeekLabels = blocks.some((b: any) => b.week_label);
  const isAbStrategy = activeGen?.chosen_strategy === "ab_week";
  const isAaBbStrategy = activeGen?.chosen_strategy === "aa_bb_week";
  const showWeekSelector = hasWeekLabels || isAbStrategy || isAaBbStrategy;
  const weekOptions: { value: string; label: string }[] = isAaBbStrategy
    ? [{ value: "all", label: "All" }, { value: "AA", label: "Weeks 1–2 (AA)" }, { value: "BB", label: "Weeks 3–4 (BB)" }]
    : [{ value: "all", label: "All" }, { value: "A", label: "Week A" }, { value: "B", label: "Week B" }];
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

          {/* Density toggle */}
          <div className="flex items-center rounded-lg border border-border bg-background p-0.5 gap-0.5" title="Row density">
            <button
              type="button"
              onClick={() => setDensity("compact")}
              className={cn("px-2 py-1 text-[11px] font-medium rounded-md transition-colors", density === "compact" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >Compact</button>
            <button
              type="button"
              onClick={() => setDensity("fine")}
              className={cn("px-2 py-1 text-[11px] font-medium rounded-md transition-colors", density === "fine" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >Fine</button>
          </div>

          {/* Edit with AI */}
          <Button
            variant={chatOpen ? "secondary" : "default"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setChatOpen((v) => !v)}
            title="Open AI editor"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Edit with AI
          </Button>

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





          {/* Export dropdown — disabled while error-severity conflicts exist
              so a broken schedule can't be exported or printed. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                disabled={blockingError.blocked}
                title={blockingError.blocked ? `Resolve ${blockingError.reason} before exporting` : undefined}
              >
                <Download className="h-3.5 w-3.5" />
                Export
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={blockingError.blocked} onClick={() => !blockingError.blocked && setSpecExportOpen(true)}>
                <FileText className="h-4 w-4 mr-2" /> Specialist Planner (PDF)
              </DropdownMenuItem>
              <DropdownMenuItem disabled={blockingError.blocked} onClick={() => !blockingError.blocked && setAdminExportOpen(true)}>
                <LayoutGrid className="h-4 w-4 mr-2" /> Admin Overview (PDF)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={blockingError.blocked} onClick={() => !blockingError.blocked && window.print()}>
                <Printer className="h-4 w-4 mr-2" /> Print Current View
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ─── Review bar (visible until the user accepts) ─── */}
      {activeGen && activeGen.review_state === "pending" && (
        <div className="no-print sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="font-medium text-foreground">Review this schedule</span>
            <span className="text-muted-foreground">— accept it as-is, edit with AI, or regenerate from scratch.</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setReviewState("accepted")}
              disabled={updatingReview || blockingError.blocked}
              title={blockingError.blocked ? `Resolve ${blockingError.reason} before accepting` : undefined}
            >
              <Check className="h-3.5 w-3.5" /> Accept
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setReviewState("rejected")}
              disabled={updatingReview}
            >
              <MessageSquare className="h-3.5 w-3.5" /> Edit with AI
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => navigate("/app/prep")}
              disabled={updatingReview}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Regenerate
            </Button>
          </div>
        </div>
      )}



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
        const infos = scheduleWarnings.filter(w => w.severity === 'info');
        const sevDot = (sev: string) =>
          sev === 'error' ? 'bg-destructive'
          : sev === 'info' ? 'bg-sky-500'
          : 'bg-amber-500';
        const renderRow = (w: ScheduleWarning, i: number) => {
          const meta = warningMeta((w as any).type);
          return (
            <div key={i} className="flex items-start gap-2 text-xs py-0.5">
              <span className={cn('shrink-0 mt-1.5 h-1.5 w-1.5 rounded-full', sevDot(w.severity))} />
              <meta.Icon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-foreground mr-1.5">{meta.label}:</span>
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
        };
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
                {infos.length > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-sky-500/15 text-sky-700 dark:text-sky-400">
                    {infos.length} info
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
                  {errors.map((w, i) => renderRow(w, i))}
                </div>
              )}
              {warnings.length > 0 && (
                <div className="px-4 py-2.5 space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1.5">Warnings</p>
                  {warnings.slice(0, 10).map((w, i) => renderRow(w, i))}
                  {warnings.length > 10 && (
                    <p className="text-xs text-muted-foreground italic mt-1">+ {warnings.length - 10} more</p>
                  )}
                </div>
              )}
              {infos.length > 0 && (
                <div className="px-4 py-2.5 space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400 mb-1.5">Info</p>
                  {infos.slice(0, 6).map((w, i) => renderRow(w, i))}
                  {infos.length > 6 && (
                    <p className="text-xs text-muted-foreground italic mt-1">+ {infos.length - 6} more</p>
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
          {showWeekSelector && (
            <div className="flex items-center gap-2 no-print">
              <span className="text-sm font-medium text-muted-foreground">
                {isAbStrategy ? "A/B Week rotation:" : isAaBbStrategy ? "AA/BB rotation:" : "Week:"}
              </span>
              <Tabs value={weekFilter} onValueChange={setWeekFilter} className="w-auto">
                <TabsList className="h-8">
                  {weekOptions.map((opt) => (
                    <TabsTrigger key={opt.value} value={opt.value} className="text-xs px-3 h-7">
                      {opt.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              {!hasWeekLabels && (isAbStrategy || isAaBbStrategy) && (
                <span className="text-xs text-muted-foreground italic">
                  (no per-week labels on these blocks — generator may have fallen back to a single-week layout)
                </span>
              )}
            </div>
          )}

          <Tabs defaultValue="master">
            <TabsList className="no-print sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
              <TabsTrigger value="master">Master Grid</TabsTrigger>
              <TabsTrigger value="specialist">By Specialist</TabsTrigger>
              <TabsTrigger value="teacher">By Teacher</TabsTrigger>
            </TabsList>

            <TabsContent value="master">
              {trayBlocks.length > 0 && (
                <div className="mb-3">
                  <ScrabbleTray blocks={trayBlocks} onDragStart={handleTrayDragStart} />
                </div>
              )}

              <ScheduleGrid
                blocks={weekFiltered}
                timeSlots={timeSlots}
                recessBands={recessBands}
                conflictIds={conflictIds}
                liftedIds={trayIds}
                highlightIds={recentChangedIds}
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
                  <PrintViewButton label="Print Specialist View" disabled={blockingError.blocked} disabledReason={`Resolve ${blockingError.reason} before printing`} />
                </div>
                {filterSpecialist === "all" ? (
                  <div className="flex items-center justify-center rounded-xl border border-dashed border-border bg-card p-16 text-sm text-muted-foreground">
                    Pick a specialist above to see their week.
                  </div>
                ) : (
                  <ScheduleGrid
                    blocks={filteredBySpecialist}
                    timeSlots={timeSlots}
                    highlightIds={recentChangedIds}
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
                  <PrintViewButton label="Print Teacher View" disabled={blockingError.blocked} disabledReason={`Resolve ${blockingError.reason} before printing`} />
                </div>
                <ScheduleGrid
                  blocks={filteredByTeacher}
                  timeSlots={timeSlots}
                  highlightIds={recentChangedIds}
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
                    {editBlock.ai_explanation ?? editBlock.placement_reason ?? "No explanation recorded for this block."}
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
        calendarEvents={calendarEvents}
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

      {chatOpen && (
        <ScheduleChatPanel
          key={selectedGen || "no-gen"}
          generationId={selectedGen || null}
          onClose={() => setChatOpen(false)}
          onScheduleChanged={() => selectedGen && loadBlocks(selectedGen)}
          onApplied={flagChangedBlocks}
        />
      )}

    </div>
  );
}
