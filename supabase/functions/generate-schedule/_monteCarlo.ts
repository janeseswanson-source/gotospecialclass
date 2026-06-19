// Phase 3C: Monte Carlo runner.
//
// Wraps a single strategy run in `iterations` seeded retries, scores each
// candidate, and returns the highest-scoring result. The strategy fn must
// be a pure closure that takes an `Rng` and returns whatever shape
// `scoreFn` knows how to score — typically `StrategyResult`.
//
// Determinism contract: same `seed` + same strategy + same scoreFn ⇒
// identical `best` blocks, byte-for-byte. The optimizer never calls
// Math.random() or Date.now() in its hot path.

import { mulberry32, deriveSeed, type Rng } from "./_random.ts";

export interface MonteCarloRun<T> {
  best: T;
  bestScore: number;
  attempts: number;
  allScores: number[];
}

export interface MonteCarloOptions {
  iterations: number;
  seed: number;
  /** Identifier used purely for log prefixes ("[MonteCarlo standard] ..."). */
  label?: string;
}

/**
 * Run `strategyFn(rng)` `iterations` times with deterministic per-iter
 * seeds, score each result, return the best.
 *
 * Errors thrown inside `strategyFn` or `scoreFn` are caught and assigned
 * a score of -Infinity (the result loses) so a single bad run can't take
 * down the whole optimizer. The error is logged loudly.
 */
export function monteCarloRun<T>(
  strategyFn: (rng: Rng) => T,
  scoreFn: (result: T) => number,
  opts: MonteCarloOptions,
): MonteCarloRun<T> {
  const { iterations, seed, label = "monteCarlo" } = opts;
  if (iterations < 1) throw new Error("monteCarloRun: iterations must be ≥ 1");

  let best: T | null = null;
  let bestScore = -Infinity;
  const allScores: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const iterSeed = deriveSeed(seed, `iter:${i}`);
    const rng = mulberry32(iterSeed);
    let result: T;
    let score: number;
    try {
      result = strategyFn(rng);
    } catch (err) {
      console.error(`[MonteCarlo ${label}] iter ${i} strategy threw:`, err);
      allScores.push(-Infinity);
      continue;
    }
    try {
      score = scoreFn(result);
      if (!Number.isFinite(score)) {
        console.error(`[MonteCarlo ${label}] iter ${i} produced non-finite score:`, score);
        score = -Infinity;
      }
    } catch (err) {
      console.error(`[MonteCarlo ${label}] iter ${i} scoring threw:`, err);
      score = -Infinity;
    }
    allScores.push(score);
    if (score > bestScore) {
      bestScore = score;
      best = result;
    }
  }

  if (best === null) {
    // Every iteration failed — fall back to one direct run so the caller
    // still gets a shape-correct result rather than a crash.
    console.error(`[MonteCarlo ${label}] all ${iterations} iterations failed; returning seed-0 run as last resort`);
    best = strategyFn(mulberry32(seed));
    bestScore = -Infinity;
  }

  return { best, bestScore, attempts: iterations, allScores };
}

/**
 * Time a single calibration run of `strategyFn` and choose an iteration
 * count that stays under a total-time budget.
 *
 *   ≤200ms  → 50 iterations
 *   ≤500ms  → 25 iterations
 *   else    → 10 iterations
 *
 * Throws a tagged error if projected total > 30s so the caller can
 * surface a 422 instead of silently producing a worse schedule.
 */
export class MonteCarloBudgetExceededError extends Error {
  constructor(public calibrationMs: number, public projectedMs: number) {
    super(
      `Schedule too large to optimize — try reducing complexity. ` +
      `(calibration ${calibrationMs.toFixed(0)}ms × 10 iters = ${projectedMs.toFixed(0)}ms > 30000ms budget)`,
    );
    this.name = "MonteCarloBudgetExceededError";
  }
}

export interface CalibrationResult<T> {
  iterations: number;
  calibrationMs: number;
  calibrationResult: T;
}

export function calibrateMonteCarlo<T>(
  strategyFn: (rng: Rng) => T,
  seed: number,
  label = "monteCarlo",
): CalibrationResult<T> {
  const rng = mulberry32(deriveSeed(seed, "calibration"));
  const t0 = performance.now();
  const result = strategyFn(rng);
  const calibrationMs = performance.now() - t0;

  let iterations: number;
  if (calibrationMs <= 200) iterations = 200;
  else if (calibrationMs <= 500) iterations = 100;
  else iterations = 50;

  const projectedMs = calibrationMs * iterations;
  if (projectedMs > 30_000) {
    throw new MonteCarloBudgetExceededError(calibrationMs, projectedMs);
  }

  console.log(
    `[MonteCarlo ${label}] calibration ${calibrationMs.toFixed(1)}ms → ${iterations} iterations (projected ${projectedMs.toFixed(0)}ms)`,
  );

  return { iterations, calibrationMs, calibrationResult: result };
}
