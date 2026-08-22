// Turning a pile of paired runs into a number somebody can act on.
//
// ─── A DIFFERENCE WITHOUT AN INTERVAL IS NOT A RESULT ────────────────────
//
// The quantity that matters is `controlled - baseline` on the SAME seed, and
// the question is whether its mean is distinguishable from zero. Reporting
// the mean alone invites the reader to act on a 2% improvement that is one
// unlucky seed wide, which is how a tuning exercise ends up shipping noise.
// `algo_new.md` section 8.4 requires confidence intervals across seeds for
// every metric, and this module is where that requirement is met.
//
// BOOTSTRAP, NOT A t-INTERVAL. Headway KPIs are bounded below, skewed, and
// evaluated at small seed counts; EWT in particular has a long right tail
// because it is driven by the second moment. A t-interval assumes a symmetry
// these do not have. The percentile bootstrap assumes only that the seeds are
// exchangeable, which by construction they are - they are draws from one
// generator differing in nothing but the seed.
//
// Pure arithmetic, no I/O.

/** A deterministic PRNG for the bootstrap, so an interval is reproducible from the run that produced it. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PairedDifference {
  /** How many seeds contributed a usable pair. Pairs where either side is null are dropped, and this says how many survived. */
  sampleCount: number;
  /** Mean of (controlled - baseline). Negative is an improvement for every cost-shaped KPI. */
  meanDifference: number | null;
  /** Mean of (controlled - baseline) / baseline, for reading as a percentage. Null when any baseline is zero. */
  meanRelativeDifference: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  /** True when the interval excludes zero - the only condition under which this harness will call a difference real. */
  significant: boolean;
  /** Share of seeds on which the controlled arm was at least as good. A mean that wins while most days lose is a lottery, not a controller. */
  winRate: number | null;
  meanBaseline: number | null;
  meanControlled: number | null;
}

export const BOOTSTRAP_RESAMPLES = 2000;
export const DEFAULT_CONFIDENCE = 0.95;

const EMPTY: PairedDifference = {
  sampleCount: 0,
  meanDifference: null,
  meanRelativeDifference: null,
  ciLow: null,
  ciHigh: null,
  significant: false,
  winRate: null,
  meanBaseline: null,
  meanControlled: null,
};

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Paired difference with a percentile-bootstrap interval.
 *
 * @param pairs one (baseline, controlled) reading per seed, already matched.
 * @param lowerIsBetter whether a decrease counts as a win, for `winRate`.
 * @param seed  bootstrap PRNG seed, so the interval is reproducible.
 */
export function pairedDifference(
  pairs: ReadonlyArray<{ baseline: number | null; controlled: number | null }>,
  lowerIsBetter: boolean,
  seed = 1,
  resamples = BOOTSTRAP_RESAMPLES,
  confidence = DEFAULT_CONFIDENCE,
): PairedDifference {
  const usable = pairs.filter(
    (p): p is { baseline: number; controlled: number } =>
      p.baseline !== null &&
      p.controlled !== null &&
      Number.isFinite(p.baseline) &&
      Number.isFinite(p.controlled),
  );
  if (usable.length === 0) return EMPTY;

  const differences = usable.map((p) => p.controlled - p.baseline);
  const meanDifference = mean(differences);
  const baselines = usable.map((p) => p.baseline);
  const controlleds = usable.map((p) => p.controlled);

  const relatives = usable
    .filter((p) => p.baseline !== 0)
    .map((p) => (p.controlled - p.baseline) / p.baseline);
  const meanRelativeDifference = relatives.length === usable.length ? mean(relatives) : null;

  const wins = usable.filter((p) =>
    lowerIsBetter ? p.controlled <= p.baseline : p.controlled >= p.baseline,
  ).length;

  // A single seed has no spread to resample; saying so is better than
  // returning an interval of zero width that looks like certainty.
  if (usable.length < 2) {
    return {
      sampleCount: usable.length,
      meanDifference,
      meanRelativeDifference,
      ciLow: null,
      ciHigh: null,
      significant: false,
      winRate: wins / usable.length,
      meanBaseline: mean(baselines),
      meanControlled: mean(controlleds),
    };
  }

  const random = mulberry32(seed);
  const means: number[] = new Array<number>(resamples).fill(0);
  for (let r = 0; r < resamples; r++) {
    let total = 0;
    for (let i = 0; i < differences.length; i++) {
      total += differences[Math.floor(random() * differences.length)] ?? 0;
    }
    means[r] = total / differences.length;
  }
  means.sort((a, b) => a - b);

  const alpha = (1 - confidence) / 2;
  const ciLow = means[Math.max(0, Math.floor(alpha * resamples))] ?? null;
  const ciHigh = means[Math.min(resamples - 1, Math.ceil((1 - alpha) * resamples) - 1)] ?? null;

  return {
    sampleCount: usable.length,
    meanDifference,
    meanRelativeDifference,
    ciLow,
    ciHigh,
    significant: ciLow !== null && ciHigh !== null && (ciLow > 0 || ciHigh < 0),
    winRate: wins / usable.length,
    meanBaseline: mean(baselines),
    meanControlled: mean(controlleds),
  };
}

/**
 * Whether a difference is a real improvement: significant, in the right
 * direction, and winning on more days than it loses.
 *
 * All three, deliberately. Significance alone admits a change that helps a
 * lot on two seeds and hurts slightly on thirty; the win rate is what stops a
 * mean from being the whole argument.
 */
export function isImprovement(difference: PairedDifference, lowerIsBetter: boolean): boolean {
  if (!difference.significant || difference.meanDifference === null) return false;
  const movedRightWay = lowerIsBetter ? difference.meanDifference < 0 : difference.meanDifference > 0;
  return movedRightWay && (difference.winRate ?? 0) > 0.5;
}
