import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSchool } from "@/contexts/SchoolContext";
import { Button } from "@/components/ui/button";
import { GitCompare, AlertTriangle, X as XIcon, Sparkles, Loader2, MessageSquare, Check, RotateCcw, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTime as formatTimeDisplay, cn } from "@/lib/utils";
import { CONFLICT_STRATEGIES } from "@/lib/conflictStrategies";
import { Badge } from "@/components/ui/badge";
import { type BlockData } from "@/components/schedule/ScheduleGrid";
import BlockInspector from "@/components/schedule/BlockInspector";
import QuoteBanner from "@/components/schedule/QuoteBanner";
import { toast } from "@/hooks/use-toast";
import { analyzeScheduleBlocks, type ScheduleWarning } from "@/lib/strategyFeasibility";
import { warningMeta } from "@/lib/warningMeta";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buildTimeSlots, buildCompactTimeSlots, buildRecessBands, bandLabelMapFromStored, computeConflictIds, computeAutoFit, minToHMS, parseTime } from "@/lib/scheduleGrid";
import { evaluateDrop, placementProblem } from "@/lib/gridTargets";
import AddBlockDialog, { type AddBlockPayload } from "@/components/schedule/AddBlockDialog";
import { buildWeekCycle } from "@/lib/weekCycle";
import BrandedScheduleHeader from "@/components/schedule/BrandedScheduleHeader";
import { breakdownToPercent } from "@/lib/optimizerScore";
import QualityPanel from "@/components/schedule/QualityPanel";
import RefinementBanner from "@/components/schedule/RefinementBanner";
import WeightProposal from "@/components/schedule/WeightProposal";
import ConflictResolver, { type ConflictOutcome } from "@/components/schedule/ConflictResolver";
import ScheduleToolbar from "@/components/schedule/ScheduleToolbar";
import WeekGrid from "@/components/schedule/WeekGrid";
import { diffSchedules, diffSummary } from "@/lib/scheduleDiff";
import ApplyOpsBar, { type OpsDelta } from "@/components/schedule/ApplyOpsBar";
import { buildGhostOverlay, toggleRejected, acceptedOps, type PreviewOp, type ProposalItem } from "@/lib/ghostPreview";
import ScheduleCommandPalette, { type CommandAction } from "@/components/schedule/ScheduleCommandPalette";
import KeyboardShortcutsSheet from "@/components/schedule/KeyboardShortcutsSheet";
import WeekCyclePicker from "@/components/schedule/WeekCyclePicker";
import MobileDayPager from "@/components/schedule/MobileDayPager";
import FilterRail, { FilterRailSection } from "@/components/layout/FilterRail";
import { getSubjectColorClass, getSubjectLeftBorderClass } from "@/lib/subjectColors";
import { Undo2, Redo2, Wand2, Download, FileText, Printer, Keyboard } from "lucide-react";

// Deferred: the AI chat (streamdown + shiki + mermaid) and the PDF export modals
// (@react-pdf/renderer) are heavy and only used on demand, so they load as their
// own async chunks rather than riding in the schedule route bundle.
const ScheduleChatPanel = lazy(() => import("@/components/schedule/ScheduleChatPanel"));
const SpecialistExportModal = lazy(() => import("./exports/SpecialistExportModal"));
const AdminExportModal = lazy(() => import("./exports/AdminExportModal"));

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

const FIX_STEP_MAP: Record<string, number> = {
  recess: 3, specialists: 4, teachers: 5, rotation: 6, clubs: 7, events: 8, conflicts: 9,
};

