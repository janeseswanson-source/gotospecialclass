// ApplyOpsBar v2 — the single review surface for AI-proposed edits (chat panel
// AND QualityPanel one-click fixes). Per-op rows with include/exclude checkboxes,
// the preview quality delta ("+3 quality, 0 new warnings"), and Apply/Discard.
// Nothing here validates or persists — apply-schedule-edits re-validates on Apply.

import { Button } from "@/components/ui/button";
import { Check, Loader2, MoveRight, ArrowLeftRight, Trash2, Plus, Wrench, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { ProposalItem } from "@/lib/ghostPreview";

export interface OpsDelta {
  quality_delta: number;
  new_errors?: number;
  warnings_after?: number;
  warnings_before?: number;
}

interface ApplyOpsBarProps {
  title?: string;
  items: ProposalItem[];
  rejectedIds: Set<string>;
  onToggle: (id: string) => void;
  /** Per-item failure reason after a partial apply (kept visible, annotated). */
  skippedById?: Record<string, string>;
  delta?: OpsDelta | null;
  applying: boolean;
  onApply: () => void;
  onDiscard: () => void;
}

export function opLabel(op: any): string {
  if (op?.label) return op.label;
  switch (op?.kind) {
    case "move": return `Move block → ${op.day_of_week} ${String(op.start_time).slice(0, 5)}`;
    case "swap": return "Swap two blocks";
    case "delete": return "Remove a block";
    case "insert": return `Add ${op.subject ?? "block"} → ${op.day_of_week} ${String(op.start_time).slice(0, 5)}`;
    default: return "Schedule change";
  }
}

export function OpIcon({ kind }: { kind?: string }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (kind === "move") return <MoveRight className={cls} />;
  if (kind === "swap") return <ArrowLeftRight className={cls} />;
  if (kind === "delete") return <Trash2 className={cls} />;
  if (kind === "insert") return <Plus className={cls} />;
  return <Wrench className={cls} />;
}

function DeltaChip({ delta }: { delta: OpsDelta }) {
  const d = delta.quality_delta;
  const Icon = d > 0 ? TrendingUp : d < 0 ? TrendingDown : Minus;
  const tone = d > 0 ? "text-success" : d < 0 ? "text-destructive" : "text-muted-foreground";
  const warn = delta.new_errors && delta.new_errors > 0
    ? `${delta.new_errors} new error${delta.new_errors === 1 ? "" : "s"}!`
    : typeof delta.warnings_after === "number" && typeof delta.warnings_before === "number"
      ? `${Math.max(0, delta.warnings_after - delta.warnings_before)} new warnings`
      : "0 new warnings";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {d > 0 ? `+${d}` : d} quality, {warn}
    </span>
  );
}

export default function ApplyOpsBar({
  title = "Review changes — not saved yet",
  items, rejectedIds, onToggle, skippedById = {}, delta, applying, onApply, onDiscard,
}: ApplyOpsBarProps) {
  if (items.length === 0) return null;
  const acceptedCount = items.filter((p) => !rejectedIds.has(p.id)).length;
  return (
    <div className="border-t border-amber-500/30 bg-amber-50/70 dark:bg-amber-950/20 px-3 py-2.5 space-y-2" role="region" aria-label="Proposed schedule changes">
      <div className="flex items-center gap-3">
        <div className="flex-1 text-xs">
          <p className="font-semibold text-foreground flex items-center gap-2 flex-wrap">
            {title}
            {delta && <DeltaChip delta={delta} />}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {acceptedCount} of {items.length} selected · dashed blocks on the grid show where things will land.
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onDiscard} disabled={applying}>
          Discard all
        </Button>
        <Button size="sm" className="h-7 gap-1 text-xs" onClick={onApply} disabled={applying || acceptedCount === 0}>
          {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {applying ? "Applying…" : `Apply ${acceptedCount || ""}`.trim()}
        </Button>
      </div>
      <ul className="max-h-40 overflow-y-auto space-y-1">
        {items.map((p) => {
          const rejected = rejectedIds.has(p.id);
          const skipReason = skippedById[p.id];
          return (
            <li key={p.id} className="rounded border border-border/60 bg-background/60 px-2 py-1.5">
              <label className="flex items-start gap-2 text-[11px] cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                  checked={!rejected}
                  onChange={() => onToggle(p.id)}
                  disabled={applying}
                />
                <span className="mt-0.5 text-amber-700 dark:text-amber-400"><OpIcon kind={(p.op as any)?.kind} /></span>
                <span className={`min-w-0 flex-1 ${rejected ? "line-through opacity-50" : "text-foreground"}`}>
                  {opLabel(p.op)}
                </span>
              </label>
              {skipReason && (
                <p className="mt-1 pl-6 text-[10px] font-medium text-destructive">Couldn't apply: {skipReason}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
