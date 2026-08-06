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