// ONE label source for strategies (lib/conflictStrategies) — three divergent
// label sets meant the same strategy read differently per page. Extra keys are
// engine-internal values the canonical list doesn't carry.
const EXTRA_STRATEGY_LABELS: Record<string, string> = {
  extra_rotation: "Extra Rotation",
  standard: "Standard",
  cpsat_optimal: "Optimized",
};
const humanizeStrategy = (s?: string | null) => {
  if (!s) return "";
  const canonical = CONFLICT_STRATEGIES.find((c) => c.key === s)?.title;
  return canonical ?? EXTRA_STRATEGY_LABELS[s] ?? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

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
  // Newest engine-affecting settings timestamp (ms) — drives the regenerate nudge.
  const [settingsChangedAt, setSettingsChangedAt] = useState<number | null>(null);
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
  const [conflictOutcome, setConflictOutcome] = useState<ConflictOutcome | null>(null);
  const [explainPending, setExplainPending] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [updatingReview, setUpdatingReview] = useState(false);
  const [specExportOpen, setSpecExportOpen] = useState(false);
  const [adminExportOpen, setAdminExportOpen] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [replanSuggestion, setReplanSuggestion] = useState<{ specialistId: string; specialistName: string } | null>(null);
  const [replanLoading, setReplanLoading] = useState(false);
  // Blocks recently changed by the AI editor — highlighted in the grid so the
  // user can SEE what changed. Cleared automatically.
  const [recentChangedIds, setRecentChangedIds] = useState<Set<string>>(new Set());
  const changedClearTimer = useRef<number | null>(null);
  const flagChangedBlocks = useCallback((ids: string[]) => {
    if (!ids.length) return;
    // Highlight persists until the NEXT set of changes (or page reload) so the
    // user can actually find what the AI changed instead of a fading 8s glow.
    setRecentChangedIds(new Set(ids));
    if (changedClearTimer.current) window.clearTimeout(changedClearTimer.current);
    // Scroll the first changed block into view so the user sees the highlight.
    requestAnimationFrame(() => {
      const first = ids[0];
      const el = document.querySelector(`[data-block-id="${first}"]`) as HTMLElement | null;
      el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    });
  }, []);
  const [density, setDensity] = useState<"compact" | "fine">("compact");

  // ── Ghost preview (edit-with-ai v2) ──
  // Ops proposed by the chat panel (accepted, unapplied) — overlaid as ghosts.
  const [chatPreviewOps, setChatPreviewOps] = useState<PreviewOp[]>([]);
  // Ops proposed by a QualityPanel one-click Fix (page-owned Apply bar).
  const [fixItems, setFixItems] = useState<ProposalItem[]>([]);
  const [fixRejected, setFixRejected] = useState<Set<string>>(new Set());
  const [fixDelta, setFixDelta] = useState<OpsDelta | null>(null);
  const [fixApplying, setFixApplying] = useState(false);
  const [fixingKey, setFixingKey] = useState<string | null>(null);

  // Locked blocks
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());

  // Feedback signal: track manual overrides and fire 'heavily_edited' after 3+
  const manualEditCountRef = useRef(0);
  const heavilyEditedFiredRef = useRef(false);

  // Learnable-weights profile (power 7): active weights + any staged proposal.
  const [weightProfile, setWeightProfile] = useState<{ weights: Record<string, number> | null; proposed_weights: Record<string, number> | null } | null>(null);
  const loadWeightProfile = useCallback(async () => {
    if (!selectedSchoolId) return;
    const { data } = await supabase
      .from("scoring_weight_profiles")
      .select("*")
      .eq("school_id", selectedSchoolId)
      .maybeSingle();
    const row = data as any;
    setWeightProfile(row ? { weights: row.weights ?? null, proposed_weights: row.proposed_weights ?? null } : null);
  }, [selectedSchoolId]);

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
      // "?" opens the shortcuts reference (ignored while typing in a field).
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        const el = e.target as HTMLElement | null;
        const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
        if (!typing) { e.preventDefault(); setShortcutsOpen((v) => !v); }
      }
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
    if (selectedSchoolId) { loadGenerations(); loadWeightProfile(); }
    else setLoading(false);
  }, [user, selectedSchoolId, schoolLoading]);

  // Load blocks ONLY when the selected generation changes. We intentionally
  // omit specialists/teachers from the deps: those arrays sometimes get a new
  // reference from upstream contexts after an optimistic swap, and reloading
  // here would clobber `setBlocks(candidate)` before the DB write commits.
  useEffect(() => {
    if (selectedGen && specialists.length > 0) loadBlocks(selectedGen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGen]);

  // When specialists/teachers arrive AFTER the first block load, re-map the
  // existing blocks in place so names/grades fill in — without re-fetching.
  useEffect(() => {
    if (!blocks.length) return;
    setBlocks((prev) => mapBlocks(prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialists, teachers]);

  async function loadGenerations() {
    setLoading(true);
    setLoadError(false);

    // A thrown query (network blip) must land in the retry panel, not hang the
    // skeleton forever — and must never masquerade as "no schedule yet".
    let genRes, specRes, teachRes, recessRes, clubsRes, schoolRes, calRes;
    try {
      [genRes, specRes, teachRes, recessRes, clubsRes, schoolRes, calRes] = await Promise.all([
        supabase.from("schedule_generations").select("*").eq("school_id", selectedSchoolId!).order("version", { ascending: false }),
        supabase.from("specialists").select("id, name, subject, updated_at").eq("school_id", selectedSchoolId!),
        supabase.from("classroom_teachers").select("id, name, grade, combo_partner_id, updated_at").eq("school_id", selectedSchoolId!),
        supabase.from("recess_lunch_config").select("*").eq("school_id", selectedSchoolId!),
        supabase.from("clubs").select("*").eq("school_id", selectedSchoolId!),
        supabase.from("schools").select("school_year, start_time, end_time, recess_grade_bands, updated_at").eq("id", selectedSchoolId!).maybeSingle(),
        supabase.from("parsed_calendar_events").select("event_date, end_date, title, event_type").eq("school_id", selectedSchoolId!).eq("approved", true),
      ]);
    } catch (err) {
      console.error("MasterSchedule load failed:", err);
      setLoadError(true);
      setLoading(false);
      return;
    }
    // A failed critical query (RLS, outage) also routes to retry — generations
    // returning an error must not render as the "generate your first schedule"
    // empty state.
    if (genRes.error || specRes.error) {
      console.error("MasterSchedule load failed:", genRes.error ?? specRes.error);
      setLoadError(true);
      setLoading(false);
      return;
    }

    setSchoolStartTime(schoolRes.data?.start_time ?? null);
    setSchoolEndTime(schoolRes.data?.end_time ?? null);

    setSpecialists(specRes.data ?? []);
    setTeachers(teachRes.data ?? []);
    setRecessConfig(recessRes.data ?? []);
    // Shared converter also drops garbage labels (raw band_ keys stored as labels).
    setRecessBandLabels(bandLabelMapFromStored((schoolRes.data as any)?.recess_grade_bands));

    // Latest engine-affecting settings change, for the "regenerate?" nudge:
    // schools/specialists/teachers bump updated_at on edit; recess/clubs rows
    // only carry created_at (an edit-in-place won't register — acceptable).
    {
      const stamps: number[] = [];
      const push = (t?: string | null) => { const ms = t ? Date.parse(t) : NaN; if (Number.isFinite(ms)) stamps.push(ms); };
      push((schoolRes.data as any)?.updated_at);
      for (const s of specRes.data ?? []) push((s as any).updated_at);
      for (const t of teachRes.data ?? []) push((t as any).updated_at);
      for (const r of recessRes.data ?? []) push((r as any).created_at);
      for (const c of clubsRes.data ?? []) push((c as any).created_at);
      setSettingsChangedAt(stamps.length ? Math.max(...stamps) : null);
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

  // Diff computation (power 4): identity-aware, so a moved class reads as MOVED,
  // not removed+added — the minimal-perturbation promise made visible.
  const diffData = useMemo(() => {
    if (!showDiff || !diffBlocks.length) return null;
    const d = diffSchedules(diffBlocks, blocks);
    return { ...d, total: blocks.length, summary: diffSummary(d) };
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
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;

    // ONE decision, shared with the drag-time legal-target wash (gridTargets is the
    // SSOT-mirror — the highlight and the commit can't disagree).
    const evaln = evaluateDrop({
      block, allBlocks: blocks, targetDay: newDay, targetTime: newTime, lockedIds,
      recessBands, schoolStart: schoolStartTime, schoolEnd: schoolEndTime,
    });

    if (evaln.kind === "self") return;
    if (!evaln.legal || !evaln.changes) {
      if (evaln.reason) {
        const title = evaln.kind === "locked" ? "This block is locked" : evaln.kind === "swap" ? "Can't swap these" : "Can't drop here";
        toast({ title, description: evaln.reason, variant: "destructive" });
      }
      return;
    }

    // Apply the SSOT-approved change(s) optimistically, then persist.
    const changeById = new Map(evaln.changes.map((c) => [c.id, c]));
    const candidate = blocks.map((b) => {
      const c = changeById.get(b.id);
      return c ? { ...b, day_of_week: c.day_of_week, start_time: c.start_time, end_time: c.end_time, is_override: true } : b;
    });
    setBlocks(candidate);
    pushHistory(candidate);

    const movedIds = evaln.changes.map((c) => c.id);
    const results = await Promise.all(
      evaln.changes.map((c) =>
        supabase.from("schedule_blocks")
          .update({ day_of_week: c.day_of_week, start_time: c.start_time, end_time: c.end_time, is_override: true })
          .eq("id", c.id),
      ),
    );
    if (results.some((r) => r.error)) {
      toast({ title: evaln.kind === "swap" ? "Swap couldn't be saved" : "Move couldn't be saved", variant: "destructive" });
      loadBlocks(selectedGen);
      return;
    }

    if (evaln.kind === "swap") {
      const targetBlock = blocks.find((b) => movedIds.includes(b.id) && b.id !== blockId);
      toast({ title: "Swapped ✓", description: `${block.subject ?? "Block"} ⇄ ${targetBlock?.subject ?? "block"}` });
    } else {
      toast({ title: "Moved ✓", description: evaln.shortened ? `Shortened to ${evaln.shortenedTo} min to fit.` : undefined });
    }
    flagChangedBlocks(movedIds);
    const spec = specialists.find((s) => s.id === block.specialist_id || s.name === block.specialist_name);
    if (spec) setReplanSuggestion({ specialistId: spec.id, specialistName: spec.name });
  }

  // ── Add a NEW class tile on an empty slot (the "+" on empty grid cells). ──
  // Legality runs through the SAME primitives as drag-and-drop: computeAutoFit
  // sizes the block against neighbors/recess/school end, placementProblem
  // rejects specialist/teacher clashes — then the row persists as an override.
  const [addSlot, setAddSlot] = useState<{ day: string; time: string } | null>(null);

  async function handleAddBlock(p: AddBlockPayload): Promise<boolean> {
    if (!addSlot || !selectedGen) return false;
    const spec = specialists.find((s) => s.id === p.specialistId);
    if (!spec) return false;

    const draft: BlockData = {
      id: `new-${crypto.randomUUID()}`,
      day_of_week: addSlot.day,
      start_time: addSlot.time,
      end_time: minToHMS(parseTime(addSlot.time) + p.durationMin).slice(0, 5),
      subject: spec.subject,
      specialist_id: spec.id,
      specialist_name: spec.name,
      teacher_id: p.teacherId,
      teacher_name: p.teacherId ? (teachers.find((t) => t.id === p.teacherId)?.name ?? null) : null,
      grade: p.grade || null,
      week_label: null,
    };

    // Fit the duration into the gap (next block / recess band / school end).
    const fit = computeAutoFit({
      movingBlock: draft, targetDay: addSlot.day, targetTime: addSlot.time,
      allBlocks: blocks, recessBands, schoolEnd: schoolEndTime,
    });
    if (!fit.ok) {
      toast({ title: "Can't add a class here", description: fit.reason, variant: "destructive" });
      return false;
    }
    const candidateBlock = { ...draft, start_time: fit.start, end_time: fit.end };

    // Same clash rules the drag wash uses (specialist/teacher overlap, recess,
    // school hours) against the full current schedule.
    const problem = placementProblem([...blocks, candidateBlock], [candidateBlock.id], {
      recessBands, schoolStart: schoolStartTime, schoolEnd: schoolEndTime,
    });
    if (problem) {
      toast({ title: "Can't add a class here", description: problem, variant: "destructive" });
      return false;
    }

    const { data: inserted, error } = await supabase.from("schedule_blocks").insert({
      generation_id: selectedGen,
      day_of_week: candidateBlock.day_of_week,
      start_time: candidateBlock.start_time,
      end_time: candidateBlock.end_time,
      subject: candidateBlock.subject,
      specialist_id: candidateBlock.specialist_id,
      teacher_id: candidateBlock.teacher_id,
      grade: candidateBlock.grade,
      week_label: null,
      is_override: true,
    }).select("id").single();
    if (error || !inserted) {
      toast({ title: "Couldn't save the new class", description: error?.message, variant: "destructive" });
      return false;
    }

    const next = [...blocks, { ...candidateBlock, id: inserted.id, is_override: true }];
    setBlocks(next);
    pushHistory(next);
    flagChangedBlocks([inserted.id]);
    toast({
      title: "Class added ✓",
      description: `${spec.subject} · ${candidateBlock.teacher_name ?? `Grade ${candidateBlock.grade}`}${fit.shortened ? ` — shortened to ${fit.duration} min to fit` : ""}`,
    });
    manualEditCountRef.current++;
    return true;
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
        // Phase-4 propose: this STAGES a clamped weight proposal (does not apply).
        // Refresh the profile so the human-gated WeightProposal surfaces it.
        supabase.functions.invoke('update-scoring-weights', {
          body: { school_id: selectedSchoolId, generation_id: selectedGen, action: 'propose' },
        }).then(() => loadWeightProfile()).catch(() => {});
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

  // Power 3: generate AI explanations on demand for the current generation, then
  // merge them in so the inspector's "why is this here?" fills in live.
  async function handleRequestExplain() {
    if (!selectedGen) return;
    setExplainPending(true);
    try {
      await supabase.functions.invoke("explain-schedule", { body: { generation_id: selectedGen } });
      const { data: refreshed } = await supabase.from("schedule_blocks").select("id, ai_explanation").eq("generation_id", selectedGen);
      if (refreshed) {
        const explMap = new Map(refreshed.map((r: { id: string; ai_explanation: string | null }) => [r.id, r.ai_explanation]));
        setBlocks((prev) => prev.map((b) => ({ ...b, ai_explanation: explMap.get(b.id) ?? b.ai_explanation })));
      }
    } catch {
      toast({ title: "Couldn't generate explanation", description: "Try again in a moment.", variant: "destructive" });
    } finally {
      setExplainPending(false);
    }
  }

  // Power 5 (pick-one-of-N): after the user applies a chosen fix from the block
  // inspector, reload the canonical schedule and highlight what moved.
  async function handleConflictFixApplied(changedIds: string[]) {
    if (!selectedGen) return;
    await loadBlocks(selectedGen);
    if (changedIds.length) flagChangedBlocks(changedIds);
  }

  // ── edit-with-ai v2: one-click Fix from the QualityPanel ──
  // Conflict-type issues run the deterministic cascade (existing flow); soft
  // issues run the scoped improve-quality engine pass and preview through the
  // SAME ghost overlay + Apply bar as the chat.
  async function handleFixIssue(penaltyKey: string) {
    if (!selectedGen || fixingKey) return;
    if (penaltyKey === "errors" || penaltyKey === "warnings") {
      handleResolveWithAI();
      return;
    }
    setFixingKey(penaltyKey);
    try {
      const { data, error } = await supabase.functions.invoke("improve-quality", {
        body: { generation_id: selectedGen, focus: penaltyKey },
      });
      if (error || (data as any)?.error) throw new Error((data as any)?.error ?? error?.message ?? "Fix failed");
      const d = data as { ops?: PreviewOp[]; quality_delta?: number; note?: string | null };
      const ops = Array.isArray(d.ops) ? d.ops : [];
      if (ops.length === 0) {
        // Honest ceiling: the engine found no legal improving move — surface the
        // structured reason + the named input change from the confidence signal.
        const rec = (activeGen?.quality_confidence as any)?.recommendation as string | undefined;
        toast({
          title: "No safe fix available",
          description: [d.note ?? "No legal move improves this without breaking a rule.", rec].filter(Boolean).join(" "),
        });
        return;
      }
      setFixItems(ops.map((op, i) => ({ id: `fix:${i}`, op })));
      setFixRejected(new Set());
      setFixDelta(typeof d.quality_delta === "number" ? { quality_delta: d.quality_delta } : null);
    } catch (e: any) {
      toast({ title: "Fix failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setFixingKey(null);
    }
  }

  function clearFixProposal() {
    setFixItems([]);
    setFixRejected(new Set());
    setFixDelta(null);
  }

  async function applyFixProposal() {
    if (!selectedGen || fixApplying) return;
    const ops = acceptedOps(fixItems, fixRejected);
    if (ops.length === 0) return;
    setFixApplying(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Signed out — please sign in again.");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apply-schedule-edits`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ generation_id: selectedGen, ops }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error ?? `HTTP ${resp.status}`);
      const skipped: string[] = Array.isArray(data.skipped) ? data.skipped : [];
      clearFixProposal();
      await loadBlocks(selectedGen);
      const changedIds: string[] = Array.isArray(data.changed_block_ids) ? data.changed_block_ids : [];
      if (changedIds.length) flagChangedBlocks(changedIds);
      toast({
        title: skipped.length ? `Applied ${data.applied}, ${skipped.length} couldn't apply` : `Applied ${data.applied} fix${data.applied === 1 ? "" : "es"}`,
        description: skipped.length ? skipped[0] : "The schedule has been updated.",
        variant: skipped.length ? "destructive" : undefined,
      });
    } catch (e: any) {
      toast({ title: "Couldn't apply the fix", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setFixApplying(false);
    }
  }

  // Power 5: the deterministic engine resolves conflicts (smallest blast radius,
  // every option SSOT-legal) and the LLM only narrates. We render the engine's
  // applied fixes + any escalations, and highlight what moved (power 4 synergy).
  async function handleResolveWithAI() {
    if (!selectedGen) return;
    const errors = scheduleWarnings.filter(w => w.severity === 'error');
    if (errors.length === 0 && conflictIds.size === 0) {
      toast({ title: "No conflicts to resolve" });
      return;
    }
    setResolvingAI(true);
    setConflictOutcome(null);
    const before = blocks; // snapshot for the moved-block highlight
    // Hard timeout so the spinner can never hang forever if the gateway is slow.
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 90_000);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Signed out — please sign in again.");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-conflicts-ai`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        // The engine detects conflicts from the blocks itself (no client list).
        body: JSON.stringify({ generation_id: selectedGen }),
        signal: controller.signal,
      });
      const data = await resp.json().catch(() => ({})) as Record<string, unknown>;
      if (!resp.ok || data?.error) {
        toast({ title: "Conflict fix failed", description: (data?.error as string) ?? `HTTP ${resp.status}`, variant: "destructive" });
        return;
      }
      const outcome: ConflictOutcome = {
        resolved: typeof data.resolved === "number" ? data.resolved : 0,
        escalated: typeof data.escalated === "number" ? data.escalated : 0,
        applied_changes: Array.isArray(data.applied_changes) ? data.applied_changes as ConflictOutcome["applied_changes"] : [],
        escalations: Array.isArray(data.escalations) ? data.escalations as ConflictOutcome["escalations"] : [],
        summary: typeof data.summary === "string" ? data.summary : undefined,
      };
      setConflictOutcome(outcome);

      // Reload the canonical schedule (warnings + explanations), then highlight
      // exactly the blocks the engine moved.
      const { data: rows } = await supabase.from("schedule_blocks").select("*").eq("generation_id", selectedGen);
      const after = mapBlocks(rows ?? []);
      const diff = diffSchedules(before, after);
      await loadBlocks(selectedGen);
      if (diff.movedIds.length) flagChangedBlocks(diff.movedIds);

      if (outcome.resolved > 0) {
        toast({ title: "Conflicts resolved", description: `${outcome.resolved} fixed with the smallest possible change.` });
      } else if (outcome.escalated > 0) {
        toast({ title: "Some conflicts need your decision", description: "See the details below.", variant: "destructive" });
      }
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      toast({
        title: aborted ? "Fix took too long" : "Conflict fix failed",
        description: aborted
          ? "The request timed out after 90 seconds. Try again, or edit manually."
          : (e instanceof Error ? e.message : "Unknown error"),
        variant: "destructive",
      });
    } finally {
      window.clearTimeout(timeoutId);
      setResolvingAI(false);
    }
  }

  const activeGen = useMemo(
    () => (generations.find((g: any) => g.id === selectedGen) as any) ?? null,
    [generations, selectedGen],
  );

  // Power 6: gate background refinement to a fresh version that is pending review,
  // is not itself a refinement, and has no refined child yet (so it runs once).
  const refinedChildParentIds = useMemo(
    () => new Set(generations.map((g: any) => g.refined_from_generation_id).filter(Boolean)),
    [generations],
  );
  const enableRefine = !!activeGen && activeGen.review_state === "pending"
    && !activeGen.refined_from_generation_id && !refinedChildParentIds.has(selectedGen);

  // When the admin reviews a refined version: switch to it and show the diff vs
  // the version it improved (power 4 + 6 synergy) — they compare, then accept.
  async function handleReviewRefined(newGenId: string) {
    const { data } = await supabase
      .from("schedule_generations")
      .select("*")
      .eq("school_id", selectedSchoolId!)
      .order("version", { ascending: false });
    const rows = (data ?? []) as any[];
    setGenerations(rows);
    setSelectedGen(newGenId);
    const parentId = rows.find((g) => g.id === newGenId)?.refined_from_generation_id;
    if (parentId) loadDiffBlocks(parentId);
  }

  async function handleReplan() {
    if (!replanSuggestion || !selectedGen) return;
    setReplanLoading(true);
    const before = blocks; // snapshot to show how LITTLE changed (power 4)
    try {
      const { data, error } = await supabase.functions.invoke('replan-subgraph', {
        body: { generation_id: selectedGen, scope: { specialist_ids: [replanSuggestion.specialistId] } },
      });
      if (error) throw error;
      const resp = data as { error?: string; new_generation_id?: string; message?: string };
      if (resp?.error) throw new Error(resp.error);
      setReplanSuggestion(null);
      // Replan creates a NEW version (the current one is left intact). If nothing
      // matched the scope, no version is created — just inform the user.
      if (!resp?.new_generation_id) {
        toast({ title: "Nothing to replan", description: resp?.message ?? "No matching slots were found." });
        return;
      }
      const newGenId = resp.new_generation_id;
      // Minimal-perturbation made visible: diff the new version against the one
      // it replanned, and highlight exactly what moved.
      const { data: rows } = await supabase.from("schedule_blocks").select("*").eq("generation_id", newGenId);
      const after = mapBlocks(rows ?? []);
      const diff = diffSchedules(before, after);
      await loadGenerations(); // refresh list + switch to the newest (the replan)
      setSelectedGen(newGenId);
      if (diff.movedIds.length) flagChangedBlocks(diff.movedIds);
      toast({
        title: "Replanned",
        description: `${replanSuggestion.specialistName}'s slots were replanned. ${diffSummary(diff)}`,
      });
    } catch (e) {
      toast({ title: "Replan failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setReplanLoading(false);
    }
  }

  async function handleExportXlsx() {
    if (!selectedGen || !selectedSchoolId || exportingXlsx) return;
    setExportingXlsx(true);
    try {
      // Dynamic import keeps ExcelJS out of the schedule route chunk until the
      // coordinator actually exports.
      const { exportScheduleXlsx } = await import("@/lib/exportScheduleXlsx");
      const ok = await exportScheduleXlsx({ schoolId: selectedSchoolId, generationId: selectedGen, schoolName: selectedSchool?.name, schoolYear });
      if (ok) toast({ title: "Spreadsheet exported ✓", description: "A branded Excel file with the master schedule and each specialist's week." });
      else toast({ title: "Nothing to export", description: "Generate a schedule first.", variant: "destructive" });
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message ?? "Couldn't build the spreadsheet.", variant: "destructive" });
    } finally {
      setExportingXlsx(false);
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

  // The DATED cycle (lib/weekCycle) — drives the WeekCyclePicker so the selector
  // shows real Mon–Fri ranges with today highlighted, holiday-aware.
  const weekCycle = useMemo(() => {
    const strategy = isAbStrategy ? "ab_week" : isAaBbStrategy ? "aa_bb_week" : "standard";
    return buildWeekCycle({
      strategy,
      startDate: (selectedSchool as any)?.school_year_start ?? null,
      endDate: (selectedSchool as any)?.school_year_end ?? null,
      schoolYear: selectedSchool?.school_year ?? null,
      events: calendarEvents,
    });
  }, [isAbStrategy, isAaBbStrategy, selectedSchool, calendarEvents]);
  const weekFiltered = weekFilter === "all"
    ? blocks
    : blocks.filter((b: any) => !b.week_label || b.week_label === weekFilter);

  // ── Ghost preview overlay (edit-with-ai v2): proposed-but-unapplied ops from
  // the chat panel and/or a QualityPanel Fix render as dashed ghosts at their
  // destination, faded origins, and struck-through deletes. Display-only. ──
  const previewOpsAll = useMemo(
    () => [...chatPreviewOps, ...acceptedOps(fixItems, fixRejected)],
    [chatPreviewOps, fixItems, fixRejected],
  );
  const ghostOverlay = useMemo(
    () => buildGhostOverlay(blocks, previewOpsAll, {
      specialistName: (id) => (id ? specialists.find((s) => s.id === id)?.name ?? null : null),
      teacherName: (id) => (id ? teachers.find((t) => t.id === id)?.name ?? null : null),
    }),
    [blocks, previewOpsAll, specialists, teachers],
  );
  const displayBlocks = useMemo(
    () => (ghostOverlay.ghostBlocks.length ? [...weekFiltered, ...ghostOverlay.ghostBlocks] : weekFiltered),
    [weekFiltered, ghostOverlay],
  );

  const filteredBySpecialist = filterSpecialist === "all" ? displayBlocks : displayBlocks.filter((b) => {
    const spec = specialists.find((s) => s.name === b.specialist_name);
    return spec?.id === filterSpecialist;
  });

  const filteredByTeacher = filterTeacher === "all" ? displayBlocks : displayBlocks.filter((b) => {
    const t = teachers.find((t) => t.name === b.teacher_name);
    return t?.id === filterTeacher;
  });

  const filteredByDay = displayBlocks.filter((b) => b.day_of_week === filterDay);
  const subjectLegend = Array.from(new Set(specialists.map((s) => s.subject).filter(Boolean)));

  // Command palette actions (⌘K) — thin wrappers over existing handlers.
  const commandActions = useMemo<CommandAction[]>(() => {
    const base: CommandAction[] = [
      { id: "undo", group: "Edit", label: "Undo", icon: Undo2, shortcut: "⌘Z", disabled: !canUndo, run: handleUndo },
      { id: "redo", group: "Edit", label: "Redo", icon: Redo2, shortcut: "⌘⇧Z", disabled: !canRedo, run: handleRedo },
      { id: "chat", group: "AI", label: "Edit with AI", icon: Wand2, keywords: ["chat", "assistant"], run: () => setChatOpen(true) },
      { id: "fix", group: "AI", label: "Fix conflicts", icon: Wand2, keywords: ["resolve", "conflict"], disabled: conflictIds.size === 0 || resolvingAI, run: () => { void handleResolveWithAI(); } },
      { id: "xlsx", group: "Export", label: "Export branded spreadsheet (XLSX)", icon: Download, disabled: blockingError.blocked || exportingXlsx, run: () => { void handleExportXlsx(); } },
      { id: "spec-pdf", group: "Export", label: "Export specialist planner (PDF)", icon: FileText, disabled: blockingError.blocked, run: () => setSpecExportOpen(true) },
      { id: "admin-pdf", group: "Export", label: "Export admin overview (PDF)", icon: FileText, disabled: blockingError.blocked, run: () => setAdminExportOpen(true) },
      { id: "print", group: "Export", label: "Print schedule", icon: Printer, disabled: blockingError.blocked, run: () => window.print() },
      { id: "shortcuts", group: "Help", label: "Keyboard shortcuts", icon: Keyboard, shortcut: "?", run: () => setShortcutsOpen(true) },
    ];
    const jumps: CommandAction[] = specialists.map((s) => ({
      id: `jump-spec-${s.id}`, group: "Jump to specialist", label: `${s.name} · ${s.subject}`,
      keywords: ["specialist", s.subject], run: () => setFilterSpecialist(s.id),
    }));
    return [...base, ...jumps];
  }, [canUndo, canRedo, handleUndo, handleRedo, conflictIds.size, resolvingAI, blockingError.blocked, exportingXlsx, specialists]);

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
      <div className="no-print">
        <BrandedScheduleHeader
          title="Master Schedule"
          subtitle="Specialist Ops! · Weekly Planner"
          schoolName={selectedSchool?.name}
          schoolYear={selectedSchool?.school_year ?? undefined}
        />
      </div>
      {/* ─── Toolbar ─── */}
      <ScheduleToolbar
        schoolName={selectedSchool?.name}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        lockedCount={lockedIds.size}
        generations={generations}
        selectedGen={selectedGen}
        onSelectGen={(id) => { setSelectedGen(id); setShowDiff(false); }}
        diffGenId={diffGenId}
        onCompare={loadDiffBlocks}
        onCloseDiff={() => setShowDiff(false)}
        density={density}
        onDensityChange={setDensity}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((v) => !v)}
        blockingError={blockingError}
        exportingXlsx={exportingXlsx}
        onSpecExport={() => setSpecExportOpen(true)}
        onAdminExport={() => setAdminExportOpen(true)}
        onExportXlsx={handleExportXlsx}
        onPrint={() => window.print()}
      />

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



      {/* ─── Power 1+2: confidence hero + human quality summary ─── */}
      {activeGen && (
        <QualityPanel
          breakdown={(activeGen.score_breakdown as Record<string, number> | null) ?? null}
          confidence={activeGen.quality_confidence ?? null}
          refining={enableRefine}
          verifyReview={{ score: activeGen.verify_quality_score ?? null, summary: activeGen.verify_summary ?? null }}
          onFixIssue={handleFixIssue}
          fixingKey={fixingKey}
        />
      )}

      {/* Honest capacity signal: the solver had to drop the full-coverage floor —
          this is a staffing/time limit, not a bug, and the coordinator should
          know what to change rather than just seeing a lower %. */}
      {/* Settings changed AFTER this schedule was generated — nudge to regenerate.
          60s slack: Prep saves strategies moments before enqueueing a generation. */}
      {(() => {
        if (!activeGen || settingsChangedAt == null) return null;
        const genAtRaw = (activeGen as any).generated_at ?? (activeGen as any).created_at;
        const genAt = genAtRaw ? Date.parse(genAtRaw) : NaN;
        if (!Number.isFinite(genAt) || settingsChangedAt <= genAt + 60_000) return null;
        return (
          <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 no-print">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="flex-1 text-sm text-amber-700 dark:text-amber-300">
              Your school settings changed after this schedule was generated — regenerate to pick them up.
            </p>
            <Button variant="outline" size="sm" className="h-7 shrink-0 gap-1 text-xs" onClick={() => navigate("/app/prep")}>
              <RefreshCw className="h-3 w-3" /> Regenerate
            </Button>
          </div>
        );
      })()}

      {activeGen && (activeGen as any).coverage_relaxed && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 no-print">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-300">
            <span className="font-medium">Not every class could see every specialist this week</span> — your
            school is at its capacity limit. To reach full coverage: add specialist days/hours, switch to an
            A/B week rotation (each class visits every other week), or use 30-minute classes for the younger grades.
          </p>
        </div>
      )}

      {/* ── edit-with-ai v2: page-level Apply bar for QualityPanel fixes ── */}
      {fixItems.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden no-print">
          <ApplyOpsBar
            title="Engine fix ready — preview on the grid"
            items={fixItems}
            rejectedIds={fixRejected}
            onToggle={(id) => setFixRejected((prev) => toggleRejected(prev, id))}
            delta={fixDelta}
            applying={fixApplying}
            onApply={applyFixProposal}
            onDiscard={clearFixProposal}
          />
        </div>
      )}

      {/* ─── Power 6: background refinement (quietly gets better) ─── */}
      <RefinementBanner
        generationId={selectedGen || null}
        enabled={enableRefine}
        onReviewRefined={handleReviewRefined}
      />

      {/* ─── Power 7: learnable-weights proposal (human-gated) ─── */}
      <WeightProposal
        schoolId={selectedSchoolId ?? null}
        activeWeights={weightProfile?.weights ?? null}
        proposedWeights={weightProfile?.proposed_weights ?? null}
        onResolved={loadWeightProfile}
      />

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
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 no-print">
          <GitCompare className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm text-foreground">{diffData.summary}</span>
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-primary">{diffData.moved} moved</span>
            {" · "}
            <span className="font-medium text-success">+{diffData.added}</span>
            {" · "}
            <span className="font-medium text-destructive">−{diffData.removed}</span>
            {" · "}
            {diffData.unchanged} unchanged
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-7 text-xs"
            disabled={!diffData.moved}
            onClick={() => diffData.movedIds.length && flagChangedBlocks(diffData.movedIds)}
            title="Highlight the blocks that moved"
          >
            Highlight changes
          </Button>
          <Button variant="ghost" size="sm" className="h-7" onClick={() => { setShowDiff(false); setDiffGenId(null); }}>
            Close
          </Button>
        </div>
      )}

      {quote && <QuoteBanner text={quote.text} author={quote.author} schoolId={selectedSchoolId} canRegenerate />}



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

      {/* ─── Power 5: deterministic conflict-cascade result ─── */}
      {conflictOutcome && (
        <ConflictResolver outcome={conflictOutcome} onDismiss={() => setConflictOutcome(null)} />
      )}

      {/* ─── Schedule grid (hero) — three-pane on desktop, day pager on mobile ─── */}
      <div className="md:flex md:items-start md:gap-4">
        <FilterRail className="mb-4 md:mb-0">
          {showWeekSelector && (
            <FilterRailSection title="Week">
              {weekCycle && (isAbStrategy || isAaBbStrategy) ? (
                <WeekCyclePicker cycle={weekCycle} value={weekFilter} onChange={setWeekFilter} />
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {weekOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setWeekFilter(opt.value)}
                      className={cn(
                        "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors motion-reduce:transition-none",
                        weekFilter === opt.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary/40",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </FilterRailSection>
          )}
          {subjectLegend.length > 0 && (
            <FilterRailSection title="Subjects">
              <ul className="flex flex-wrap gap-1.5">
                {subjectLegend.map((s) => (
                  <li key={s} className={cn("rounded border-l-2 px-1.5 py-0.5 text-[11px] font-medium", getSubjectColorClass(s), getSubjectLeftBorderClass(s))}>{s}</li>
                ))}
              </ul>
            </FilterRailSection>
          )}
        </FilterRail>
        <div className="min-w-0 flex-1">
          <div className="hidden md:block">
            <WeekGrid
              showWeekSelector={false}
              isAbStrategy={isAbStrategy}
          isAaBbStrategy={isAaBbStrategy}
          hasWeekLabels={hasWeekLabels}
          weekOptions={weekOptions}
          weekCycle={weekCycle}
          weekFilter={weekFilter}
          onWeekFilterChange={setWeekFilter}
          masterBlocks={displayBlocks}
          specialistBlocks={filteredBySpecialist}
          teacherBlocks={filteredByTeacher}
          trayBlocks={trayBlocks}
          timeSlots={timeSlots}
          recessBands={recessBands}
          schoolStart={schoolStartTime}
          schoolEnd={schoolEndTime}
          conflictIds={conflictIds}
          trayIds={trayIds}
          highlightIds={recentChangedIds}
          lockedIds={lockedIds}
          ghostIds={ghostOverlay.ghostIds}
          originIds={ghostOverlay.originIds}
          deletedIds={ghostOverlay.deletedIds}
          onBlockClick={(b) => { setEditBlock(b); setEditOpen(true); }}
          onBlockDrop={handleBlockDrop}
          onToggleLock={toggleLock}
          onNotesChange={handleNotesChange}
          onAddBlock={(day, time) => setAddSlot({ day, time })}
          specialists={specialists}
          teachers={teachers}
          filterSpecialist={filterSpecialist}
          onFilterSpecialist={setFilterSpecialist}
          filterTeacher={filterTeacher}
          onFilterTeacher={setFilterTeacher}
          blockingError={blockingError}
            />
          </div>
          <MobileDayPager
            blocks={displayBlocks}
            recessBands={recessBands}
            day={filterDay}
            onDayChange={setFilterDay}
            specialists={specialists}
            teachers={teachers}
            filterSpecialist={filterSpecialist}
            onFilterSpecialist={setFilterSpecialist}
            filterTeacher={filterTeacher}
            onFilterTeacher={setFilterTeacher}
          />
        </div>
      </div>

      <BlockInspector
        block={editBlock ? (blocks.find((b) => b.id === editBlock.id) ?? editBlock) : null}
        open={editOpen}
        onOpenChange={setEditOpen}
        specialists={specialists}
        locked={editBlock ? lockedIds.has(editBlock.id) : false}
        conflicted={editBlock ? conflictIds.has(editBlock.id) : false}
        resolvingConflicts={resolvingAI}
        generationId={selectedGen || null}
        explanationPending={explainPending}
        onSave={handleSaveOverride}
        onToggleLock={toggleLock}
        onNotesChange={handleNotesChange}
        onResolveConflicts={handleResolveWithAI}
        onConflictFixed={handleConflictFixApplied}
        onRequestExplain={handleRequestExplain}
      />

      {addSlot && (
        <AddBlockDialog
          open={!!addSlot}
          onOpenChange={(open) => { if (!open) setAddSlot(null); }}
          day={addSlot.day}
          time={addSlot.time}
          specialists={specialists}
          teachers={teachers}
          onAdd={handleAddBlock}
        />
      )}

      <Suspense fallback={null}>
        {specExportOpen && (
          <SpecialistExportModal
            open={specExportOpen}
            onOpenChange={setSpecExportOpen}
            specialists={specialists}
            blocks={blocks}
            schoolId={selectedSchoolId}
            schoolName={selectedSchool?.name}
            schoolYear={schoolYear}
            recessConfig={recessConfig}
            bandLabels={recessBandLabels}
            calendarEvents={calendarEvents}
          />
        )}
        {adminExportOpen && (
          <AdminExportModal
            open={adminExportOpen}
            onOpenChange={setAdminExportOpen}
            specialists={specialists}
            blocks={blocks}
            schoolId={selectedSchoolId}
            schoolName={selectedSchool?.name}
            schoolYear={schoolYear}
            teachers={teachers}
            clubs={clubs}
            recessConfig={recessConfig}
          />
        )}
        {chatOpen && (
          <ScheduleChatPanel
            key={selectedGen || "no-gen"}
            generationId={selectedGen || null}
            onClose={() => setChatOpen(false)}
            onScheduleChanged={() => selectedGen && loadBlocks(selectedGen)}
            onApplied={flagChangedBlocks}
            onPreviewOps={setChatPreviewOps}
          />
        )}
      </Suspense>

      <ScheduleCommandPalette open={cmdOpen} onOpenChange={setCmdOpen} actions={commandActions} />
      <KeyboardShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

    </div>
  );
}
