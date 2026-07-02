// Schedule generation, orchestrated SERVER-SIDE (CP-SAT-first pipeline).
//
// The browser used to run best-of-N + refine itself — dozens of edge calls it had
// to stay on the page for. Now it just ENQUEUES a job (enqueue-generation) and
// subscribes to the generation_jobs row over Realtime; run-generation-job advances
// the job one bounded step at a time and self-chains server-side. So the user can
// close the page mid-generation, and the pipeline (CP-SAT → deterministic refine,
// with a metaheuristic fallback only if the solver service is unreachable) runs to
// completion regardless.
import { supabase } from "@/integrations/supabase/client";
import { mapJobProgress, type GenProgress, type JobRowLite } from "@/lib/genJobProgress";

export { mapJobProgress, type GenProgress };

export interface BestScheduleResult {
  generationId: string;
  quality: number;
  attemptsRun: number;
  reachedTarget: boolean;
  usedCPSAT: boolean;         // true unless the metaheuristic fallback produced it
  fallbackUsed: boolean;      // the CP-SAT solver was unreachable → fallback engine
  fallbackReason?: string;
  jobId: string;
}

export interface BestScheduleOptions {
  schoolId: string;
  onProgress?: (p: GenProgress) => void;
  signal?: AbortSignal;       // cancel: flips the job to 'cancelled'
  /** Client-side hard cap in case Realtime AND polling both die (default 12 min). */
  maxWaitMs?: number;
  // Legacy fields are accepted but ignored — the server owns these now.
  targetQuality?: number;
  maxAttempts?: number;
  timeBudgetMs?: number;
  polishRounds?: number;
  refinePasses?: number;
  refineStaleLimit?: number;
}

const TERMINAL = new Set(["complete", "failed", "cancelled"]);

export async function generateBestSchedule(opts: BestScheduleOptions): Promise<BestScheduleResult> {
  const { schoolId, onProgress, signal, maxWaitMs = 12 * 60 * 1000 } = opts;

  const { data, error } = await supabase.functions.invoke("enqueue-generation", { body: { school_id: schoolId } });
  const jobId = (data as any)?.job_id as string | undefined;
  if (error || !jobId) throw new Error((data as any)?.error ?? error?.message ?? "Could not start schedule generation.");

  return await new Promise<BestScheduleResult>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => { if (settled) return; settled = true; cleanup(); fn(); };

    const handle = (job: JobRowLite | null | undefined) => {
      if (!job || settled) return;
      onProgress?.(mapJobProgress(job));
      if (!TERMINAL.has(job.status)) return;
      if (job.status === "complete" && job.best_generation_id) {
        const quality = mapJobProgress(job).bestQuality;
        done(() => resolve({
          generationId: job.best_generation_id!, quality,
          attemptsRun: mapJobProgress(job).attempt, reachedTarget: quality >= 99,
          usedCPSAT: !job.fallback_used, fallbackUsed: !!job.fallback_used,
          fallbackReason: job.fallback_reason ?? undefined, jobId,
        }));
      } else if (job.status === "cancelled") {
        done(() => reject(new DOMException("Generation cancelled", "AbortError")));
      } else {
        done(() => reject(new Error(job.error ?? "Generation failed")));
      }
    };

    const channel = supabase
      .channel(`genjob:${jobId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "generation_jobs", filter: `id=eq.${jobId}` },
        (payload) => handle(payload.new as JobRowLite))
      .subscribe();

    // Poll as a safety net (Realtime can drop; also catches a terminal state that
    // landed before the subscription attached).
    const poll = setInterval(async () => {
      const { data } = await supabase.from("generation_jobs").select("*").eq("id", jobId).maybeSingle();
      handle(data as JobRowLite | null);
    }, 2500);

    supabase.from("generation_jobs").select("*").eq("id", jobId).maybeSingle().then(({ data }) => handle(data as JobRowLite | null));

    const onAbort = () => {
      supabase.from("generation_jobs").update({ status: "cancelled", error: "cancelled by user", updated_at: new Date().toISOString() }).eq("id", jobId).then(() => {});
    };
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort); }

    const timeout = setTimeout(() => done(() => reject(new Error("Generation timed out — check the Master Schedule; it may still finish."))), maxWaitMs);

    function cleanup() {
      clearInterval(poll);
      clearTimeout(timeout);
      supabase.removeChannel(channel);
      signal?.removeEventListener("abort", onAbort);
    }
  });
}
