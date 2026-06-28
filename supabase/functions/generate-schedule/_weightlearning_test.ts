// Phase 4 — learnable-weights (inverse optimization) tests.
//
//   - an edit that REDUCES a penalty proposes a LARGER magnitude for that term
//   - an edit that ACCEPTS more of a penalty proposes a SMALLER magnitude
//   - a reward the admin increased gets a larger weight
//   - every proposed weight stays within ±50% of its default
//   - hard-constraint weights (errors/warnings) are never proposed
//   - repeated samples move toward the clamp, then stop (sane, bounded)
//   - nothing auto-applies (proposeWeightDeltas is pure; it only returns a proposal)

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { proposeWeightDeltas, clampToDefault, LEARNABLE_KEYS } from "./_weightlearning.ts";
import { DEFAULT_WEIGHTS } from "./_scoring.ts";

const W = { ...DEFAULT_WEIGHTS } as Record<string, number>;

Deno.test("learning: reducing a penalty proposes a larger magnitude (clamped)", () => {
  // subject_gap default −40. Original had penalty −120 (3 gaps); admin edited to
  // −40 (1 gap) ⇒ they value coverage ⇒ increase the penalty magnitude.
  const p = proposeWeightDeltas({ subject_gap: -120 }, { subject_gap: -40 }, W);
  const d = p.deltas.find((x) => x.key === "subject_gap")!;
  assert(d, "should propose a subject_gap change");
  assert(Math.abs(d.to) > Math.abs(d.from), `magnitude should grow: ${d.from} -> ${d.to}`);
  assertEquals(d.direction, "increase_magnitude");
  // ...but never beyond −60 (150% of −40).
  assert(d.to >= -60, `clamped to ±50%: ${d.to}`);
});

Deno.test("learning: accepting more of a penalty proposes a smaller magnitude", () => {
  const p = proposeWeightDeltas({ subject_day_clustering: -15 }, { subject_day_clustering: -60 }, W);
  const d = p.deltas.find((x) => x.key === "subject_day_clustering")!;
  assert(Math.abs(d.to) < Math.abs(d.from));
  assertEquals(d.direction, "decrease_magnitude");
  assert(d.to <= -7.5, `clamped to 50% of default: ${d.to}`); // |−15|*0.5 = 7.5
});

Deno.test("learning: a reward the admin increased gets a larger weight", () => {
  // full_week_coverage default +100. Edited covers more grades (+600 vs +500).
  const p = proposeWeightDeltas({ full_week_coverage: 500 }, { full_week_coverage: 600 }, W);
  const d = p.deltas.find((x) => x.key === "full_week_coverage")!;
  assert(d.to > d.from, "reward weight should grow");
  assert(d.to <= 150, "clamped to +150 (150% of default)");
});

Deno.test("learning: hard-constraint weights are never proposed", () => {
  assert(!LEARNABLE_KEYS.includes("errors"));
  assert(!LEARNABLE_KEYS.includes("warnings"));
  const p = proposeWeightDeltas({ errors: -1000, warnings: -50 }, { errors: 0, warnings: 0 }, W);
  assert(!p.deltas.some((d) => d.key === "errors" || d.key === "warnings"));
});

Deno.test("learning: identical breakdowns ⇒ no proposal", () => {
  const p = proposeWeightDeltas({ subject_gap: -40 }, { subject_gap: -40 }, W);
  assertEquals(p.deltas.length, 0);
  assertEquals(p.proposedWeights.subject_gap, W.subject_gap);
});

Deno.test("learning: repeated consistent samples converge to the ±50% clamp and stop", () => {
  let weights = { ...W };
  let lastSubjectGap = weights.subject_gap;
  for (let i = 0; i < 30; i++) {
    const p = proposeWeightDeltas({ subject_gap: -120 }, { subject_gap: -40 }, weights);
    weights = p.proposedWeights;
    // Monotonic toward the clamp, never past it.
    assert(weights.subject_gap <= lastSubjectGap + 1e-9);
    assert(weights.subject_gap >= -60 - 1e-9, "never exceeds −60 (150% of −40)");
    lastSubjectGap = weights.subject_gap;
  }
  // Converged at the clamp.
  assertEquals(Math.round(weights.subject_gap), -60);
});

Deno.test("learning: clampToDefault respects ±50% for negative and positive defaults", () => {
  assertEquals(clampToDefault("subject_gap", -200), -60); // −40 → [−60,−20]
  assertEquals(clampToDefault("subject_gap", -10), -20);
  assertEquals(clampToDefault("full_week_coverage", 999), 150); // +100 → [50,150]
  assertEquals(clampToDefault("full_week_coverage", 1), 50);
});
