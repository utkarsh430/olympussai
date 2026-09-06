// What has to be thrown away before a dwell or a link time means anything.
//
// ─── THE PROBLEM ─────────────────────────────────────────────────────────
//
// `stop_visits` is inferred from position fixes against a 30 m geofence, and
// the inference cannot tell three things apart that look identical in the
// table:
//
//   * a bus SERVING the stop - doors open, people boarding. The only case
//     `calibration/dwell.ts` is a model of.
//   * a bus LAYING OVER at it - a terminal wait between trips, whose length
//     is set by a crew roster and a timetable and not by anybody boarding.
//     Measured on this network, median dwell at a route's first or last stop
//     is 524 s against 105 s mid-route.
//   * a bus PARKED inside the geofence, or map-matched onto a route it is not
//     running. It boards nobody and it moves nowhere.
//
// Pooled, the second and third do not add noise to the first - they add
// SIGNAL that is about something else. A layover's length correlates with the
// dispatch interval because both come from the same timetable, so regressing
// it on preceding headway returns a confident slope that has no boarding in
// it at all, and `lambda = beta_h / beta_b` turns that slope into a passenger
// arrival rate nobody arrived at.
//
// ─── WHY EACH EXCLUSION IS DERIVED AND NOT CHOSEN ────────────────────────
//
// Every bound here is either a route fact or an arithmetic consequence of the
// model being fitted. None of them is a percentile of the data, because a
// cut placed at a percentile removes a fixed share of whatever it is given
// and therefore cannot report that it found nothing.
//
//   single-leg     `buildLinkObservations` pairs visits adjacent in a
//                  VEHICLE's timeline, which is not the same as stops
//                  adjacent on the ROUTE. One missed geofence and the
//                  traversal spans two legs - and `fitLinkTravelTimes` keys
//                  its model on `toStopId`, so the over-long time is filed
//                  against the last leg of the run rather than discarded.
//                  Route sequence is the check, and it needs no threshold.
//
//   implied speed  distance over time for a leg whose length the route
//                  geometry already knows. A vehicle standing still whose
//                  fixes jitter between two stops registers a traversal it
//                  never made; the observed distribution reaches 1,346 km/h,
//                  which is not a bus.
//
//   boarding-bound A dwell this model can explain is `beta_0 + beta_b x B`
//                  and B cannot exceed the vehicle's capacity. So the longest
//                  dwell BOARDING could have produced is a property of the
//                  fleet, and a dwell above it is being explained by
//                  something the regressor does not see. This is the bound
//                  the model itself implies; it is not a judgement about
//                  which dwells look too long.
//
// ─── WHAT IT IS NOT ──────────────────────────────────────────────────────
//
// None of this makes a thin fit thick. Excluding contamination REMOVES
// samples, and on this network it removes them from stops that had barely
// enough to begin with. `ContaminationReport` exists so a caller can say how
// much of its input went and why, rather than quoting a cleaner number from
// less data as though it were the same measurement.
import type { DwellObservation } from './dwell.js';
import type { LinkObservation } from './linkTravelTime.js';

/**
 * Slowest and fastest a bus can average over one leg and still have run it.
 *
 * The floor is not "a slow bus" - a genuinely crawling bus shows up as a long
 * traversal, and the shipped `maxPlausibleSeconds` guard already bounds that.
 * It is there for the case where a leg's recorded time is long AND its
 * distance is short, which means the vehicle was not on the leg.
 *
 * The ceiling is a road-speed limit, not a vehicle one: these are 100 km/h
 * bounds on interurban highway running, and every observation above it on
 * this network is above it by an order of magnitude.
 */
export const MIN_IMPLIED_LEG_KMPH = 5;
export const MAX_IMPLIED_LEG_KMPH = 100;

/**
 * Seated capacity assumed when bounding a boarding dwell.
 *
 * Same 52 seats `DEFAULT_MODELLED_INPUTS` already assumes, so switching a
 * corridor onto filtered inputs does not silently also change the fleet.
 * Like `DEFAULT_SECONDS_PER_BOARDING` this is an ASSUMPTION and the bound
 * scales with it linearly.
 */
