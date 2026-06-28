// WeightProposal — power 7 (learnable weights: proposes, never imposes).
//
// When the engine has observed enough manual edits to suggest a weight tweak, it
// stages a clamped proposal (scoring_weight_profiles.proposed_weights). This
// surfaces it in plain language with Apply / Dismiss. Applying calls the engine's
// CONFIRM path (update-scoring-weights, action: "confirm"); dismissing clears the
// stage. Default is always off until the admin confirms — nothing auto-applies.

import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Wand2, ArrowUpRight, ArrowDownRight, X as XIcon, Loader2, Check } from "lucide-react";
import { describeWeightProposal, weightProposalHeadline } from "@/lib/weightProposal";

interface WeightProposalProps {
  schoolId: string | null;
  /** Active learned weights (or null/default). */
  activeWeights: Record<string, number> | null | undefined;
  /** Staged proposal from scoring_weight_profiles.proposed_weights. */
  proposedWeights: Record<string, number> | null | undefined;
  /** Called after Apply/Dismiss so the orchestrator can refresh the profile. */
  onResolved: () => void;
}

export default function WeightProposal({ schoolId, activeWeights, proposedWeights, onResolved }: WeightProposalProps) {
  const deltas = useMemo(() => describeWeightProposal(activeWeights, proposedWeights), [activeWeights, proposedWeights]);
  const [busy, setBusy] = useState<"apply" | "dismiss" | null>(null);

  if (!schoolId || deltas.length === 0) return null;

  async function apply() {
    if (!schoolId) return;
    setBusy("apply");
    try {
      const { data, error } = await supabase.functions.invoke("update-scoring-weights", {
        body: { school_id: schoolId, action: "confirm" },
      });
      if (error || (data as any)?.error) throw new Error((data as any)?.error ?? error?.message ?? "Failed");
      toast({ title: "Preferences updated", description: "Future schedules will use your tweaks. You can change this anytime in Setup." });
      onResolved();
    } catch (e: any) {
      toast({ title: "Couldn't apply", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function dismiss() {
    if (!schoolId) return;
    setBusy("dismiss");
    try {
      // Clear the staged proposal so it stops surfacing. Cast: the proposed_*
      // columns post-date the locally-generated Supabase types (regenerated via
      // Lovable on deploy); the codebase already treats these rows loosely.
      await supabase.from("scoring_weight_profiles").update({ proposed_weights: null, proposed_at: null } as any).eq("school_id", schoolId);
    } catch {
      // Non-fatal — hide locally regardless.
    } finally {
      setBusy(null);
      onResolved();
    }
  }

  return (
    <div className="rounded-xl border border-purple/30 bg-purple/5 px-4 py-3 no-print">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-purple/15 text-purple">
          <Wand2 className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{weightProposalHeadline(deltas)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Based on the edits you've been making. This only affects <em>future</em> schedules, and only if you apply it.
          </p>
          <ul className="mt-2 space-y-1">
            {deltas.slice(0, 4).map((d) => (
              <li key={d.key} className="flex items-center gap-1.5 text-xs text-foreground">
                {d.direction === "more"
                  ? <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                  : <ArrowDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                <span>{d.reason}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" className="h-8 gap-1.5" onClick={apply} disabled={busy != null}>
            {busy === "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
            Apply
          </Button>
          <Button variant="ghost" size="sm" className="h-8" onClick={dismiss} disabled={busy != null} aria-label="Dismiss proposal">
            {busy === "dismiss" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <XIcon className="h-3.5 w-3.5" aria-hidden />}
          </Button>
        </div>
      </div>
    </div>
  );
}
