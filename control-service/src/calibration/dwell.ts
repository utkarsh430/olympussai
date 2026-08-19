// Fitting the dwell model - and with it, the bunching instability itself.
//
// ─── WHY DWELL IS THE WHOLE PROBLEM ──────────────────────────────────────
//
// Bunching is not a scheduling failure, it is an unstable equilibrium, and
// dwell time is the mechanism. Passengers accumulate at a stop in proportion
// to the gap since the last bus, boarding time is proportional to how many
// are waiting, so a bus running slightly late dwells slightly longer, falls
// further behind, and collects even more passengers next time:
//
//   dwell_s   =  beta_0 + beta_h x h_s
//   h_{s+1}  ~=  (1 + beta_h) x h_s  +  noise
//
// The multiplier `1 + beta_h` is the eigenvalue of the headway propagation.
// If it exceeds 1 - and it always does, because beta_h > 0 whenever anyone
// boards - then even headways are an unstable fixed point and any
// perturbation grows geometrically stop by stop. No timetable prevents this;
// only negative feedback does.
//
// Fitting beta_h therefore does something no other number in this system
// does: it says HOW FAST a given corridor comes apart, which is what decides
// whether a corridor needs control at all and how early that control has to
// act. A corridor at 1.02 drifts slowly enough that terminal dispatch alone
// may hold it; one at 1.4 will bunch within a handful of stops whatever
// happens at the terminal.
//
// ─── WHAT THIS FITS TODAY, AND WHAT IT WAITS FOR ─────────────────────────
//
// The reference form is `dwell = beta_0 + beta_b x B + beta_a x A`, needing
// boardings and alightings per stop - which arrive with ticketing data and
// not before. This module fits the REDUCED form against preceding headway
// instead:
//
//   dwell = beta_0 + beta_h x preceding_headway
//
// It needs only `stop_visits`, which fills from the GPS feed already running.
// The two are not rivals: because B ~= lambda x h, beta_h is approximately
// beta_b x lambda, so the reduced fit measures the compound quantity that
// actually drives the instability. When boardings arrive, `fitDwellModel`
// gains those regressors and beta_h becomes decomposable into a boarding rate
// and a per-passenger service time. Nothing above it has to change: the
// consumer wants an expected dwell, and both forms provide one.
import type { StopVisitRecord } from '../headway/stopHeadway.js';
import { dwellSeconds } from '../headway/stopHeadway.js';

/** One (preceding headway, observed dwell) pair at a stop. */
export interface DwellObservation {
  stopId: string;
  routeDirectionId: string;
  precedingHeadwaySeconds: number;
  dwellSeconds: number;
}

export interface DwellModel {
  stopId: string;
  routeDirectionId: string;
  /** Fixed dwell overhead: doors, fare setup, the part that does not scale with waiting passengers. */
  beta0Seconds: number;
  /**
   * Seconds of extra dwell per second of preceding headway. The bunching
   * eigenvalue is `1 + betaHeadway`; strictly positive means this stop
   * amplifies headway deviations rather than damping them.
   */
  betaHeadway: number;
  /** Share of dwell variance the fit explains. Low means dwell here is driven by something this model does not see. */
  rSquared: number;
  sampleCount: number;
}

/**
 * Dwell times paired with the headway that preceded them.
 *
 * The pairing is what makes this a model of the instability rather than a
 * histogram of dwell times: a dwell is explained by the gap that fed it, so
 * each visit is matched to the interval since the PREVIOUS bus departed the
 * same stop in the same direction. The first visit at a stop has no
 * predecessor and is dropped rather than paired with a guessed headway.
 */