export const DEFAULT_VEHICLE_CAPACITY = 52;

/**
 * Fixed overhead allowed on top of the boarding time when bounding a dwell -
 * doors, ramp, fare setup, the part of `beta_0` that is not boarding.
 *
 * Generous on purpose. This bound exists to exclude a layover, and making it
 * tight enough to also exclude a slow door would start excluding the signal.
 */
export const DEFAULT_DWELL_OVERHEAD_SECONDS = 120;

/**
 * The longest dwell a boarding process could have produced.
 *
 * `beta_0 + beta_b x capacity`. A dwell above this is not a full bus taking a
 * long time to load; it is a bus doing something this model has no regressor
 * for. Returned rather than stored so a caller with a different fleet gets a
 * different bound from the same arithmetic.
 */
export function maxBoardingDwellSeconds(
  secondsPerBoarding: number,
  capacity: number = DEFAULT_VEHICLE_CAPACITY,
  overheadSeconds: number = DEFAULT_DWELL_OVERHEAD_SECONDS,
): number {
  return overheadSeconds + secondsPerBoarding * capacity;
}

/** One exclusion's tally: what it was, how much it took, and out of how much. */
export interface ExclusionTally {
  reason: string;
  removed: number;
  /** Observations the rule was actually able to judge. Below `considered` when the rule needed an input the corridor did not supply. */
  judged: number;
  considered: number;
}

export interface ContaminationReport {
  dwell: {
    kept: number;
    considered: number;
    exclusions: ExclusionTally[];
    /** The bound applied, so a report can state it rather than describing it. */
    maxBoardingDwellSeconds: number;
  };
  link: {
    kept: number;
    considered: number;
    exclusions: ExclusionTally[];
    /** False when the corridor supplied no leg distances, so the implied-speed rule could judge nothing. */
    impliedSpeedChecked: boolean;
  };
}

/** A corridor's stop order and geometry, as much of it as the caller has. */
export interface CorridorGeometry {
  stops: readonly { stopId: string; cumulativeDistanceMeters?: number }[];
}

interface StopIndexEntry {
  index: number;
  cumulativeDistanceMeters: number | null;
}

/**
 * First position of each stop in the corridor's own order.
 *
 * FIRST, not every position: a loop service lists some stops twice, and a
 * traversal between two of them is ambiguous rather than wrong. Taking the
 * first occurrence makes the adjacency test conservative - an ambiguous pair
 * fails it and is excluded - which is the direction an exclusion should err.
 */
function indexStops(geometry: CorridorGeometry): Map<string, StopIndexEntry> {
  const index = new Map<string, StopIndexEntry>();
  geometry.stops.forEach((stop, i) => {
    if (index.has(stop.stopId)) return;
    const distance = stop.cumulativeDistanceMeters;
    index.set(stop.stopId, {
      index: i,
      cumulativeDistanceMeters:
        typeof distance === 'number' && Number.isFinite(distance) ? distance : null,
    });
  });
  return index;
}

/**
 * Link traversals reduced to ones that are a single leg of this corridor, run
 * at a speed a bus can run.
 *
 * Both rules drop rather than clamp, for the reason `buildLinkObservations`
 * already gives: a clamped outlier is indistinguishable from a real slow run
 * in the sample it lands in.
 */
