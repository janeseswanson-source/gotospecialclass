// ConflictResolver — power 5 (deterministic blast-radius cascade; LLM narrates).
//
// Shows the outcome of resolve-conflicts-ai: the ranked legal fixes the engine
// APPLIED (each with its measured blast radius — "Moved the class · affects 1"),
// and any structured ESCALATIONS where no legal fix exists ("can't fix without
// breaking X"). The engine resolved everything; this only narrates it. The UI
// never invents a placement.

import { CheckCircle2, ArrowRightLeft, Plus, MoveRight, AlertTriangle, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tacticLabel, blastLabel, resolutionHeadline, type AppliedChange, type ConflictEscalation } from "@/lib/conflictOptions";

export interface ConflictOutcome {
  resolved: number;
  escalated: number;
  applied_changes: AppliedChange[];
  escalations: ConflictEscalation[];
  summary?: string;
}

interface ConflictResolverProps {
  outcome: ConflictOutcome;
  onDismiss: () => void;
}

const TACTIC_ICON: Record<string, typeof MoveRight> = {
  relocate: MoveRight,
  swap: ArrowRightLeft,
  add_session: Plus,
};

export default function ConflictResolver({ outcome, onDismiss }: ConflictResolverProps) {
  const { resolved, escalated, applied_changes, escalations, summary } = outcome;
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden no-print" role="region" aria-label="Conflict resolution">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
          <span className="text-sm font-semibold text-foreground truncate">{resolutionHeadline(resolved, escalated)}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onDismiss} aria-label="Dismiss">
          <XIcon className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      <div className="divide-y divide-border">
        {applied_changes.length > 0 && (
          <div className="px-4 py-2.5">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-success">Fixed automatically</p>
            <ul className="space-y-1.5">
              {applied_changes.map((c, i) => {
                const Icon = TACTIC_ICON[c.tactic] ?? MoveRight;
                return (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0">
                      <span className="font-medium text-foreground">{tacticLabel(c.tactic)}</span>
                      <span className="ml-1.5 rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">{blastLabel(c.blast_radius)}</span>
                      <span className="ml-1 text-muted-foreground">— {c.description}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {escalations.length > 0 && (
          <div className="px-4 py-2.5">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">Needs your decision</p>
            <ul className="space-y-2">
              {escalations.map((e, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-foreground">{e.reason}</p>
                    {e.conflicting_constraints.length > 0 && (
                      <p className="mt-0.5 text-muted-foreground">
                        Conflicts with: {e.conflicting_constraints.join("; ")}. Try freeing capacity (add a specialist or working day), or edit manually.
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary && applied_changes.length === 0 && escalations.length === 0 && (
          <div className="px-4 py-2.5 text-xs text-muted-foreground">{summary}</div>
        )}
      </div>
    </div>
  );
}
