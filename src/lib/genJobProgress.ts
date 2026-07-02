// Pure mapping from a generation_jobs row to the progress-bar shape the UI renders.
// Kept free of the supabase client so it is trivially unit-testable.

export interface GenProgress {
  phase: "cpsat" | "search" | "refine";
  attempt: number;
  attempts: number;
  currentQuality: number;
  bestQuality: number;
  elapsedMs: number;
  fallbackUsed: boolean;
}

export type JobRowLite = {
  status: "queued" | "running" | "polishing" | "complete" | "failed" | "cancelled";
  progress?: Record<string, unknown> | null;
  best_generation_id?: string | null;
  fallback_used?: boolean | null;
  fallback_reason?: string | null;
  error?: string | null;
};

/** Map a generation_jobs row's `progress` jsonb to GenProgress, coercing any
 *  missing/garbage values to safe defaults and unknown phases to "cpsat". */
export function mapJobProgress(job: JobRowLite): GenProgress {
  const p = (job.progress ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const rawPhase = p.phase;
  const phase: GenProgress["phase"] = rawPhase === "search" || rawPhase === "refine" ? rawPhase : "cpsat";
  return {
    phase,
    attempt: num(p.attempt),
    attempts: num(p.attempts, 1),
    currentQuality: num(p.currentQuality),
    bestQuality: num(p.bestQuality),
    elapsedMs: num(p.elapsedMs),
    fallbackUsed: !!job.fallback_used,
  };
}

/** Human progress label for the UI (same phrasing the pages used inline). */
export function progressLabel(p: GenProgress): string {
  const fb = p.fallbackUsed ? " (fallback engine)" : "";
  switch (p.phase) {
    case "cpsat": return `Solving for the provably-optimal schedule… ${p.bestQuality}%`;
    case "search": return `Trying schedules${fb}… best ${p.bestQuality}% (attempt ${p.attempt})`;
    case "refine": return `Improving the schedule${fb}… ${p.bestQuality}% (pass ${p.attempt})`;
  }
}
