// Corridor dispersion, measured - the input every headline figure is most
// sensitive to and the one nobody had measured.
//
// ─── WHICH DISPERSION ────────────────────────────────────────────────────
//
// `travelTimeVariation` is NOT a headway CV, and the two are routinely
// confused because both are called "how spread out this corridor is".
//
//   travelTimeVariation  the coefficient of variation of ONE LEG's running
//                        time. `rehearsal/run.ts` uses it exactly this way
//                        (`stddevSeconds = meanSeconds x travelTimeVariation`)
//                        and `lib/controllability.ts` builds sigma_leg from
//                        it. `evaluation/eligibility.ts#measuredAssumptions-
//                        FromFittedLinks` states the estimator: the mean over
//                        fitted legs of stddev/mean.
//
//   headway CV           the spread of the GAPS BETWEEN BUSES. It is an
//                        OUTCOME - dispersion is one of its causes, and so
//                        are the timetable, the dispatch discipline and the
//                        control the corridor is already under. A network
//                        headway CV of 1.78 says buses are unevenly spaced;
//                        it does not say a leg's running time varies by 178%,
//                        and substituting one for the other would put
//                        `travelTimeVariation` an order of magnitude above
//                        anything a road produces.
//
// So this module measures leg times, and `headwayDispersionDiagnostic` below
// reports the headway CV beside it, labelled as the diagnostic it is.
//
// ─── WHY THE ESTIMATOR IS POOLED ─────────────────────────────────────────
//
// `fitLinkTravelTimes` needs 8 traversals before it reports a link, which is
// right for a p90 and ruinous for a network-wide CV: measured on this
// network's first day of stop visits, SIX links out of 695 reach it. Taking
// the mean CV over those six does not measure the network, it measures the
// six busiest links - and a minimum-sample cut selects exactly the links most
// likely to have shown their tail, so the number RISES with the cut (0.150 at
// n>=3, 0.247 at n>=8) for a reason that is about the cut and not the roads.
//
// The pooled estimator weights each link by its own degrees of freedom:
//
//     cv_pooled = sqrt( SUM (n_l - 1) x cv_l^2  /  SUM (n_l - 1) )
//
// It uses every link with two traversals, so nothing is selected on sample
// count, and it estimates the typical WITHIN-LINK coefficient of variation
// under the assumption that that coefficient is roughly common across legs.
// That assumption is the estimator's cost and it is stated, not hidden:
// `perLink` is returned alongside so a caller can check the spread it pools
// over.
import { fitLinkTravelTimes, type LinkObservation } from './linkTravelTime.js';

/** One link's own running-time spread. */
export interface LinkDispersion {
  routeDirectionId: string;
  fromStopId: string;
  toStopId: string;
  sampleCount: number;
  meanSeconds: number;
  /** Sample standard deviation (n-1). `fitLinkTravelTimes` reports the population one; at n = 3 that is 18% lower. */
  stddevSeconds: number;
  coefficientOfVariation: number;
}

export interface DispersionMeasurement {
  /** The number `travelTimeVariation` should be set to, on this evidence. Null when nothing had two traversals. */
  pooledCoefficientOfVariation: number | null;
  /** Links that contributed, and the total spread they were pooled from. */
  linksPooled: number;
  traversalsPooled: number;
  degreesOfFreedom: number;
  /** Median of the per-link CVs - a check that the pooled figure is not one loud link. Null when nothing pooled. */
  medianCoefficientOfVariation: number | null;
  perLink: LinkDispersion[];
  /**
   * The same quantity computed the way `evaluation/eligibility.ts` computes
   * it today - unweighted mean over links reaching `fitLinkTravelTimes`'
   * minimum. Reported so the two are comparable, and null when too few links
   * reach that minimum, which on thin data is the normal answer.
   */
  eligibilityStyleMean: number | null;
  eligibilityStyleLinks: number;
}

/** Minimum traversals before a link can contribute a variance at all. Two is the arithmetic floor, not a quality bar. */
export const MIN_TRAVERSALS_FOR_VARIANCE = 2;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? null);
}

