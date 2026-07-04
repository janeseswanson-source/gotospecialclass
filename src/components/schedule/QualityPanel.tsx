// QualityPanel — powers 1 (confidence signal) + 2 (quality in human terms).
//
// The first thing an administrator sees: a calm headline that states, in plain
// language, how good this schedule is and whether it's worth refining further,
// plus a readable "what's working / what it cost" summary. The headline % still
// comes from the shared rubric (breakdownToPercent) — we lead with meaning.

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Sparkles, AlertTriangle, TrendingUp, Loader2, BrainCircuit, Wrench, ChevronDown } from "lucide-react";
import { scoreSummary, confidenceCopy, type ConfidenceTone, type QualityConfidence } from "@/lib/scoreSummary";

/** Penalty keys the engine can attempt a one-click fix for. "errors"/"warnings"
 *  route to the conflict cascade; the soft keys route to improve-quality. */
export const FIXABLE_KEYS = new Set([
  "errors", "warnings", "subject_day_clustering", "class_repeats", "spec_dayload_stdev",
  "subject_gap", "k_grade_after_780", "cart_back_to_back", "grade_cohesion", "teacher_planning", "contract_min",
]);

interface QualityPanelProps {
  breakdown: Record<string, number> | null | undefined;
  confidence: QualityConfidence | null | undefined;
  /** True while background refinement may still be computing the signal. */
  refining?: boolean;
  /** Optional AI verify-schedule review (folded in from the retired Explain sidebar). */
  verifyReview?: { score: number | null; summary: string | null };
  /** One-click engine fix for an issue row (edit-with-ai v2). Conflict-type keys
   *  run the deterministic cascade; soft keys run the scoped improve-quality
   *  pass, previewed through the ghost overlay + Apply bar. */
  onFixIssue?: (penaltyKey: string) => void;
  /** The penalty key currently being fixed (spinner state). */
  fixingKey?: string | null;
}

const TONE: Record<ConfidenceTone, { ring: string; text: string; chip: string; Icon: typeof Sparkles }> = {
  good: { ring: "border-success/40 bg-success/5", text: "text-success", chip: "bg-success/15 text-success", Icon: CheckCircle2 },
  info: { ring: "border-primary/40 bg-primary/5", text: "text-primary", chip: "bg-primary/15 text-primary", Icon: TrendingUp },
  warn: { ring: "border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20", text: "text-amber-700 dark:text-amber-400", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400", Icon: AlertTriangle },
};

export default function QualityPanel({ breakdown, confidence, refining, verifyReview, onFixIssue, fixingKey }: QualityPanelProps) {
  const summary = useMemo(() => scoreSummary(breakdown), [breakdown]);
  const copy = useMemo(() => confidenceCopy(confidence), [confidence]);
  const tone = copy.tone;
  const t = TONE[tone];
  const Icon = t.Icon;

  // Slim by default (a header strip); expandable to the full breakdown.
  const [expanded, setExpanded] = useState(false);

  const pct = summary.percent;
  const pctColor = pct == null ? "text-muted-foreground" : pct >= 95 ? "text-success" : pct >= 85 ? "text-amber-600 dark:text-amber-400" : "text-destructive";

  // The single most impactful cost row, surfaced in the strip with its Fix button.
  const topCost = summary.costs[0];
  const topFixable = !!onFixIssue && topCost && FIXABLE_KEYS.has(topCost.key);

  return (
    <section
      aria-label="Schedule quality"
      className={cn("rounded-2xl border no-print", t.ring)}
    >
      {/* ── Slim header strip ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", t.chip)}>
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className={cn("text-2xl font-bold tabular-nums leading-none", pctColor)}>
            {pct != null ? `${pct}%` : "—"}
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">quality</span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", t.chip)}>
            {copy.assessment === "unknown" && refining ? "Checking…" : copy.headline}
          </span>
          {refining && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
        </div>

        {/* Top issue + Fix — the one thing worth acting on, inline. */}
        {topCost && !expanded && (
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <span className="mt-px h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
            <span className="truncate">{topCost.label}</span>
            {topFixable && (
              <Button variant="outline" size="sm" className="h-6 shrink-0 gap-1 px-2 text-[11px]" disabled={!!fixingKey} onClick={() => onFixIssue!(topCost.key)}>
                {fixingKey === topCost.key ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Wrench className="h-3 w-3" aria-hidden />}
                Fix
              </Button>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-background/60 hover:text-foreground"
        >
          {expanded ? "Hide details" : "Details"}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform motion-reduce:transition-none", expanded && "rotate-180")} aria-hidden />
        </button>
      </div>

      {!expanded ? null : (
      <div className="border-t border-border/60 p-4 sm:p-5">
      {copy.detail && <p className="mb-4 text-sm text-muted-foreground">{copy.detail}</p>}

      {/* What's working / what it cost (power 2) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What's working</h3>
          {summary.working.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <ul className="space-y-1.5">
              {summary.working.slice(0, 5).map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What it cost</h3>
          {summary.costs.length === 0 ? (
            <p className="flex items-start gap-2 text-sm text-foreground">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
              <span>Nothing — this schedule has no soft-quality trade-offs.</span>
            </p>
          ) : (
            <ul className="space-y-1.5">
              {summary.costs.slice(0, 5).map((c) => {
                const fixable = !!onFixIssue && FIXABLE_KEYS.has(c.key);
                const fixing = fixingKey === c.key;
                return (
                  <li key={c.key} className="flex items-start gap-2 text-sm text-foreground">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                    <span className="min-w-0 flex-1">{c.label}</span>
                    {fixable && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 shrink-0 gap-1 px-2 text-[11px]"
                        disabled={!!fixingKey}
                        onClick={() => onFixIssue(c.key)}
                        aria-label={`Fix: ${c.label}`}
                      >
                        {fixing ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Wrench className="h-3 w-3" aria-hidden />}
                        Fix
                      </Button>
                    )}
                  </li>
                );
              })}
              {summary.costs.length > 5 && (
                <li className="text-xs italic text-muted-foreground">+ {summary.costs.length - 5} more</li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* AI verify-schedule review (folded in from the retired Explain sidebar) */}
      {verifyReview && (verifyReview.summary || verifyReview.score != null) && (
        <div className="mt-4 flex items-start gap-2 border-t border-border/60 pt-3">
          <BrainCircuit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">AI review:</span>{" "}
            {verifyReview.summary ?? "Reviewed."}
            {verifyReview.score != null && (
              <span className={cn("ml-1 font-semibold", verifyReview.score >= 80 ? "text-success" : verifyReview.score >= 60 ? "text-amber-600 dark:text-amber-400" : "text-destructive")}>
                ({verifyReview.score}/100)
              </span>
            )}
          </p>
        </div>
      )}
      </div>
      )}
    </section>
  );
}
