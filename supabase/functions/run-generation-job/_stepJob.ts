// Pure state machine for the CP-SAT-first generation pipeline. NO I/O — every
// external effect (invoking generate-cpsat / generate-schedule / refine-schedule,
// deleting a losing generation, reading the clock, DB claim/load/save) is an
// injected dep, so the whole flow is unit-testable without Supabase or the solver.
//
// Pipeline (one BOUNDED step per invocation; run-generation-job self-chains):
//   phase cpsat          → generate-cpsat (60s, or 120s for > 30 teachers)
//        ├─ ok           → phase refine, best_generation_id set
//        ├─ unavailable  → phase fallback_search, fallback_used=true (503/unreachable ONLY)
//        └─ hard error   → status failed (model_invalid / infeasible — the solver ran)
//   phase fallback_search→ generate-schedule best-of-3 (one attempt/step), keep best
//   phase refine         → refine-schedule passes until improved=false twice OR
//                          confidence==='structurally_limited' OR target reached
//   → status complete. Losing generations are deleted server-side.
//
// A 10-minute wall guard finalizes honestly; a cancelled job is a no-op between
// steps; the optimistic `attempts` guard (in run-generation-job) makes each step
// idempotent so a double-fired continuation can never double-run a step.

export type JobStatus = "queued" | "running" | "polishing" | "complete" | "failed" | "cancelled";
export type JobPhase = "cpsat" | "fallback_search" | "refine" | "done";

export const WALL_MS = 10 * 60 * 1000;
export const MAX_SEARCH_ATTEMPTS = 3;
export const REFINE_NOIMPROVE_LIMIT = 2;
export const TARGET_QUALITY = 99;
/** Below this quality % the pipeline does NOT settle: refine convergence grants
 *  a bounded number of rescue rounds (fresh seeds) instead of completing. A
 *  structurally-limited verdict still stops immediately — no seed fixes a
 *  capacity wall. */
export const QUALITY_FLOOR = 85;
export const MAX_RESCUE_ROUNDS = 4;

/** Client-facing progress (same shape as GenProgress in src/lib/generateBestSchedule). */
export interface JobProgress {
  phase: "cpsat" | "search" | "refine";
  attempt: number;
  attempts: number;
  currentQuality: number;
  bestQuality: number;
  // internal bookkeeping (also persisted, harmless to the client)
  searchAttempt: number;
  refinePass: number;
  noImproveStreak: number;
  /** Quality-floor rescue rounds consumed (see QUALITY_FLOOR). */
  rescueRound: number;
  elapsedMs: number;
}

export interface JobRow {
  id: string;
  school_id: string;
  status: JobStatus;
  phase: JobPhase | null;
  progress: Partial<JobProgress> | null;
  best_generation_id: string | null;
  fallback_used: boolean;
  fallback_reason: string | null;
  error: string | null;
  attempts: number;
  started_at: string | null;
}

export type CpsatOutcome =
  | { ok: true; generationId: string; quality: number; solverStatus: string }
  | { ok: false; unavailable: boolean; code: string; error: string };
export type SearchOutcome =
  | { ok: true; generationId: string; quality: number }
  | { ok: false; error: string };
export type RefineOutcome =
  | { ok: true; improved: boolean; generationId: string | null; quality: number | null; structurallyLimited: boolean }
  | { ok: false; error: string };

export interface StepDeps {
  now: () => number;
  timeLimitS: number;
  runCpsat: (schoolId: string, timeLimitS: number) => Promise<CpsatOutcome>;
  runSearch: (schoolId: string) => Promise<SearchOutcome>;
  runRefine: (generationId: string, seedSalt: number) => Promise<RefineOutcome>;
  deleteGeneration: (id: string) => Promise<void>;
}

export interface StepResult {
  update: Record<string, unknown>;
  done: boolean;   // terminal — stop chaining
  chain: boolean;  // re-invoke run-generation-job for the next step
}

/** Larger schools get the longer solver budget (still full coverage either way). */
export function pickTimeLimitS(teacherCount: number): number {
  return teacherCount > 30 ? 120 : 60;
}

/** Distinguishes an infrastructure failure (unconfigured / unreachable / a
 *  gateway-level solver error, or a transport failure) from a model verdict the
 *  solver actually computed (model_invalid / infeasible / no_solution). Both now
 *  fall back to the metaheuristic (see stepJob) — this only shapes the reason we
 *  record: infra failures read plainly, verdicts note that CP-SAT rejected. */
export function isSolverUnavailable(httpStatus: number | null, code: string | null): boolean {
  if (httpStatus === 503 || httpStatus === 502 || httpStatus === 0 || httpStatus === null) return true;
  return code === "cpsat_unconfigured" || code === "cpsat_unreachable" || code === "cpsat_solver_error";
}

