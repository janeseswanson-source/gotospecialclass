// ScheduleToolbar — extracted from MasterSchedulePage so the page is a thinner
// orchestrator. Pure presentation + callbacks: undo/redo, the version tab bar,
// version compare, row density, Edit-with-AI / Explain toggles, and the export
// menu. No data fetching or legality decisions live here.

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Undo2, Redo2, Lock, GitCompare, MessageSquare, Download, FileText,
  ChevronDown, LayoutGrid, FileSpreadsheet, Printer, Loader2, Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ToolbarGeneration {
  id: string;
  version: number;
  verify_quality_score?: number | null;
  verify_issues_found?: number | null;
}

interface ScheduleToolbarProps {
  schoolName?: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  lockedCount: number;
  generations: ToolbarGeneration[];
  selectedGen: string;
  onSelectGen: (id: string) => void;
  diffGenId: string | null;
  onCompare: (id: string) => void;
  onCloseDiff: () => void;
  density: "compact" | "fine";
  onDensityChange: (d: "compact" | "fine") => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  blockingError: { blocked: boolean; reason: string };
  exportingXlsx: boolean;
  onSpecExport: () => void;
  onAdminExport: () => void;
  onExportXlsx: () => void;
  onPrint: () => void;
}

export default function ScheduleToolbar(props: ScheduleToolbarProps) {
  const {
    schoolName, canUndo, canRedo, onUndo, onRedo, lockedCount, generations, selectedGen,
    onSelectGen, diffGenId, onCompare, onCloseDiff, density, onDensityChange, chatOpen,
    onToggleChat, blockingError, exportingXlsx,
    onSpecExport, onAdminExport, onExportXlsx, onPrint,
  } = props;

  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Master Schedule</h1>
        <p className="text-sm text-muted-foreground">
          {schoolName ?? "View, filter, and edit your generated schedule."}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap no-print">
        {/* Undo / Redo */}
        <div className="flex items-center rounded-lg border border-border bg-background p-0.5 gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!canUndo} onClick={onUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!canRedo} onClick={onRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {lockedCount > 0 && (
          <Badge variant="secondary" className="gap-1 h-7">
            <Lock className="h-3 w-3" /> {lockedCount} locked
          </Badge>
        )}

        {/* Version tab bar — only the most recent versions get chips; the long
            tail lives in an "Older" dropdown so 60 generations don't become 60
            chips. The selected version always stays visible as a chip. */}
        {generations.length > 1 && (() => {
          const MAX_CHIPS = 6;
          const recent = generations.slice(0, MAX_CHIPS);
          let older = generations.slice(MAX_CHIPS);
          // Keep the active version visible even when it's an old one.
          const activeInOlder = older.find((g) => g.id === selectedGen);
          let chips = recent;
          if (activeInOlder) {
            chips = [...recent.slice(0, MAX_CHIPS - 1), activeInOlder];
            older = generations.slice(MAX_CHIPS - 1).filter((g) => g.id !== selectedGen);
          }
          return (
            <div className="flex items-center rounded-lg border border-border bg-background p-0.5 gap-0.5" role="tablist" aria-label="Schedule versions">
              {chips.map((g) => {
                const isActive = selectedGen === g.id;
                const verified = g.verify_quality_score != null && g.verify_quality_score >= 80;
                const reviewed = !verified && g.verify_quality_score != null && g.verify_issues_found != null && g.verify_issues_found > 0;
                return (
                  <button
                    key={g.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => onSelectGen(g.id)}
                    className={cn(
                      "rounded-md px-3 py-1 text-xs font-medium transition-all flex items-center gap-1.5",
                      isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                    )}
                  >
                    v{g.version}
                    {verified && (
                      <span className={cn("text-[9px] font-bold px-1 py-px rounded leading-none", isActive ? "bg-white/25 text-white" : "bg-green-500/15 text-green-700 dark:text-green-400")}>✓ AI</span>
                    )}
                    {reviewed && (
                      <span className={cn("text-[9px] font-bold px-1 py-px rounded leading-none", isActive ? "bg-white/25 text-white" : "bg-amber-500/15 text-amber-700 dark:text-amber-400")}>{g.verify_issues_found} fixed</span>
                    )}
                  </button>
                );
              })}
              {older.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 flex items-center gap-0.5" aria-label={`${older.length} older versions`}>
                      Older <ChevronDown className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                    {older.map((g) => (
                      <DropdownMenuItem key={g.id} onClick={() => onSelectGen(g.id)}>
                        v{g.version}
                        {g.verify_quality_score != null && g.verify_quality_score >= 80 && <span className="ml-1.5 text-[10px] text-green-600 dark:text-green-400">✓ AI</span>}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })()}

        {/* Tools — power features tucked behind one menu (progressive disclosure):
            version compare + row density live here so a first-time coordinator's
            toolbar is just Undo/Redo · versions · Edit with AI · Export. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" title="Comparison and view tools">
              <Wrench className="h-3.5 w-3.5" />
              Tools
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {generations.length > 1 && (
              <>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <GitCompare className="h-4 w-4 mr-2" /> Compare with…
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                    {generations.filter((g) => g.id !== selectedGen).map((g) => (
                      <DropdownMenuItem key={g.id} onClick={() => onCompare(g.id)}>
                        vs v{g.version}{diffGenId === g.id ? " ✓" : ""}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                {diffGenId && (
                  <DropdownMenuItem onClick={onCloseDiff}>
                    <GitCompare className="h-4 w-4 mr-2" /> Close comparison
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => onDensityChange(density === "compact" ? "fine" : "compact")}>
              <LayoutGrid className="h-4 w-4 mr-2" />
              Row density: {density === "compact" ? "Compact → Fine" : "Fine → Compact"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Edit with AI */}
        <Button variant={chatOpen ? "secondary" : "default"} size="sm" className="h-8 gap-1.5" onClick={onToggleChat} title="Open AI editor">
          <MessageSquare className="h-3.5 w-3.5" />
          Edit with AI
        </Button>

        {/* Export dropdown — disabled while error-severity conflicts exist so a
            broken schedule can't be exported or printed. */}
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
            <DropdownMenuItem disabled={blockingError.blocked} onClick={() => !blockingError.blocked && onSpecExport()}>
              <FileText className="h-4 w-4 mr-2" /> Specialist Planner (PDF)
            </DropdownMenuItem>
            <DropdownMenuItem disabled={blockingError.blocked} onClick={() => !blockingError.blocked && onAdminExport()}>
              <LayoutGrid className="h-4 w-4 mr-2" /> Admin Overview (PDF)
            </DropdownMenuItem>
            <DropdownMenuItem disabled={blockingError.blocked || exportingXlsx} onClick={() => !blockingError.blocked && onExportXlsx()}>
              {exportingXlsx ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />} Branded Spreadsheet (Excel)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={blockingError.blocked} onClick={() => !blockingError.blocked && onPrint()}>
              <Printer className="h-4 w-4 mr-2" /> Print Current View
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