/**
 * Measure a corridor's leg-time dispersion from observed traversals.
 *
 * Pure over the observations it is handed, so the caller decides whether they
 * have been through `calibration/contamination.ts` first - and the difference
 * between the two answers is itself the measurement of how contaminated the
 * input was.
 */
export function measureDispersion(
  observations: readonly LinkObservation[],
): DispersionMeasurement {
  const buckets = new Map<string, { key: LinkObservation; values: number[] }>();
  for (const observation of observations) {
    if (!Number.isFinite(observation.travelSeconds) || observation.travelSeconds <= 0) continue;
    const key = `${observation.routeDirectionId} ${observation.fromStopId} ${observation.toStopId}`;
    const bucket = buckets.get(key) ?? { key: observation, values: [] };
    bucket.values.push(observation.travelSeconds);
    buckets.set(key, bucket);
  }

  const perLink: LinkDispersion[] = [];
  let weightedSquares = 0;
  let degreesOfFreedom = 0;
  let traversalsPooled = 0;

  for (const bucket of buckets.values()) {
    const n = bucket.values.length;
    if (n < MIN_TRAVERSALS_FOR_VARIANCE) continue;
    const mean = bucket.values.reduce((s, v) => s + v, 0) / n;
    if (!(mean > 0)) continue;
    // Sample variance: each link's own mean was estimated from the same n
    // observations, so dividing by n understates the spread, worst exactly
    // where the data is thinnest.
    const variance = bucket.values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
    const cv = Math.sqrt(variance) / mean;
    if (!Number.isFinite(cv)) continue;

    perLink.push({
      routeDirectionId: bucket.key.routeDirectionId,
      fromStopId: bucket.key.fromStopId,
      toStopId: bucket.key.toStopId,
      sampleCount: n,
      meanSeconds: mean,
      stddevSeconds: Math.sqrt(variance),
      coefficientOfVariation: cv,
    });
    weightedSquares += (n - 1) * cv * cv;
    degreesOfFreedom += n - 1;
    traversalsPooled += n;
  }

  // The estimator `evaluation/eligibility.ts` uses today, for comparison:
  // unweighted mean of stddev/mean over links that clear fitLinkTravelTimes'
  // own minimum. Its population stddev is kept as-is - the point is to report
  // what that path would say, not a corrected version of it.
  const fitted = fitLinkTravelTimes(observations);
  const eligibilityStyle = fitted
    .filter((model) => model.meanSeconds > 0)
    .map((model) => model.stddevSeconds / model.meanSeconds);

  return {
    pooledCoefficientOfVariation:
      degreesOfFreedom > 0 ? Math.sqrt(weightedSquares / degreesOfFreedom) : null,
    linksPooled: perLink.length,
    traversalsPooled,
    degreesOfFreedom,
    medianCoefficientOfVariation: median(perLink.map((link) => link.coefficientOfVariation)),
    perLink: perLink.sort((a, b) => b.sampleCount - a.sampleCount),
    eligibilityStyleMean:
      eligibilityStyle.length > 0
        ? eligibilityStyle.reduce((s, v) => s + v, 0) / eligibilityStyle.length
        : null,
    eligibilityStyleLinks: eligibilityStyle.length,
  };
}

/**
 * Headway CV, reported so a reader can see it is a different number.
 *
 * AGENTS.md's rule for the simulator applies here too: headway CV is a
 * DIAGNOSTIC. It is scale-free, so lengthening every headway uniformly
 * "improves" it, and it is an outcome of dispersion rather than a measure of
 * it. It is computed here only so that a report quoting a network headway CV
 * cannot be mistaken for one quoting `travelTimeVariation`.
 */
export function headwayDispersionDiagnostic(
  headwaySeconds: readonly number[],
): { count: number; meanSeconds: number | null; coefficientOfVariation: number | null } {
  const values = headwaySeconds.filter((v) => Number.isFinite(v) && v > 0);
  if (values.length < 2) {
    return { count: values.length, meanSeconds: values[0] ?? null, coefficientOfVariation: null };
  }
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return {
    count: values.length,
    meanSeconds: mean,
    coefficientOfVariation: mean > 0 ? Math.sqrt(variance) / mean : null,
  };
}
