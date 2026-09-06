// Replacing the invented demand profile with a fitted one.
//
// ─── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────
//
// Everything the harness measures is conditional on a demand model nobody
// measured. `DEFAULT_MODELLED_INPUTS` picks 1.5 boardings/min, 18% alighting
// and 52 seats because they are plausible for a UP intercity corridor and for
// no stronger reason. Tuning a controller gain against those numbers produces
// a gain fitted to a fiction, and the fiction is not even neutral: at those
// values the steady-state load is `lambda x H* / alighting` ~= 125 against 52
// seats, so the corridor saturates and the headline metric cannot respond to
// control at all.
//
// ─── LAMBDA WITHOUT TICKETING DATA ───────────────────────────────────────
//
// The obvious blocker is that nobody counts boardings: `occupancy_count` is
// null fleet-wide and no ingestion path writes it, so `calibration/demand.ts`
// correctly fits nothing and says so. But lambda can be recovered anyway,
// from data the GPS feed already produces.
//
// `calibration/dwell.ts` fits the reduced dwell form against `stop_visits`:
//
//     dwell = beta_0 + beta_h x h_preceding
//
// and because boardings B ~= lambda x h, the fitted slope is the COMPOUND
// quantity beta_h ~= beta_b x lambda, where beta_b is seconds of dwell per
// boarding passenger. So:
//
//     lambda = beta_h / beta_b
//
// beta_b is the one number here taken from engineering practice rather than
// from data - it is a property of the vehicle's doors and fare handling, not
// of this corridor's demand - and it is stated as an assumption in the
// provenance every run carries. Everything else is measured.
//
// Two more things fall out of the same fit and are worth as much as lambda:
//
//   beta_0            the fixed dwell overhead, replacing another guess.
//   1 + beta_h        the headway propagation eigenvalue
//                     (`calibration/dwell.ts#headwayAmplification`). It says
//                     how fast a corridor comes apart, which is what decides
//                     whether it needs control at all and how early.
//
// ─── WHAT IS STILL NOT MEASURED ──────────────────────────────────────────
//
//   * The ALIGHTING fraction. Nothing observes passengers leaving either, and
//     unlike boardings it does not fall out of the dwell fit: the reduced
//     form regresses on preceding headway, which alighting does not scale
//     with. It stays modelled and stays labelled modelled.
//   * VEHICLE CAPACITY. A property of the fleet, not of a corridor.
//   * Per-hour variation. `fitLinkTravelTimes` supports time-of-day banding;
//     this pools across the day, because banding multiplies the sample count
//     a stop needs and most corridors will not have it yet. The banding hook
//     is left in place rather than removed.
import {
  buildDwellObservations,
  fitDwellModel,
  headwayAmplification,
  type DwellModel,
} from '../calibration/dwell.js';
import { buildLinkObservations, fitLinkTravelTimes } from '../calibration/linkTravelTime.js';
import { listRecentStopVisits } from '../headway/repository.js';
import type { CorridorOverrides } from '../rehearsal/run.js';
import type { LinkTravelTimeModel, StopDemandModel } from '../simulation/types.js';
import type { StopVisitRecord } from '../headway/stopHeadway.js';

/**
 * Seconds of dwell per boarding passenger - the one assumed constant, and the
 * divisor that turns the fitted `beta_h` into a passenger arrival rate.
 *
 * A property of the vehicle: door count, whether boarding is front-only, and
 * whether the conductor sells tickets at the door. 2.5s is the mid-range
 * figure for single-door front boarding with on-board fare collection and is
 * the same value `DEFAULT_MODELLED_INPUTS` already assumes, so switching a
 * corridor to calibrated inputs does not silently also change this.
 *
 * Overridable per run precisely because it is an assumption: a fleet with
 * two-door boarding would use a lower value, and every lambda derived here
 * scales inversely with it.
 */
export const DEFAULT_SECONDS_PER_BOARDING = 2.5;

