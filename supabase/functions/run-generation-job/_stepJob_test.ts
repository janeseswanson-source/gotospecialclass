// Unit tests for the pure generation-pipeline state machine (no I/O, injected deps).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  stepJob, runInvocation, pickTimeLimitS, isSolverUnavailable, WALL_MS,
  type JobRow, type StepDeps, type InvocationDeps, type CpsatOutcome, type SearchOutcome, type RefineOutcome,
} from "./_stepJob.ts";

const NOW = 1_000_000;

function baseJob(over: Partial<JobRow> = {}): JobRow {
  return {
    id: "job1", school_id: "school1", status: "running", phase: "cpsat", progress: {},
    best_generation_id: null, fallback_used: false, fallback_reason: null, error: null,
    attempts: 0, started_at: new Date(NOW).toISOString(), ...over,
  };
}

function deps(over: Partial<StepDeps> = {}): StepDeps {
  return {
    now: () => NOW,
    timeLimitS: 60,
    runCpsat: async (): Promise<CpsatOutcome> => ({ ok: true, generationId: "cpsat-gen", quality: 92, solverStatus: "OPTIMAL" }),
    runSearch: async (): Promise<SearchOutcome> => ({ ok: true, generationId: "search-gen", quality: 80 }),
    runRefine: async (): Promise<RefineOutcome> => ({ ok: true, improved: false, generationId: null, quality: null, structurallyLimited: false }),
    deleteGeneration: async () => {},
    ...over,
  };
}

/** Apply a StepResult's update onto a job to sequence multiple steps in a test. */
function apply(job: JobRow, update: Record<string, unknown>): JobRow {
  return { ...job, ...(update as Partial<JobRow>), attempts: job.attempts + 1 };
}

// ─── helpers ───────────────────────────────────────────────────────────────
Deno.test("pickTimeLimitS: 60 default, 120 for > 30 teachers", () => {
  assertEquals(pickTimeLimitS(10), 60);
  assertEquals(pickTimeLimitS(30), 60);
  assertEquals(pickTimeLimitS(31), 120);
  assertEquals(pickTimeLimitS(42), 120);
});

Deno.test("isSolverUnavailable: 503/unreachable/transport → fallback; solver verdict → not", () => {
  assert(isSolverUnavailable(503, "cpsat_unconfigured"));
  assert(isSolverUnavailable(503, "cpsat_unreachable"));
  assert(isSolverUnavailable(502, "cpsat_solver_error"));
  assert(isSolverUnavailable(0, "transport"));
  assert(isSolverUnavailable(null, null));
  assert(!isSolverUnavailable(422, "cpsat_model_invalid"));
  assert(!isSolverUnavailable(422, "cpsat_infeasible"));
  assert(!isSolverUnavailable(200, null));
});

// ─── happy path: cpsat → refine → complete ──────────────────────────────────
Deno.test("happy path: CP-SAT ok → refine until no-improve twice → complete", async () => {
  let cpsatCalls = 0, refineCalls = 0;
  const d = deps({
    runCpsat: async () => { cpsatCalls++; return { ok: true, generationId: "cpsat-gen", quality: 92, solverStatus: "OPTIMAL" }; },
    runRefine: async () => { refineCalls++; return { ok: true, improved: false, generationId: null, quality: null, structurallyLimited: false }; },
  });
  let job = baseJob();

  // Step 1: CP-SAT
  let r = await stepJob(job, d);
  assertEquals(cpsatCalls, 1);
  assertEquals((r.update as any).status, "polishing");
  assertEquals((r.update as any).phase, "refine");
  assertEquals((r.update as any).best_generation_id, "cpsat-gen");
  assertEquals((r.update as any).progress.bestQuality, 92);
  assert(r.chain && !r.done);
  job = apply(job, r.update);

  // Step 2: refine pass 1 (no improvement → streak 1, keep going)
  r = await stepJob(job, d);
  assert(!r.done, "one no-improve pass shouldn't finish");
  job = apply(job, r.update);

  // Step 3: refine pass 2 (no improvement → streak 2 → complete)
  r = await stepJob(job, d);
  assertEquals(refineCalls, 2);
  assertEquals((r.update as any).status, "complete");
  assertEquals((r.update as any).best_generation_id, "cpsat-gen");
  assert(r.done && !r.chain);
  assert((r.update as any).finished_at);
});

Deno.test("refine stops immediately when structurally_limited", async () => {
  const d = deps({ runRefine: async () => ({ ok: true, improved: false, generationId: null, quality: null, structurallyLimited: true }) });
  const job = baseJob({ phase: "refine", best_generation_id: "g1", progress: { bestQuality: 71 } });
  const r = await stepJob(job, d);
  assertEquals((r.update as any).status, "complete");
  assert(r.done);
});

Deno.test("refine adopts a strictly-better version and deletes the loser", async () => {
  const deleted: string[] = [];
  const d = deps({
    runRefine: async () => ({ ok: true, improved: true, generationId: "g2", quality: 96, structurallyLimited: false }),
    deleteGeneration: async (id) => { deleted.push(id); },
  });
  const job = baseJob({ phase: "refine", best_generation_id: "g1", progress: { bestQuality: 90 } });
  const r = await stepJob(job, d);
  assertEquals((r.update as any).best_generation_id, "g2");
  assertEquals((r.update as any).progress.bestQuality, 96);
  assertEquals(deleted, ["g1"]);
});

