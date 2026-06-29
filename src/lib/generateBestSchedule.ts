// Best-of-N schedule generation, orchestrated from the browser.
//
// WHY CLIENT-SIDE: Supabase Edge Functions have a hard CPU-time limit (~2s of
// compute per request). The Monte Carlo solver is CPU-bound, so a single call
// can only fit ~2 attempts before the runtime kills it — that's the "CPU error"
// users hit when asking the server to grind for minutes. Instead we make many
// SHORT calls: each `generate-schedule` invocation creates a fresh generation
// with an independent random seed (seed = hash(generationId)), stays safely
// under the CPU limit, and returns its quality. We keep the best, delete the
// losers (schedule_blocks cascade-delete), and stop at the target quality or a
// wall-clock budget. Then Claude's polish pass (verify-schedule) repairs the
// best until it stops finding fixable issues.
//
// Net effect: "keep trying for a few minutes until 99%+, else keep the highest"
// — with no CPU errors, because no single request does heavy work.
import { supabase } from "@/integrations/supabase/client";
import { breakdownToPercent } from "@/lib/optimizerScore";

export interface GenProgress {
  phase: "search" | "refine" | "polish";
  attempt: number;        // search attempt / refine pass / polish round (1-based)
  attempts: number;       // total attempts allowed (for a progress bar)
  currentQuality: number; // quality of the candidate just produced/refined
  bestQuality: number;    // best quality found so far
  elapsedMs: number;
}

export interface BestScheduleResult {
  generationId: string;
  quality: number;
  attemptsRun: number;
  reachedTarget: boolean;
}

export interface BestScheduleOptions {
  schoolId: string;
  targetQuality?: number;   // stop once a candidate hits this (default 99)
  maxAttempts?: number;     // hard cap on search invocations (default 8)
  timeBudgetMs?: number;    // overall wall-clock budget (default 8 min)
  polishRounds?: number;    // max Claude polish passes on the winner (default 3)
  refinePasses?: number;    // max deterministic refine passes (default 80)
  refineStaleLimit?: number;// stop refining after this many no-improvement passes (default 12)
  onProgress?: (p: GenProgress) => void;
  signal?: AbortSignal;     // optional cancel
}

async function deleteGeneration(generationId: string) {
  // Blocks cascade via FK ON DELETE CASCADE.
  try { await supabase.from("schedule_generations").delete().eq("id", generationId); } catch { /* best-effort */ }
}

export async function generateBestSchedule(opts: BestScheduleOptions): Promise<BestScheduleResult> {
  const {
    schoolId,
    targetQuality = 99,
    maxAttempts = 8,
    timeBudgetMs = 8 * 60 * 1000,
    polishRounds = 3,
    refinePasses = 80,
    refineStaleLimit = 12,
    onProgress,
    signal,
  } = opts;

  const start = Date.now();
  let best: { generationId: string; quality: number } | null = null;
  let attempt = 0;
  let lastError: string | null = null;

  // ── Search phase: best-of-N independent generations ──
  while (attempt < maxAttempts && Date.now() - start < timeBudgetMs) {
    if (signal?.aborted) break;
    attempt++;
    const { data, error } = await supabase.functions.invoke("generate-schedule", {
      body: { school_id: schoolId },
    });
    if (error || (data as any)?.error) {
      lastError = (data as any)?.error ?? error?.message ?? "generation failed";
      // Budget/transient errors: keep trying other attempts rather than aborting.
      continue;
    }
    const genId = (data as any)?.generation_id as string | undefined;
    if (!genId) { lastError = "no generation_id returned"; continue; }
    const quality = breakdownToPercent((data as any)?.score_breakdown) ?? 0;

    if (!best || quality > best.quality) {
      const previousLoser = best?.generationId;
      best = { generationId: genId, quality };
      if (previousLoser) await deleteGeneration(previousLoser);
    } else {
      await deleteGeneration(genId); // worse than current best → discard
    }

    onProgress?.({
      phase: "search", attempt, attempts: maxAttempts,
      currentQuality: quality, bestQuality: best.quality, elapsedMs: Date.now() - start,
    });

    if (best.quality >= targetQuality) break;
  }

  if (!best) throw new Error(lastError ?? "Could not generate a schedule.");

  // ── Refinement phase: relentlessly refine the winner with the DETERMINISTIC
  // engine (directed repair + SA + LNS) until it reaches the target OR provably
  // stops improving (converged). Each call writes a strictly-better NEW version
  // and we chase the latest; many short calls accumulate unlimited total compute
  // without ever exceeding the edge CPU limit. This is "keep trying until it is
  // truly the best possible" — it never lowers quality and never double-books.
  let stale = 0;
  for (let pass = 0; pass < refinePasses && Date.now() - start < timeBudgetMs; pass++) {
    if (signal?.aborted) break;
    if (best.quality >= targetQuality) break;
    const { data, error } = await supabase.functions.invoke("refine-schedule", {
      // seed_salt = pass lets us retry a stuck version with a fresh search stream.
      body: { generation_id: best.generationId, seed_salt: pass },
    });
    const d = data as any;
    if (error || d?.error) {
      stale++;
      if (stale >= refineStaleLimit) break;
      continue;
    }
    if (d?.improved && d?.generation_id) {
      const old = best.generationId;
      best = { generationId: d.generation_id, quality: typeof d.quality_percent === "number" ? d.quality_percent : best.quality };
      if (old !== best.generationId) await deleteGeneration(old);
      stale = 0;
    } else {
      stale++;
    }
    onProgress?.({
      phase: "refine", attempt: pass + 1, attempts: refinePasses,
      currentQuality: best.quality, bestQuality: best.quality, elapsedMs: Date.now() - start,
    });
    // Stop when the engine says capacity caps quality (structurally limited) or
    // several passes in a row found nothing — i.e. we're at the achievable ceiling.
    if (stale >= refineStaleLimit || d?.confidence?.assessment === "structurally_limited") break;
  }

  const reachedTarget = best.quality >= targetQuality;

  // ── Polish phase: Claude repairs the winner until it stops applying fixes ──
  for (let round = 0; round < polishRounds; round++) {
    if (signal?.aborted) break;
    const { data, error } = await supabase.functions.invoke("verify-schedule", {
      body: { generation_id: best.generationId },
    });
    if (error || (data as any)?.error) break; // polish is best-effort; keep the schedule
    const applied = Number((data as any)?.issues_applied ?? 0);
    const q = Number((data as any)?.quality_score);
    if (Number.isFinite(q)) best.quality = q;
    onProgress?.({
      phase: "polish", attempt: round + 1, attempts: polishRounds,
      currentQuality: best.quality, bestQuality: best.quality, elapsedMs: Date.now() - start,
    });
    if (applied === 0) break; // nothing left to fix
  }

  return { generationId: best.generationId, quality: best.quality, attemptsRun: attempt, reachedTarget };
}
