// WeekGrid — the hero week view, extracted from MasterSchedulePage so the page
// is a thinner orchestrator. Holds the optional A/B week selector, the
// Master / By Specialist / By Teacher tabs, the conflict Scrabble tray, and the
// per-view print buttons. Pure presentation + callbacks; the page still owns data
// and all legality decisions (this never places or validates a block).

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import ScheduleGrid, { type BlockData, type RecessBand } from "./ScheduleGrid";
import WeekCyclePicker from "./WeekCyclePicker";
import type { WeekCycle } from "@/lib/weekCycle";

function PrintViewButton({ label, disabled, disabledReason }: { label: string; disabled?: boolean; disabledReason?: string }) {
  return (
    <Button variant="outline" size="sm" className="h-8 no-print" onClick={() => !disabled && window.print()} disabled={disabled} title={disabled ? disabledReason : undefined}>
      <Printer className="h-3.5 w-3.5 mr-1.5" /> {label}
    </Button>
  );
}

interface WeekGridProps {
  // Week selector
  showWeekSelector: boolean;
  isAbStrategy: boolean;
  isAaBbStrategy: boolean;
  hasWeekLabels: boolean;
  weekOptions: { value: string; label: string }[];
  /** The dated cycle for the WeekCyclePicker (real Mon–Fri ranges, holiday-aware). */
  weekCycle?: WeekCycle;
  weekFilter: string;
  onWeekFilterChange: (v: string) => void;

  // Per-view blocks (already filtered by the page)
  masterBlocks: BlockData[];
  specialistBlocks: BlockData[];
  teacherBlocks: BlockData[];

  // Conflict tray (rendered inside the master grid's DndContext)
  trayBlocks: BlockData[];

  // Grid rendering
  timeSlots: string[];
  recessBands: RecessBand[];
  schoolStart?: string | null;
  schoolEnd?: string | null;
  conflictIds: Set<string>;
  trayIds: Set<string>;
  highlightIds: Set<string>;
  lockedIds: Set<string>;
  /** Ghost preview of proposed (unapplied) AI edits. */
  ghostIds?: Set<string>;
  originIds?: Set<string>;
  deletedIds?: Set<string>;
  onBlockClick: (block: BlockData) => void;
  onBlockDrop: (blockId: string, newDay: string, newTime: string) => void;
  onToggleLock: (blockId: string) => void;
  onNotesChange: (blockId: string, notes: string) => Promise<boolean>;

  // Filters
  specialists: { id: string; name: string; subject: string }[];
  teachers: { id: string; name: string; grade: string }[];
  filterSpecialist: string;
  onFilterSpecialist: (v: string) => void;
  filterTeacher: string;
  onFilterTeacher: (v: string) => void;

  blockingError: { blocked: boolean; reason: string };
}

export default function WeekGrid(props: WeekGridProps) {
  const {
    showWeekSelector, isAbStrategy, isAaBbStrategy, hasWeekLabels, weekOptions, weekCycle, weekFilter, onWeekFilterChange,
    masterBlocks, specialistBlocks, teacherBlocks, trayBlocks,
    timeSlots, recessBands, schoolStart, schoolEnd, conflictIds, trayIds, highlightIds, lockedIds,
    ghostIds, originIds, deletedIds,
    onBlockClick, onBlockDrop, onToggleLock, onNotesChange,
    specialists, teachers, filterSpecialist, onFilterSpecialist, filterTeacher, onFilterTeacher, blockingError,
  } = props;

  const gridCommon = {
    timeSlots, recessBands, schoolStart, schoolEnd, conflictIds, highlightIds, lockedIds,
    ghostIds, originIds, deletedIds,
    onBlockClick, onBlockDrop, onToggleLock, onNotesChange,
    notesEditable: true as const,
    // The tabs bar below is sticky at top-0 (h-10 = 40px); pin the grid's day
    // header just under it so it doesn't slide behind the tabs when scrolling.
    stickyTopOffset: 40,
  };

  return (
    <div className="flex-1 min-w-0 space-y-4">
      {showWeekSelector && (
        <div className="space-y-1.5 no-print">
          {weekCycle && (isAbStrategy || isAaBbStrategy) ? (
            // Dated selector — real Mon–Fri ranges, today highlighted, holiday-aware.
            <WeekCyclePicker cycle={weekCycle} value={weekFilter} onChange={onWeekFilterChange} />
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Week:</span>
              <Tabs value={weekFilter} onValueChange={onWeekFilterChange} className="w-auto">
                <TabsList className="h-8">
                  {weekOptions.map((opt) => (
                    <TabsTrigger key={opt.value} value={opt.value} className="text-xs px-3 h-7">{opt.label}</TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          )}
          {!hasWeekLabels && (isAbStrategy || isAaBbStrategy) && (
            <span className="text-xs text-muted-foreground italic">
              (no per-week labels on these blocks — generator may have fallen back to a single-week layout)
            </span>
          )}
        </div>
      )}

      <Tabs defaultValue="master">
        {/* Full-width sticky bar (an inline-flex TabsList alone lets grid content
            scroll past its right edge). The grid's day header pins just below
            this bar via stickyTopOffset. */}
        <div className="no-print sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <TabsList>
            <TabsTrigger value="master">Master Grid</TabsTrigger>
            <TabsTrigger value="specialist">By Specialist</TabsTrigger>
            <TabsTrigger value="teacher">By Teacher</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="master">
          <ScheduleGrid blocks={masterBlocks} trayBlocks={trayBlocks} liftedIds={trayIds} {...gridCommon} />
        </TabsContent>

        <TabsContent value="specialist">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 no-print">
              <Select value={filterSpecialist} onValueChange={onFilterSpecialist}>
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
              <ScheduleGrid blocks={specialistBlocks} {...gridCommon} />
            )}
          </div>
        </TabsContent>

        <TabsContent value="teacher">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 no-print">
              <Select value={filterTeacher} onValueChange={onFilterTeacher}>
                <SelectTrigger className="w-56"><SelectValue placeholder="All Teachers" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Teachers</SelectItem>
                  {teachers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} ({t.grade})</SelectItem>)}
                </SelectContent>
              </Select>
              <PrintViewButton label="Print Teacher View" disabled={blockingError.blocked} disabledReason={`Resolve ${blockingError.reason} before printing`} />
            </div>
            <ScheduleGrid blocks={teacherBlocks} {...gridCommon} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