export function buildDwellObservations(
  visits: readonly StopVisitRecord[],
): DwellObservation[] {
  const byStop = new Map<string, StopVisitRecord[]>();
  for (const visit of visits) {
    const key = `${visit.routeDirectionId} ${visit.stopId}`;
    const bucket = byStop.get(key) ?? [];
    bucket.push(visit);
    byStop.set(key, bucket);
  }

  const observations: DwellObservation[] = [];
  for (const bucket of byStop.values()) {
    const sorted = [...bucket].sort(
      (a, b) => new Date(a.departedAt).getTime() - new Date(b.departedAt).getTime(),
    );
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1]!;
      const current = sorted[i]!;
      const headway =
        (new Date(current.departedAt).getTime() - new Date(previous.departedAt).getTime()) / 1000;
      const dwell = dwellSeconds(current);
      if (!Number.isFinite(headway) || headway <= 0) continue;
      if (dwell <= 0) continue;
      observations.push({
        stopId: current.stopId,
        routeDirectionId: current.routeDirectionId,
        precedingHeadwaySeconds: headway,
        dwellSeconds: dwell,
      });
    }
  }
  return observations;
}

/**
 * Least-squares fit of dwell against preceding headway, per stop.
 *
 * @param minSamples the fewest observations a stop must have before a model
 *   is emitted for it. A two-point "fit" passes through both points with
 *   R-squared 1 and means nothing; a stop below the threshold gets NO model
 *   rather than a confident wrong one, matching how this codebase treats an
 *   uncalibrated target headway.
 */
export function fitDwellModel(
  observations: readonly DwellObservation[],
  minSamples = 12,
): DwellModel[] {
  const byStop = new Map<string, DwellObservation[]>();
  for (const observation of observations) {
    const key = `${observation.routeDirectionId} ${observation.stopId}`;
    const bucket = byStop.get(key) ?? [];
    bucket.push(observation);
    byStop.set(key, bucket);
  }

  const models: DwellModel[] = [];
  for (const bucket of byStop.values()) {
    if (bucket.length < minSamples) continue;
    const first = bucket[0]!;

    const n = bucket.length;
    const meanX = bucket.reduce((s, o) => s + o.precedingHeadwaySeconds, 0) / n;
    const meanY = bucket.reduce((s, o) => s + o.dwellSeconds, 0) / n;

    let sxx = 0;
    let sxy = 0;
    for (const o of bucket) {
      const dx = o.precedingHeadwaySeconds - meanX;
      sxx += dx * dx;
      sxy += dx * (o.dwellSeconds - meanY);
    }

    // Every observation shared one headway, so the slope is not identifiable.
    // Reporting a zero slope would claim this stop does not amplify headway
    // deviations, which the data does not say either way.
    if (sxx === 0) continue;

    const betaHeadway = sxy / sxx;
    const beta0Seconds = meanY - betaHeadway * meanX;

    let ssTot = 0;
    let ssRes = 0;
    for (const o of bucket) {
      const predicted = beta0Seconds + betaHeadway * o.precedingHeadwaySeconds;
      ssTot += (o.dwellSeconds - meanY) ** 2;
      ssRes += (o.dwellSeconds - predicted) ** 2;
    }
    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    models.push({
      stopId: first.stopId,
      routeDirectionId: first.routeDirectionId,
      beta0Seconds,
      betaHeadway,
      rSquared,
      sampleCount: n,
    });
  }

  return models.sort((a, b) => a.stopId.localeCompare(b.stopId));
}

/**
 * How long this stop should take, given the gap since the last bus.
 *
 * Floored at zero: a fit whose intercept lands below zero at short headways
 * is extrapolating outside its data, and a negative expected dwell would
 * make every real dwell look excessive to the denied-boarding detector.
 */
export function expectedDwellSeconds(
  model: DwellModel,
  precedingHeadwaySeconds: number,
): number {
  return Math.max(0, model.beta0Seconds + model.betaHeadway * precedingHeadwaySeconds);
}

/**
 * The headway propagation eigenvalue, `1 + beta_h`.
 *
 * Above 1 the stop amplifies headway deviations and bunching is inevitable
 * without control; at or below 1 it damps them. Reported per stop because
 * the amplification is not uniform along a route - a handful of high-demand
 * stops generate most of the variance, and those are where control points
 * belong. Placing them evenly spends the intervention budget where it does
 * nothing.
 */
export function headwayAmplification(model: DwellModel): number {
  return 1 + model.betaHeadway;
}