/** How far back to read stop visits. Long enough for a fit, short enough that a timetable change months ago is not being fitted. */
export const DEFAULT_LOOKBACK_HOURS = 24 * 14;

/**
 * The only two things a calibration needs to know about a corridor: which
 * route-direction it is, and which stops belong to it.
 *
 * `CorridorInputs` satisfies this structurally, so every existing caller is
 * unchanged. It is stated separately because a caller that has a corridor's
 * stop list WITHOUT its policy, geometry and shape - `evaluation/eligibilityCli.ts`
 * reporting on corridors the simulator refuses to load - must be able to fit
 * one without fabricating the rest of a `CorridorInputs`.
 */
export interface CalibrationCorridor {
  routeDirectionId: string;
  stops: readonly { stopId: string }[];
}

export interface StopCalibration {
  stopId: string;
  /** Fixed dwell overhead, seconds. Measured. */
  beta0Seconds: number;
  /** Seconds of dwell per second of preceding headway. Measured. */
  betaHeadway: number;
  /** `1 + betaHeadway`. Above 1 this stop amplifies headway deviations and bunching is inevitable without control. */
  amplification: number;
  /** Passengers per minute, derived as `betaHeadway / secondsPerBoarding x 60`. Measured up to that one assumption. */
  boardingRatePerMinute: number;
  rSquared: number;
  sampleCount: number;
}

export interface CorridorCalibration {
  routeDirectionId: string;
  /** Per-stop demand to merge over the modelled profile. Only stops that fitted. */
  overrides: CorridorOverrides;
  stops: StopCalibration[];
  /** Links whose travel time was fitted from observed traversals. */
  linksFitted: number;
  /** Stops on the corridor, for reading the two counts above as a share. */
  stopCount: number;
  /** Median `1 + beta_h` across fitted stops - the corridor's own instability rate. Null when nothing fitted. */
  medianAmplification: number | null;
  /** The assumption every derived lambda rests on. */
  secondsPerBoardingAssumed: number;
  visitsRead: number;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? null);
}

/**
 * Turn one corridor's observed stop visits into fitted inputs.
 *
 * Pure over the visits it is given, so the fit is testable without a database
 * and the loader below is the only thing that needs one.
 */
export function calibrateFromVisits(
  corridor: CalibrationCorridor,
  visits: readonly StopVisitRecord[],
  secondsPerBoarding: number = DEFAULT_SECONDS_PER_BOARDING,
): CorridorCalibration {
  const dwellModels: DwellModel[] = fitDwellModel(buildDwellObservations(visits));
  const stopIdsOnCorridor = new Set(corridor.stops.map((stop) => stop.stopId));

  const stops: StopCalibration[] = [];
  const demandByStopId = new Map<string, Partial<StopDemandModel>>();

  for (const model of dwellModels) {
    if (!stopIdsOnCorridor.has(model.stopId)) continue;
    // A negative slope means dwell SHRANK as the preceding gap grew, which no
    // boarding process produces. It is noise or a mis-paired visit, and
    // dividing it by beta_b would hand the simulator a negative arrival rate.
    if (!Number.isFinite(model.betaHeadway) || model.betaHeadway <= 0) continue;

    const boardingRatePerMinute = (model.betaHeadway / secondsPerBoarding) * 60;
    if (!Number.isFinite(boardingRatePerMinute) || boardingRatePerMinute <= 0) continue;

    stops.push({
      stopId: model.stopId,
      beta0Seconds: model.beta0Seconds,
      betaHeadway: model.betaHeadway,
      amplification: headwayAmplification(model),
      boardingRatePerMinute,
      rSquared: model.rSquared,
      sampleCount: model.sampleCount,
    });
    demandByStopId.set(model.stopId, {
      boardingRatePerMinute,
      baseDwellSeconds: Math.max(0, model.beta0Seconds),
      secondsPerBoarding,
    });
  }

  // Link travel times, keyed by the stop each link ARRIVES at so they line up
  // with `links[i]` being the leg into `stops[i]`.
  const linkModels = fitLinkTravelTimes(buildLinkObservations(visits));
  const linkByToStopId = new Map<string, LinkTravelTimeModel>();
  for (const model of linkModels) {
    if (!stopIdsOnCorridor.has(model.toStopId)) continue;
    if (!Number.isFinite(model.meanSeconds) || model.meanSeconds <= 0) continue;
    linkByToStopId.set(model.toStopId, {
      meanSeconds: model.meanSeconds,
      stddevSeconds: Math.max(0, model.stddevSeconds),
    });
  }

  return {
    routeDirectionId: corridor.routeDirectionId,
    overrides: {
      demandByStopId: demandByStopId.size > 0 ? demandByStopId : undefined,
      linkByToStopId: linkByToStopId.size > 0 ? linkByToStopId : undefined,
    },
    stops,
    linksFitted: linkByToStopId.size,
    stopCount: corridor.stops.length,
    medianAmplification: median(stops.map((stop) => stop.amplification)),
    secondsPerBoardingAssumed: secondsPerBoarding,
    visitsRead: visits.length,
  };
}

