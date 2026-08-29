/**
 * Solace — deterministic pseudo-randomness.
 *
 * Every random number in the synthetic data comes from here, and every one of
 * them is a function of a seed string. There is no `Math.random()` anywhere in
 * the data generator, and there must never be.
 *
 * That matters for a reason beyond tidiness. Solace's central claim is that
 * allocation decisions can be replayed and explained. A reviewer who wants to
 * check our work must be able to regenerate the exact dataset the engine ran
 * against, from nothing but the seed. `Math.random()` would make that
 * impossible, and would make the reproducibility tests in Phase 4 meaningless.
 *
 * The algorithms below are cyrb128 (string to four 32-bit seeds) and sfc32
 * (small fast counter). Both are well-known public-domain constructions. They
 * are not cryptographic and are not used for anything security-related — the
 * recipient hashing in `privacy.ts` is an entirely separate mechanism.
 */

/**
 * Hash a seed string into four 32-bit integers.
 *
 * A single 32-bit seed would give only about four billion distinct streams and
 * would correlate for similar strings, which matters here because our seeds are
 * things like "SOL-01:2026-08-14" that differ by one character.
 */
function cyrb128(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;

  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);

  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/** A deterministic source of randomness. */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  between(min: number, max: number): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** True with the given probability. */
  chance(probability: number): boolean;
  /** One element, chosen uniformly. */
  pick<T>(items: readonly T[]): T;
  /** Normally distributed, with the given mean and standard deviation. */
  normal(mean: number, standardDeviation: number): number;
}

/**
 * Create a deterministic random source from a seed string.
 *
 * The same seed always yields the same sequence, on any machine, in any
 * process, in any order of execution.
 */
export function createRng(seed: string): Rng {
  let [a, b, c, d] = cyrb128(seed);

  // sfc32. Fast, and passes the usual statistical test suites, which is more
  // than can be said for the linear congruential generators these are often
  // replaced with.
  function next(): number {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;

    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;

    return (t >>> 0) / 4294967296;
  }

  // Discard the first few outputs. Counter-based generators are poorly mixed
  // immediately after seeding, which would show up as correlation between
  // households whose seeds differ only in their last character.
  for (let i = 0; i < 12; i++) next();

  return {
    next,
    between: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) {
        throw new Error("Cannot pick from an empty list.");
      }
      return items[Math.floor(next() * items.length)];
    },
    normal: (mean, standardDeviation) => {
      // Box-Muller. `1 - next()` avoids log(0), which would return -Infinity.
      const u = 1 - next();
      const v = next();
      const magnitude = Math.sqrt(-2 * Math.log(u));
      return mean + standardDeviation * magnitude * Math.cos(2 * Math.PI * v);
    },
  };
}

/**
 * Clamp a value into a range.
 *
 * Used liberally below, because a normal distribution has infinite tails and
 * physical quantities do not. A house cannot consume negative electricity.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
