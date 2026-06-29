// Phase 3B: deterministic, seeded PRNG + shuffle.
// Used by the Monte Carlo runner (Phase 3C) so every iteration can
// produce a reproducible permutation of input orderings (grade lists,
// teacher lists, specialist rotation offsets) without touching
// Math.random() — which would defeat determinism guarantees made in
// Phase 3A.

export type Rng = () => number;

/**
 * Mulberry32: tiny, fast, well-distributed 32-bit PRNG. Given the
 * same seed it always produces the same stream of floats in [0, 1).
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle, driven by the provided RNG. Returns a new
 * array; the input is not mutated. Same `rng` state + same input ⇒
 * identical output, every time.
 */
export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** Derive a stable child seed from a parent seed + tag. */
export function deriveSeed(parent: number, tag: string): number {
  let h = parent >>> 0;
  for (let i = 0; i < tag.length; i++) {
    h = Math.imul(h ^ tag.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}
