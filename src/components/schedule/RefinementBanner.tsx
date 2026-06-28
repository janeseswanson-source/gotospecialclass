// RefinementBanner — power 6 (background refinement).
//
// After a schedule is generated, the heavy SA+LNS refinement runs out of band via
// the refine-schedule edge function. This shows a subtle, NON-BLOCKING "Improving
// this schedule…" state, and when the engine writes a strictly-better version it
// surfaces a gentle, dismissible "An improved version is ready (+X) — review"
// prompt. It NEVER auto-swaps what the admin is viewing — review is one tap, and
// dismiss leaves the current version in place.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, X as XIcon, TrendingUp } from "lucide-react";

interface RefinementBannerProps {
  generationId: string | null;
  /** Gate: only run for a fresh version not yet refined (orchestrator decides). */
  enabled: boolean;
  onReviewRefined: (newGenerationId: string) => void;
}

type Status = "idle" | "refining" | "ready" | "none" | "error";

interface RefinedInfo {
  newGenId: string;
  quality: number | null;
  previous: number | null;
  moved: number | null;
}

export default function RefinementBanner({ generationId, enabled, onReviewRefined }: RefinementBannerProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [info, setInfo] = useState<RefinedInfo | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Track which generation we've already kicked a refine for, so it runs once.
  const refinedFor = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !generationId) return;
    if (refinedFor.current.has(generationId)) return;
    refinedFor.current.add(generationId);
    let cancelled = false;

    setStatus("refining");
    setInfo(null);
    supabase.functions
      .invoke("refine-schedule", { body: { generation_id: generationId } })
      .then(({ data, error }) => {
        if (cancelled) return;
        const d = data as {
          improved?: boolean; generation_id?: string; error?: string;
          quality_percent?: number; previous_quality_percent?: number; moved_from_baseline?: number;
        } | null;
        if (error || d?.error) { setStatus("error"); return; }
        if (d?.improved && d?.generation_id) {
          setInfo({
            newGenId: d.generation_id,
            quality: typeof d.quality_percent === "number" ? d.quality_percent : null,
            previous: typeof d.previous_quality_percent === "number" ? d.previous_quality_percent : null,
            moved: typeof d.moved_from_baseline === "number" ? d.moved_from_baseline : null,
          });
          setStatus("ready");
        } else {
          setStatus("none");
        }
      })
      .catch(() => { if (!cancelled) setStatus("error"); });

    return () => { cancelled = true; };
  }, [enabled, generationId]);

  if (status === "refining") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground no-print"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Improving this schedule in the background…
      </div>
    );
  }

  if (status === "ready" && info && !dismissed.has(info.newGenId)) {
    const delta = info.quality != null && info.previous != null ? info.quality - info.previous : null;
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 no-print"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            An improved version is ready
            {delta != null && delta > 0 && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 text-success">
                <TrendingUp className="h-3.5 w-3.5" aria-hidden /> +{delta}% quality
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Background refinement found a better layout
            {info.moved != null && info.moved > 0 ? ` (about ${info.moved} blocks changed)` : ""}. Review it before switching — your current version stays put.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" className="h-8 gap-1.5" onClick={() => onReviewRefined(info.newGenId)}>
            Review
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Dismiss improved version"
            onClick={() => setDismissed((prev) => new Set(prev).add(info.newGenId))}
          >
            <XIcon className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
