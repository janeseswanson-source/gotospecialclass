// ConflictFixPicker — power 5 (pick-one-of-N).
//
// For a conflicted block, asks the engine (resolve-conflicts-ai, mode:"preview")
// for the RANKED legal fixes — each with its measured blast radius — and lets the
// admin apply one in a single click (mode:"apply"). Every option came from the
// deterministic engine and passed the SSOT; the UI never invents a placement. If
// nothing is legal, the structured escalation reason is shown.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { MoveRight, ArrowRightLeft, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { tacticLabel, blastLabel } from "@/lib/conflictOptions";

interface FixChange { op: "move"; block_id: string; day_of_week: string; start_time: string; end_time: string }
interface FixOption { id: number; tactic: string; blast_radius: number; description: string; changes: FixChange[] }
interface PreviewResponse {
  options?: FixOption[];
  escalation?: { reason: string; conflicting_constraints: string[] };
  message?: string;
}

interface ConflictFixPickerProps {
  generationId: string;
  blockId: string;
  /** Called with the changed block ids after a fix is applied. */
  onApplied: (changedIds: string[]) => void;
}

const TACTIC_ICON: Record<string, typeof MoveRight> = { relocate: MoveRight, swap: ArrowRightLeft };

export default function ConflictFixPicker({ generationId, blockId, onApplied }: ConflictFixPickerProps) {
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<FixOption[]>([]);
  const [escalation, setEscalation] = useState<{ reason: string; conflicting_constraints: string[] } | null>(null);
  const [applyingId, setApplyingId] = useState<number | null>(null);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setEscalation(null);
    try {
      const { data, error } = await supabase.functions.invoke("resolve-conflicts-ai", {
        body: { generation_id: generationId, mode: "preview", block_id: blockId },
      });
      if (error) throw error;
      const d = data as PreviewResponse;
      setOptions(Array.isArray(d.options) ? d.options : []);
      setEscalation(d.escalation ?? null);
    } catch {
      setOptions([]);
      setEscalation({ reason: "Couldn't load fix options. Try again.", conflicting_constraints: [] });
    } finally {
      setLoading(false);
    }
  }, [generationId, blockId]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  async function apply(opt: FixOption) {
    setApplyingId(opt.id);
    try {
      const { data, error } = await supabase.functions.invoke("resolve-conflicts-ai", {
        body: { generation_id: generationId, mode: "apply", changes: opt.changes },
      });
      if (error) throw error;
      const d = data as { applied?: number; rejected?: boolean; message?: string };
      if (d.rejected || !d.applied) {
        toast({ title: "Couldn't apply that fix", description: d.message ?? "Pick another option.", variant: "destructive" });
        await loadPreview();
        return;
      }
      toast({ title: "Conflict fixed", description: `${tacticLabel(opt.tactic)} — ${blastLabel(opt.blast_radius)}.` });
      onApplied(opt.changes.map((c) => c.block_id));
    } catch (e) {
      toast({ title: "Couldn't apply that fix", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setApplyingId(null);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Finding the smallest legal fixes…
      </p>
    );
  }

  if (options.length === 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
          <div>
            <p className="text-foreground">{escalation?.reason ?? "No legal one-step fix found."}</p>
            {escalation?.conflicting_constraints?.length ? (
              <p className="mt-0.5 text-muted-foreground">Conflicts with: {escalation.conflicting_constraints.join("; ")}. Free up capacity or edit manually.</p>
            ) : null}
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={loadPreview}>
          <RefreshCw className="h-3 w-3" aria-hidden /> Re-check
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5" role="list" aria-label="Conflict fix options">
      <p className="text-[11px] text-muted-foreground">Pick a fix — ranked by how little it changes:</p>
      {options.map((o) => {
        const Icon = TACTIC_ICON[o.tactic] ?? MoveRight;
        const recommended = o.id === 0;
        return (
          <div key={o.id} role="listitem" className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">
                {tacticLabel(o.tactic)}
                <span className="ml-1.5 rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">{blastLabel(o.blast_radius)}</span>
                {recommended && <span className="ml-1.5 text-[10px] font-semibold text-success">recommended</span>}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">{o.description}</p>
            </div>
            <Button size="sm" variant={recommended ? "default" : "outline"} className="h-7 shrink-0 text-xs" disabled={applyingId != null} onClick={() => apply(o)}>
              {applyingId === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : "Apply"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