/** Read a corridor's observed stop visits and fit them. Read-only; returns a calibration that may cover nothing. */
export async function calibrateCorridor(
  corridor: CalibrationCorridor,
  lookbackHours: number = DEFAULT_LOOKBACK_HOURS,
  secondsPerBoarding: number = DEFAULT_SECONDS_PER_BOARDING,
): Promise<CorridorCalibration> {
  const visits = await listRecentStopVisits(corridor.routeDirectionId, lookbackHours);
  return calibrateFromVisits(corridor, visits, secondsPerBoarding);
}

/** True when enough of the corridor fitted for a run to be called calibrated rather than modelled. */
export const MIN_CALIBRATED_STOP_SHARE = 0.5;

export function isCalibrated(calibration: CorridorCalibration): boolean {
  if (calibration.stopCount === 0) return false;
  return calibration.stops.length / calibration.stopCount >= MIN_CALIBRATED_STOP_SHARE;
}

/**
 * What a report must say about a calibration, in words.
 *
 * A half-calibrated corridor is the normal case and the dangerous one: the
 * numbers look fitted, and the stops that were not fitted are still carrying
 * the invented profile. Saying which is the difference between a measurement
 * and a demo.
 */
export function describeCalibration(calibration: CorridorCalibration): string {
  if (calibration.visitsRead === 0) {
    return `MODELLED. No stop visits recorded for ${calibration.routeDirectionId}, so nothing could be fitted and every demand input is the invented default.`;
  }
  if (calibration.stops.length === 0) {
    return `MODELLED. ${calibration.visitsRead} stop visits read for ${calibration.routeDirectionId}, but no stop had enough of them for a dwell fit. Every demand input is the invented default.`;
  }
  const share = calibration.stops.length / Math.max(1, calibration.stopCount);
  const label = isCalibrated(calibration) ? 'CALIBRATED' : 'PARTIALLY CALIBRATED';
  const amplification =
    calibration.medianAmplification === null
      ? 'unknown'
      : calibration.medianAmplification.toFixed(3);
  return [
    `${label}. Dwell fitted at ${calibration.stops.length}/${calibration.stopCount} stops (${(share * 100).toFixed(0)}%) and travel time at ${calibration.linksFitted} links, from ${calibration.visitsRead} recorded stop visits.`,
    `Median headway amplification 1 + beta_h = ${amplification} (above 1 means this corridor amplifies deviations and will bunch without control).`,
    `Boarding rates are derived as beta_h / ${calibration.secondsPerBoardingAssumed}s-per-boarding — that divisor is ASSUMED from the vehicle's door configuration, not measured, and every rate here scales inversely with it.`,
    `Alighting fraction and vehicle capacity remain modelled at every stop; unfitted stops keep the invented profile entirely.`,
  ].join(' ');
}
