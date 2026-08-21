// Headway dispersion: CV and Excess Wait Time from a bare list of headways.
//
// ─── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────
//
// Three places in this service reduce a list of headways to the same two
// numbers, and they are compared against each other by operators:
//
//   headway/metrics.ts      MODEL-BASED headways, derived from GPS gaps
//   headway/stopHeadway.ts  MEASURED departure-to-departure headways
//   simulation/kpi.ts       SIMULATED headways at control points
//
// They are different observations of the same quantity. If any one of them
// carries its own copy of the arithmetic, a comparison between them quietly
// becomes a comparison of two methodologies, and the difference gets read as
// a finding about the network.
//
// That is not hypothetical: `simulation/kpi.ts` used to compute EWT as
//
//     sum over samples of  max(0, h/2 - H*/2)
//
// a FIRST-moment proxy, clipped per sample. Clipping each sample at zero
// discards the saving from short headways while keeping the full cost of long
// ones, and using the mean rather than the second moment understates a long
// gap in the first place. Both errors point the same way: they understate the
// spread that bunching produces, and therefore understate how much any
// controller improves it. A simulator whose headline metric is biased against
// its own subject is worse than one with no metric at all.
//
// `simulation/**` may not import `../headway/*` (its isolation contract - see
// simulation/types.ts), which is why the shared arithmetic lives here in
// `lib/` rather than in `headway/`. This module imports nothing.

export interface HeadwayDispersion {
  sampleCount: number;
  meanHeadwaySeconds: number | null;
  stddevHeadwaySeconds: number | null;
  cv: number | null;
  ewtSeconds: number | null;
}

/**
 * CV and EWT for a list of headways in seconds.
 *
 * EWT follows the standard "actual wait minus scheduled wait" methodology
 * (e.g. TfL's Excess Wait Time KPI): actual mean wait for a Poisson-ish
 * arriving passenger is
 *
 *     E[h^2] / (2 * E[h])  =  (variance + mean^2) / (2 * mean)
 *
 * which is governed by the SECOND moment of the headway distribution - so one
 * long gap costs more than several short headways save, which is precisely
 * what bunching produces. Scheduled wait is `targetHeadwaySeconds / 2`, and
 * EWT is the non-negative difference.
 *
 * Returns all-null on an empty sample rather than zero. Zero EWT is a claim
 * that passengers waited exactly as long as the timetable promised; no
 * samples is a claim about nothing.
 */
export function computeDispersion(
  headwaySeconds: readonly number[],
  targetHeadwaySeconds: number,
): HeadwayDispersion {
  const sampleCount = headwaySeconds.length;
  if (sampleCount === 0) {
    return {
      sampleCount: 0,
      meanHeadwaySeconds: null,
      stddevHeadwaySeconds: null,
      cv: null,
      ewtSeconds: null,
    };
  }

  const mean = headwaySeconds.reduce((sum, v) => sum + v, 0) / sampleCount;
  const variance = headwaySeconds.reduce((sum, v) => sum + (v - mean) ** 2, 0) / sampleCount;
  const stddev = Math.sqrt(variance);
  const cv = mean > 0 ? stddev / mean : null;

  const scheduledWaitSeconds = targetHeadwaySeconds / 2;
  const actualMeanWaitSeconds = mean > 0 ? (variance + mean * mean) / (2 * mean) : 0;
  const ewtSeconds = Math.max(0, actualMeanWaitSeconds - scheduledWaitSeconds);

  return {
    sampleCount,
    meanHeadwaySeconds: mean,
    stddevHeadwaySeconds: stddev,
    cv,
    ewtSeconds,
  };
}