// ─── fallback path: cpsat unavailable → best-of-3 search → refine ───────────
Deno.test("fallback: CP-SAT unavailable (503) → best-of-3 search → refine, fallback_used", async () => {
  let searchCalls = 0;
  const deleted: string[] = [];
  const d = deps({
    runCpsat: async () => ({ ok: false, unavailable: true, code: "cpsat_unreachable", error: "solver unreachable" }),
    // ≥ QUALITY_FLOOR so refine convergence completes without rescue rounds
    // (the floor has its own tests below).
    runSearch: async () => { searchCalls++; return { ok: true, generationId: `s${searchCalls}`, quality: 90 + searchCalls }; },
    deleteGeneration: async (id) => { deleted.push(id); },
  });
  let job = baseJob();

  // Step 1: CP-SAT unavailable → fallback_search
  let r = await stepJob(job, d);
  assertEquals((r.update as any).status, "running");
  assertEquals((r.update as any).phase, "fallback_search");
  assertEquals((r.update as any).fallback_used, true);
  assertEquals((r.update as any).fallback_reason, "solver unreachable");
  assert(r.chain && !r.done);
  job = apply(job, r.update);

  // Steps 2-4: three search attempts, keep best (s3=93), delete losers
  for (let i = 0; i < 3; i++) {
    r = await stepJob(job, d);
    job = apply(job, r.update);
  }
  assertEquals(searchCalls, 3);
  // after the 3rd attempt it moves to refine
  assertEquals(job.phase, "refine");
  assertEquals(job.best_generation_id, "s3");
  assertEquals(job.fallback_used, true);
  // s1 and s2 were superseded and deleted (best kept)
  assert(deleted.includes("s1") && deleted.includes("s2"), `losers deleted: ${deleted}`);

  // refine → complete (no improvement twice)
  r = await stepJob(job, d); job = apply(job, r.update);
  r = await stepJob(job, d);
  assertEquals((r.update as any).status, "complete");
  assertEquals((r.update as any).best_generation_id, "s3");
});

// ─── quality floor: below 85% the pipeline doesn't settle ────────────────────
Deno.test("quality floor: refine converging below 85% burns rescue rounds instead of completing", async () => {
  let refineCalls = 0;
  const d = deps({
    runRefine: async () => { refineCalls++; return { ok: true, improved: false, generationId: null, quality: null, structurallyLimited: false }; },
  });
  // Start in refine with a mediocre 70% best.
  let job = baseJob({ phase: "refine", best_generation_id: "gen-70", progress: { phase: "refine", bestQuality: 70 } });
  // Each rescue grants REFINE_NOIMPROVE_LIMIT (2) more passes; MAX_RESCUE_ROUNDS
  // = 4 → total refine calls = 2 + 4×2 = 10 before it finally completes.
  let r;
  for (let i = 0; i < 10; i++) {
    r = await stepJob(job, d);
    if ((r.update as any).status === "complete") break;
    job = apply(job, r.update);
  }
  assertEquals(refineCalls, 10, "2 base passes + 4 rescues × 2 passes");
  assertEquals((r!.update as any).status, "complete");
  assertEquals((r!.update as any).best_generation_id, "gen-70");
  assertEquals(((r!.update as any).progress as any).rescueRound, 4);
});

Deno.test("quality floor: an improvement mid-rescue that crosses the floor completes at convergence", async () => {
  let refineCalls = 0;
  const d = deps({
    runRefine: async () => {
      refineCalls++;
      // 3rd pass (first rescue round) finds a big improvement to 90%.
      if (refineCalls === 3) return { ok: true, improved: true, generationId: "gen-90", quality: 90, structurallyLimited: false };
      return { ok: true, improved: false, generationId: null, quality: null, structurallyLimited: false };
    },
  });
  let job = baseJob({ phase: "refine", best_generation_id: "gen-70", progress: { phase: "refine", bestQuality: 70 } });
  let r;
  for (let i = 0; i < 12; i++) {
    r = await stepJob(job, d);
    if ((r.update as any).status === "complete") break;
    job = apply(job, r.update);
  }
  // passes 1,2 no-improve → rescue 1; pass 3 improves to 90 (streak resets);
  // passes 4,5 no-improve → 90 ≥ floor → complete without further rescues.
  assertEquals(refineCalls, 5);
  assertEquals((r!.update as any).status, "complete");
  assertEquals((r!.update as any).best_generation_id, "gen-90");
});

Deno.test("quality floor: structurally_limited stops immediately even below the floor", async () => {
  const d = deps({
    runRefine: async () => ({ ok: true, improved: false, generationId: null, quality: null, structurallyLimited: true }),
  });
  const job = baseJob({ phase: "refine", best_generation_id: "gen-40", progress: { phase: "refine", bestQuality: 40 } });
  const r = await stepJob(job, d);
  assertEquals((r.update as any).status, "complete");
  assertEquals(((r.update as any).progress as any).rescueRound, 0, "no rescue against a capacity wall");
});