export function excludeContaminatedLinks(
  observations: readonly LinkObservation[],
  geometry: CorridorGeometry,
  options: { minKmph?: number; maxKmph?: number } = {},
): { kept: LinkObservation[]; exclusions: ExclusionTally[]; impliedSpeedChecked: boolean } {
  const minKmph = options.minKmph ?? MIN_IMPLIED_LEG_KMPH;
  const maxKmph = options.maxKmph ?? MAX_IMPLIED_LEG_KMPH;
  const stops = indexStops(geometry);

  const considered = observations.length;
  let notSingleLeg = 0;
  let speedJudged = 0;
  let impossibleSpeed = 0;
  const kept: LinkObservation[] = [];

  for (const observation of observations) {
    const from = stops.get(observation.fromStopId);
    const to = stops.get(observation.toStopId);
    // A traversal touching a stop this corridor does not list is not a leg of
    // it. Counted with the multi-leg spans because both mean the same thing:
    // the pair is not one link of this route.
    if (!from || !to || to.index !== from.index + 1) {
      notSingleLeg += 1;
      continue;
    }

    if (from.cumulativeDistanceMeters !== null && to.cumulativeDistanceMeters !== null) {
      const meters = to.cumulativeDistanceMeters - from.cumulativeDistanceMeters;
      if (meters > 0 && observation.travelSeconds > 0) {
        speedJudged += 1;
        const kmph = (meters / observation.travelSeconds) * 3.6;
        if (kmph < minKmph || kmph > maxKmph) {
          impossibleSpeed += 1;
          continue;
        }
      }
    }
    kept.push(observation);
  }

  return {
    kept,
    impliedSpeedChecked: speedJudged > 0,
    exclusions: [
      {
        reason: 'not a single leg of this corridor (missed stop, off-route return, or stop not on the route)',
        removed: notSingleLeg,
        judged: considered,
        considered,
      },
      {
        reason: `implied leg speed outside ${minKmph}-${maxKmph} km/h (stationary vehicle map-matched between two stops)`,
        removed: impossibleSpeed,
        judged: speedJudged,
        considered,
      },
    ],
  };
}

/**
 * Dwell observations reduced to ones a boarding process could have produced.
 *
 * One rule, applied to every observation the same way. A layover, a parked
 * bus and a bus held at a level crossing are not distinguished from each
 * other - they are all excluded together, because the fit has nothing to say
 * about any of them and pretending otherwise is what produces a lambda from
 * a crew roster.
 */
export function excludeContaminatedDwells(
  observations: readonly DwellObservation[],
  maxDwellSeconds: number,
): { kept: DwellObservation[]; exclusions: ExclusionTally[] } {
  const considered = observations.length;
  let overBoardingBound = 0;
  const kept: DwellObservation[] = [];

  for (const observation of observations) {
    if (!Number.isFinite(observation.dwellSeconds) || observation.dwellSeconds > maxDwellSeconds) {
      overBoardingBound += 1;
      continue;
    }
    kept.push(observation);
  }

  return {
    kept,
    exclusions: [
      {
        reason: `dwell above ${Math.round(maxDwellSeconds)}s, the longest a full vehicle boarding could produce (layover, parked, or otherwise not serving)`,
        removed: overBoardingBound,
        judged: considered,
        considered,
      },
    ],
  };
}

/** One line per exclusion, for a report that has to say what it removed. */
export function describeContamination(report: ContaminationReport): string[] {
  const lines: string[] = [];
  const share = (kept: number, considered: number) =>
    considered === 0 ? '0/0' : `${kept}/${considered} (${((100 * kept) / considered).toFixed(0)}%)`;

  lines.push(
    `Dwell observations kept ${share(report.dwell.kept, report.dwell.considered)}; boarding-dwell bound ${Math.round(report.dwell.maxBoardingDwellSeconds)}s.`,
  );
  for (const tally of report.dwell.exclusions) {
    lines.push(`  - removed ${tally.removed} of ${tally.judged} judged: ${tally.reason}`);
  }
  lines.push(`Link traversals kept ${share(report.link.kept, report.link.considered)}.`);
  for (const tally of report.link.exclusions) {
    lines.push(`  - removed ${tally.removed} of ${tally.judged} judged: ${tally.reason}`);
  }
  if (!report.link.impliedSpeedChecked) {
    lines.push(
      '  - implied-speed rule judged NOTHING: this corridor supplied no leg distances, so a map-matched stationary vehicle would not have been caught.',
    );
  }
  return lines;
}
