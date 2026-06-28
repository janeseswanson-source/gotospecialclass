// Phase 3C unit tests: Monte Carlo runner determinism + budget gate.
import { assertEquals, assert, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mulberry32, type Rng } from "./_random.ts";
import {
  monteCarloRun,
  calibrateMonteCarlo,
  MonteCarloBudgetExceededError,
} from "./_monteCarlo.ts";

// Strategy fn: pull 3 numbers from rng to define a "schedule".
type FakeResult = { picks: number[] };
const fakeStrategy = (rng: Rng): FakeResult => ({
  picks: [rng(), rng(), rng()],
});
const fakeScore = (r: FakeResult): number => r.picks.reduce((a, b) => a + b, 0);

Deno.test("monteCarloRun: deterministic — same seed → identical best", () => {
  const a = monteCarloRun(fakeStrategy, fakeScore, { iterations: 25, seed: 42 });
  const b = monteCarloRun(fakeStrategy, fakeScore, { iterations: 25, seed: 42 });
  assertEquals(a.best.picks, b.best.picks);
  assertEquals(a.bestScore, b.bestScore);
  assertEquals(a.attempts, 25);
  assertEquals(a.allScores.length, 25);
});

Deno.test("monteCarloRun: best score is the max of allScores", () => {
  const r = monteCarloRun(fakeStrategy, fakeScore, { iterations: 30, seed: 7 });
  const expectedMax = Math.max(...r.allScores);
  assertEquals(r.bestScore, expectedMax);
});

Deno.test("monteCarloRun: scoring errors → -Infinity, do not crash", () => {
  let n = 0;
  const flakyScore = (_r: FakeResult): number => {
    n++;
    if (n % 3 === 0) throw new Error("boom");
    return 1;
  };
  const r = monteCarloRun(fakeStrategy, flakyScore, { iterations: 9, seed: 1 });
  assertEquals(r.attempts, 9);
  // Three iterations threw → three -Infinity scores.
  assertEquals(r.allScores.filter((s) => s === -Infinity).length, 3);
  // Best is still a finite winner.
  assert(Number.isFinite(r.bestScore));
});

Deno.test("monteCarloRun: rejects iterations < 1", () => {
  assertThrows(() => monteCarloRun(fakeStrategy, fakeScore, { iterations: 0, seed: 1 }));
});

Deno.test("calibrateMonteCarlo: fast strategy → 80 iterations (current fast tier)", () => {
  // The CPU-aware tiers were lowered for the ~2s edge ceiling: a fast (≤150ms)
  // calibration run maps to the 80-iteration tier.
  const cal = calibrateMonteCarlo(fakeStrategy, 123, "fake");
  assertEquals(cal.iterations, 80);
  assert(cal.calibrationMs >= 0);
});

Deno.test("calibrateMonteCarlo: throws budget-exceeded when projected > budget", () => {
  // Inject a tiny budget so the gate trips deterministically off a fast
  // calibration run instead of needing a multi-second spin: a ≤150ms run picks
  // 80 iterations, so any positive calibration time × 80 exceeds a 0ms budget.
  const slow = (_rng: Rng): FakeResult => {
    const until = performance.now() + 5;
    while (performance.now() < until) { /* tiny spin so calibrationMs > 0 */ }
    return { picks: [1] };
  };
  let thrown: unknown = null;
  try {
    calibrateMonteCarlo(slow, 1, "slow", /* budgetMs */ 0);
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof MonteCarloBudgetExceededError, "expected budget-exceeded error");
});