function normalizeProgress(p: Partial<JobProgress> | null | undefined): JobProgress {
  return {
    phase: p?.phase ?? "cpsat",
    attempt: p?.attempt ?? 0,
    attempts: p?.attempts ?? 1,
    currentQuality: p?.currentQuality ?? 0,
    bestQuality: p?.bestQuality ?? 0,
    searchAttempt: p?.searchAttempt ?? 0,
    refinePass: p?.refinePass ?? 0,
    noImproveStreak: p?.noImproveStreak ?? 0,
    rescueRound: p?.rescueRound ?? 0,
    elapsedMs: p?.elapsedMs ?? 0,
  };
}

/** Advance a claimed (non-terminal) job by exactly ONE bounded step. Pure. */
export async function stepJob(job: JobRow, deps: StepDeps): Promise<StepResult> {
  const now = deps.now();
  const nowIso = new Date(now).toISOString();

  // Cancelled / already terminal → idempotent no-op (also covers a double-fire).
  if (job.status === "cancelled" || job.status === "complete" || job.status === "failed") {
    return { update: {}, done: true, chain: false };
  }

  const prog = normalizeProgress(job.progress);
  const started = job.started_at ? Date.parse(job.started_at) : now;
  const elapsed = Math.max(0, now - started);
  const finish = (status: "complete" | "failed", bestGen: string | null, progress: JobProgress, error?: string): StepResult => ({
    update: { status, phase: "done", best_generation_id: bestGen, progress, error: error ?? null, finished_at: nowIso },
    done: true, chain: false,
  });

  // 10-minute wall guard: keep the best schedule if we have one, else fail honestly.
  if (elapsed > WALL_MS) {
    return job.best_generation_id
      ? finish("complete", job.best_generation_id, { ...prog, elapsedMs: elapsed })
      : finish("failed", null, { ...prog, elapsedMs: elapsed }, "Timed out after 10 minutes without a schedule");
  }

  const phase: JobPhase = job.phase ?? "cpsat";

  // ── Step 1: CP-SAT (primary) ──
  if (phase === "cpsat") {
    const r = await deps.runCpsat(job.school_id, deps.timeLimitS);
    if (r.ok) {
      const p: JobProgress = { ...prog, phase: "cpsat", attempt: 1, attempts: 1, currentQuality: r.quality, bestQuality: r.quality, elapsedMs: elapsed };
      return { update: { status: "polishing", phase: "refine", best_generation_id: r.generationId, progress: p }, done: false, chain: true };
    }
    // CP-SAT is an OPTIMIZATION layer, never a single point of failure. Whatever
    // went wrong — unreachable/misconfigured solver OR a model verdict
    // (invalid/infeasible/no_solution) — we fall back to the JS metaheuristic. It
    // builds its OWN representation (so it survives any generate-cpsat spec-mapping
    // bug) and always returns a best-effort schedule, surfacing unplaceable classes
    // as warnings rather than hard-failing generation. `unavailable` only shapes
    // the reason we record.
    const reason = r.unavailable ? r.error : `CP-SAT rejected the model (${r.code}): ${r.error}`;
    const p: JobProgress = { ...prog, phase: "search", attempt: 0, attempts: MAX_SEARCH_ATTEMPTS, searchAttempt: 0, elapsedMs: elapsed };
    return { update: { status: "running", phase: "fallback_search", fallback_used: true, fallback_reason: reason, progress: p }, done: false, chain: true };
  }

  // ── Fallback: metaheuristic best-of-3 (one attempt per step) ──
  if (phase === "fallback_search") {
    const r = await deps.runSearch(job.school_id);
    let bestGen = job.best_generation_id;
    let bestQ = prog.bestQuality;
    if (r.ok) {
      if (bestGen === null || r.quality > bestQ) {
        const loser = bestGen;
        bestGen = r.generationId; bestQ = r.quality;
        if (loser) await deps.deleteGeneration(loser);
      } else {
        await deps.deleteGeneration(r.generationId);
      }
    }
    const searchAttempt = prog.searchAttempt + 1;
    const p: JobProgress = {
      ...prog, phase: "search", attempt: searchAttempt, attempts: MAX_SEARCH_ATTEMPTS,
      currentQuality: r.ok ? r.quality : prog.currentQuality, bestQuality: bestQ, searchAttempt, elapsedMs: elapsed,
    };
    if (searchAttempt < MAX_SEARCH_ATTEMPTS && bestQ < TARGET_QUALITY) {
      return { update: { status: "running", phase: "fallback_search", best_generation_id: bestGen, progress: p }, done: false, chain: true };
    }
    if (bestGen === null) return finish("failed", null, p, "Fallback search produced no schedule");
    return { update: { status: "polishing", phase: "refine", best_generation_id: bestGen, progress: { ...p, phase: "refine", attempt: 0 } }, done: false, chain: true };
  }

  // ── Refine: deterministic directed-repair + LNS polish until it stops helping ──
  if (phase === "refine") {
    if (job.best_generation_id === null) return finish("failed", null, prog, "Refine had no base schedule");
    const r = await deps.runRefine(job.best_generation_id, prog.refinePass);
    let bestGen = job.best_generation_id;
    let bestQ = prog.bestQuality;
    let noImprove = prog.noImproveStreak;
    let structurallyLimited = false;
    if (r.ok) {
      structurallyLimited = r.structurallyLimited;
      if (r.improved && r.generationId) {
        const loser = bestGen;
        bestGen = r.generationId;
        if (typeof r.quality === "number") bestQ = r.quality;
        if (loser && loser !== bestGen) await deps.deleteGeneration(loser);
        noImprove = 0;
      } else {
        noImprove += 1;
      }
    } else {
      noImprove += 1;
    }
    const refinePass = prog.refinePass + 1;
    const p: JobProgress = {
      ...prog, phase: "refine", attempt: refinePass, attempts: refinePass + Math.max(1, REFINE_NOIMPROVE_LIMIT - noImprove),
      currentQuality: bestQ, bestQuality: bestQ, refinePass, noImproveStreak: noImprove, elapsedMs: elapsed,
    };
    // Structural limits and the target end the loop unconditionally.
    if (structurallyLimited || bestQ >= TARGET_QUALITY) {
      return finish("complete", bestGen, p);
    }
    if (noImprove >= REFINE_NOIMPROVE_LIMIT) {
      // Quality floor: below 85% we don't settle — burn a rescue round (reset
      // the no-improve streak; refinePass keeps advancing, so every subsequent
      // pass runs with a fresh seed). Bounded by MAX_RESCUE_ROUNDS + the wall.
      if (bestQ < QUALITY_FLOOR && prog.rescueRound < MAX_RESCUE_ROUNDS) {
        const rescued: JobProgress = { ...p, noImproveStreak: 0, rescueRound: prog.rescueRound + 1 };
        return { update: { status: "polishing", phase: "refine", best_generation_id: bestGen, progress: rescued }, done: false, chain: true };
      }
      return finish("complete", bestGen, p);
    }
    return { update: { status: "polishing", phase: "refine", best_generation_id: bestGen, progress: p }, done: false, chain: true };
  }

  // Unknown phase → finalize on whatever we have.
  return job.best_generation_id
    ? finish("complete", job.best_generation_id, prog)
    : finish("failed", null, prog, `Unknown phase '${phase}'`);
}

