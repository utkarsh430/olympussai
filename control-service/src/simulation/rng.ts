// Deterministic seeded PRNG (mulberry32) plus a couple of samplers built
// on it. Every stochastic draw in the simulator goes through an instance
// of this - never `Math.random()` - so a given `ScenarioConfig.seed`
// always reproduces byte-identical results, which is what makes the
// regression suite (`regressionRunner.ts`) a stable release gate rather
// than a flaky one.
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Force a non-zero 32-bit state.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Uniform double in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Non-negative normal draw (Box-Muller), clamped to >= 0 - travel/dwell times can't be negative. */
  nextNonNegativeGaussian(mean: number, stddev: number): number {
    if (stddev <= 0) return mean;
    const u1 = Math.max(this.next(), Number.EPSILON);
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, mean + z * stddev);
  }

  /** Poisson-ish non-negative integer draw for passenger counts, via a normal approximation. */
  nextNonNegativeCount(mean: number): number {
    if (mean <= 0) return 0;
    const stddev = Math.sqrt(mean);
    return Math.max(0, Math.round(this.nextNonNegativeGaussian(mean, stddev)));
  }

  /** true with probability p. */
  nextBoolean(p: number): boolean {
    return this.next() < p;
  }
}

/**
 * One draw's own stream, keyed by what the draw is FOR.
 *
 * ─── WHY THE ENGINE CANNOT USE A SINGLE STREAM ───────────────────────────
 *
 * A trial's two arms - controlled and uncontrolled - run the same corridor,
 * the same plan and the same seed, and the comparison between them is the
 * entire output. On one stream they share random inputs only until the first
 * hold, because the NUMBER and ORDER of draws depend on what the controller
 * did: a held bus stands longer, so its late-boarder window is non-empty
 * where the other arm's was zero, and `nextNonNegativeCount` returns early
 * without consuming a draw when its mean is zero. One extra draw shifts every
 * subsequent one, and from there the two arms are running different days.
 *
 * MEASURED, urban, 250 buses, one scenario: issuing a SINGLE ONE-SECOND HOLD
 * to ONE bus and nothing else moved whole-network total passenger time by
 * +1.88% on one seed and -2.05% on another, and boardings by 378. Across
 * eight target buses the response had a standard deviation of ~1% per
 * corridor, and its distribution was bimodal - many probes exactly 0.000%,
 * the rest jumping one to two percent - which is the signature of a draw
 * being added or reordered rather than of smooth sensitivity. The trial's
 * headline effects are +0.7% to +3.0%. The noise floor was the size of the
 * signal, and it is what the "one seed is not a measurement" rule in
 * CLAUDE.md has been describing all along.
 *
 * So every draw gets a stream of its own, keyed by (seed, purpose, vehicle,
 * stop). A given bus's link time into a given stop is the same number in both
 * arms whatever either controller did; what the controller changes is the
 * MEAN the draw is transformed against - a longer standing window, a heavier
 * bus - which is the physical effect and the thing being measured. This is
 * common random numbers, and it is the difference between comparing two days
 * and comparing one day twice.
 */
export function drawStream(seed: number, purpose: string, vehicleId: string, index: number): Rng {
  return new Rng(hashKey(seed, purpose, vehicleId, index));
}

/** FNV-1a over the key, then a murmur3 finalizer - so adjacent keys land far apart. */
function hashKey(seed: number, purpose: string, vehicleId: string, index: number): number {
  let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
  const mix = (byte: number): void => {
    h = (h ^ byte) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (let i = 0; i < purpose.length; i++) mix(purpose.charCodeAt(i));
  mix(0x7c);
  for (let i = 0; i < vehicleId.length; i++) mix(vehicleId.charCodeAt(i));
  mix(0x7c);
  mix((index + 1) & 0xff);
  mix(((index + 1) >>> 8) & 0xff);

  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h >>> 0;
}