Deno.test("CP-SAT model verdict (model_invalid) also falls back to the JS solver", async () => {
  // CP-SAT is an optimization layer, never a single point of failure: even a
  // model verdict (invalid/infeasible) falls back to the proven JS solver rather
  // than hard-failing generation. The reason records that CP-SAT rejected.
  const d = deps({ runCpsat: async () => ({ ok: false, unavailable: false, code: "cpsat_model_invalid", error: "bad spec" }) });
  const r = await stepJob(baseJob(), d);
  assertEquals((r.update as any).status, "running");
  assertEquals((r.update as any).phase, "fallback_search");
  assertEquals((r.update as any).fallback_used, true);
  assert(String((r.update as any).fallback_reason).includes("bad spec"));
  assert(String((r.update as any).fallback_reason).includes("cpsat_model_invalid"));
  assert(r.chain && !r.done);
});

Deno.test("fallback that never produces a schedule → failed", async () => {
  const d = deps({ runSearch: async () => ({ ok: false, error: "gen failed" }) });
  let job = baseJob({ phase: "fallback_search", fallback_used: true, progress: { phase: "search", searchAttempt: 2, bestQuality: 0 } });
  const r = await stepJob(job, d); // 3rd (final) attempt, still no schedule
  assertEquals((r.update as any).status, "failed");
});

// ─── cancel + wall guard ─────────────────────────────────────────────────────
Deno.test("cancel: a cancelled job is a no-op", async () => {
  const r = await stepJob(baseJob({ status: "cancelled" }), deps());
  assertEquals(r.update, {});
  assert(r.done && !r.chain);
});

Deno.test("wall guard: > 10 min with a best → complete; without → failed", async () => {
  const withBest = baseJob({ phase: "refine", best_generation_id: "g1", started_at: new Date(NOW - WALL_MS - 1000).toISOString() });
  const r1 = await stepJob(withBest, deps());
  assertEquals((r1.update as any).status, "complete");

  const noBest = baseJob({ started_at: new Date(NOW - WALL_MS - 1000).toISOString() });
  const r2 = await stepJob(noBest, deps());
  assertEquals((r2.update as any).status, "failed");
  assert(String((r2.update as any).error).includes("Timed out"));
});

// ─── runInvocation: idempotent claim + optimistic step guard ─────────────────
function invDeps(store: { job: JobRow | null }, over: Partial<InvocationDeps> = {}): InvocationDeps {
  return {
    ...deps(),
    load: async () => store.job,
    claimIfQueued: async () => {
      if (store.job && store.job.status === "queued") {
        store.job = { ...store.job, status: "running", phase: "cpsat", started_at: new Date(NOW).toISOString() };
        return store.job;
      }
      return null;
    },
    save: async (_id, expected, update) => {
      if (!store.job || store.job.attempts !== expected) return false;
      store.job = { ...store.job, ...(update as Partial<JobRow>), attempts: expected + 1 };
      return true;
    },
    reinvoke: () => {},
    ...over,
  };
}

Deno.test("runInvocation: claims a queued job and runs the first step", async () => {
  const store = { job: baseJob({ status: "queued", attempts: 0 }) };
  const r = await runInvocation(invDeps(store), "job1");
  assert(r.claimed && r.stepped);
  assertEquals(store.job!.status, "polishing"); // CP-SAT ok → refine phase
  assertEquals(store.job!.best_generation_id, "cpsat-gen");
});

Deno.test("runInvocation: idempotent double-claim — the loser no-ops", async () => {
  // Two workers race the atomic claim; only the first gets the row.
  let claims = 0;
  const store = { job: baseJob({ status: "queued", attempts: 0 }) };
  const d = invDeps(store, {
    claimIfQueued: async () => {
      claims++;
      if (claims === 1) { store.job = { ...store.job!, status: "running", phase: "cpsat" }; return store.job; }
      return null; // second claimer lost the race
    },
  });
  const winner = await runInvocation(d, "job1");
  // reset store to still-queued view for the loser's load (it raced before the claim landed)
  const loserStore = { job: baseJob({ status: "queued", attempts: 0 }) };
  const loser = await runInvocation(invDeps(loserStore, { claimIfQueued: async () => null }), "job1");
  assert(winner.claimed && winner.stepped);
  assert(!loser.claimed && !loser.stepped, "the second claimer must no-op");
});

Deno.test("runInvocation: optimistic step guard — a stale continuation no-ops", async () => {
  // Job already advanced (attempts moved) between load and save → save fails → bail.
  const store = { job: baseJob({ status: "running", phase: "cpsat", attempts: 5 }) };
  const d = invDeps(store, { save: async () => false });
  const r = await runInvocation(d, "job1");
  assert(r.claimed && !r.stepped, "a lost optimistic write must not double-run the step");
});

Deno.test("runInvocation: a cancelled job is a no-op (not stepped)", async () => {
  const store = { job: baseJob({ status: "cancelled" }) };
  const r = await runInvocation(invDeps(store), "job1");
  assert(r.claimed && !r.stepped && r.done);
});