// ── Invocation orchestration (also pure via injected DB deps) ───────────────
export interface InvocationDeps extends StepDeps {
  /** Atomic queued→running claim (UPDATE ... WHERE status='queued' RETURNING). Null
   *  when the job wasn't queued (another worker already claimed it — the idempotent
   *  double-claim guard). */
  claimIfQueued: (id: string) => Promise<JobRow | null>;
  load: (id: string) => Promise<JobRow | null>;
  /** Optimistic write: applies `update` only if the row's attempts still equals
   *  `expectedAttempts` (sets attempts = expectedAttempts + 1). False when a
   *  concurrent step already advanced it — this worker then bails (idempotent). */
  save: (id: string, expectedAttempts: number, update: Record<string, unknown>) => Promise<boolean>;
  reinvoke: (id: string) => void;
}

export interface InvocationResult {
  claimed: boolean;
  stepped: boolean;
  done: boolean;
  status: JobStatus | null;
}

/** One run-generation-job invocation: (maybe) claim, honor cancel/terminal, run one
 *  step, persist optimistically, self-chain. Pure given injected deps. */
export async function runInvocation(deps: InvocationDeps, jobId: string): Promise<InvocationResult> {
  let job = await deps.load(jobId);
  if (!job) return { claimed: false, stepped: false, done: true, status: null };

  if (job.status === "queued") {
    const claimed = await deps.claimIfQueued(jobId);
    if (!claimed) return { claimed: false, stepped: false, done: false, status: "queued" }; // lost the race
    job = claimed;
  }

  if (job.status === "cancelled" || job.status === "complete" || job.status === "failed") {
    return { claimed: true, stepped: false, done: true, status: job.status };
  }

  const res = await stepJob(job, deps);
  const persisted = await deps.save(jobId, job.attempts, res.update);
  if (!persisted) return { claimed: true, stepped: false, done: false, status: job.status }; // concurrent step won

  if (res.chain && !res.done) deps.reinvoke(jobId);
  const nextStatus = (res.update.status as JobStatus | undefined) ?? job.status;
  return { claimed: true, stepped: true, done: res.done, status: nextStatus };
}
