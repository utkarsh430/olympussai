// WHERE the controller should run, decided from data instead of by judgement.
//
// ─── THE FINDING THIS EXISTS TO ACT ON ───────────────────────────────────
//
// The fleet trial measures the same laws on three corridor shapes and gets
// three different answers: urban (6-minute headway) +2.9% total passenger
// time, suburban (12-minute) +0.5%, inter-city (30-minute) zero to within the
// seed spread. What separates them is not the algorithm - the laws are
// identical on all three - but `lib/controllability.ts`'s sigma_leg / H*, and
// this network's MEDIAN planned headway is 1,800 s. On a 30-minute service
// more running-time deviation accumulates between two stops than a hold at
// either can remove, which is the regime outside which no published
// headway-control method claims to work.
//
// Deploying there is not free. A corridor under active control costs
// dispatcher attention, driver instructions and control-room load whether or
// not the holds help, and outside the band they do not. So this module answers
// one question per route-direction - should the controller run here at all -
// and answers it from the corridor's own geometry, its own measured target
// headway and its own live vehicle count.
//
// ─── THE BAND IS NOT DEFINED HERE ────────────────────────────────────────
//
// `CONTROLLABLE_BAND` and `assessControllability` live in `lib/controllability.ts`
// and are IMPORTED, never re-derived. Those bounds came from the sweep in
// `docs/FLEET_TRIAL.md`; a second copy of them here is exactly how a band
// drifts away from the evidence it was fitted on, and `test/evaluation/eligibility.test.ts`
// asserts this module answers on the imported bounds.
//
// ─── WHAT THIS MODULE DOES NOT DECIDE ────────────────────────────────────
//
// Nothing about HOW a corridor is controlled. No gain, no threshold, no law.
// It decides only whether the decision cycle should spend a slot on the
// corridor at all, and even that is behind a flag that ships off
// (`DECISION_CYCLE_ELIGIBILITY_GATE_ENABLED`).
import {
  assessControllability,
  type Controllability,
  type ControllabilityBand,
} from '../lib/controllability.js';

/**
 * The decision cycle reasons about a LEADER and a FOLLOWER, and every mid-route
 * law is a function of the gap between two buses. One bus on a corridor is not
 * a pair, so there is no headway to regulate however well-shaped the corridor
 * is - the same reason `listRouteDirectionsWithLiveHeadwayPairs` uses `offset 1`.
 */
export const MINIMUM_VEHICLES_FOR_A_DECISION = 2;

export type EligibilityVerdict =
  /** Calibrated, inside the band, and carrying a pair of buses. */
  | 'eligible'
  /** No measured target headway, so every threshold would be a ratio of a number nobody measured. */
  | 'uncalibrated'
  /** Fewer than two live vehicles, so no leader/follower pair can form. */
  | 'too_few_vehicles'
  /** Outside `CONTROLLABLE_BAND` - holding here costs full operational effort and returns nothing. */
  | 'out_of_band';

/**
 * The running-time inputs the band is decided on, and where they came from.
 *
 * `provenance` is not decoration. sigma_leg is `meanLeg / cruiseSpeed x
 * travelTimeVariation`, so a verdict is only as measured as those two numbers,
 * and on a network whose `stop_visits` log is empty they are the harness's
 * modelled defaults. A row that carries a modelled spread must say so or a
 * reader takes an assumption for a measurement.
 */
export interface ControllabilityAssumptions {
  cruiseSpeedKmph: number;
  travelTimeVariation: number;
  /** 'measured' only when both numbers came from this corridor's own fitted link travel times. */
  provenance: 'measured' | 'modelled';
}

/** One route-direction as the eligibility question needs it. Read-only; assembled by `eligibilityRepository.ts`. */
export interface CorridorShape {
  routeDirectionId: string;
  routeName: string | null;
  directionCode: string;
  /**
   * H*, from the active `route_policies` row - and NULL when that row's
   * `calibration_source` is 'none' or 'default', exactly as
   * `MEASURED_POLICY_PREDICATE` refuses it everywhere else. Never a sentinel.
   */
  targetHeadwaySeconds: number | null;
  /** `route_policies.calibration_source` on the active row; null when the corridor has no active policy at all. */
  calibrationSource: string | null;
  /** Stop distances along the route, in order, in metres. */
  cumulativeDistanceMeters: readonly number[];
  /** The stop ids those distances belong to, same order. Only needed to line fitted link times up with legs. */
  stopIds?: readonly string[];
  /** Live vehicles the decision cycle would see: mapped onto the route and fresher than `HEADWAY_VEHICLE_FRESHNESS_SECONDS`. */
  vehicleCount: number;
}

export interface CorridorEligibility {
  routeDirectionId: string;
  routeName: string | null;
  directionCode: string;
  targetHeadwaySeconds: number | null;
  calibrationSource: string | null;
  stopCount: number;
  vehicleCount: number;
  /** Null exactly when there is no measured H* to divide by. An absence, never a zero. */
  controllability: Controllability | null;
  inputs: ControllabilityAssumptions;
  verdict: EligibilityVerdict;
  /**
   * EVERY reason this corridor is not eligible, in the order they were
   * checked, not only the one the verdict names. A rollout plan needs all of
   * them: calibrating a single-bus corridor buys nothing.
   */
  reasons: string[];
  eligible: boolean;
}

/**
 * One corridor's verdict.
 *
 * Pure over its two arguments, so the whole decision is testable without a
 * database and the loader is the only thing that needs one.
 */
export function assessCorridorEligibility(
  shape: CorridorShape,
  inputs: ControllabilityAssumptions,
): CorridorEligibility {
  const reasons: string[] = [];
  let verdict: EligibilityVerdict | null = null;

  // A corridor with no measured target headway is refused before the band is
  // even asked about, because the band is a ratio OF that headway. Computing
  // one against the 1-second sentinel would put every such corridor deep into
  // `too_disturbed` and dress a missing measurement up as a finding.
  if (shape.targetHeadwaySeconds === null || shape.targetHeadwaySeconds <= 0) {
    verdict ??= 'uncalibrated';
    reasons.push(
      `No measured target headway (calibration_source ${shape.calibrationSource ?? 'no active policy'}). ` +
        'Every threshold in the controller is a ratio of H*, so there is nothing to control against.',
    );
  }

  const controllability =
    shape.targetHeadwaySeconds !== null && shape.targetHeadwaySeconds > 0
      ? assessControllability({
          cumulativeDistanceMeters: shape.cumulativeDistanceMeters,
          cruiseSpeedKmph: inputs.cruiseSpeedKmph,
          travelTimeVariation: inputs.travelTimeVariation,
          targetHeadwaySeconds: shape.targetHeadwaySeconds,
        })
      : null;

  if (shape.vehicleCount < MINIMUM_VEHICLES_FOR_A_DECISION) {
    verdict ??= 'too_few_vehicles';
    reasons.push(
      `${shape.vehicleCount} live vehicle${shape.vehicleCount === 1 ? '' : 's'} on the corridor; ` +
        `the decision cycle needs ${MINIMUM_VEHICLES_FOR_A_DECISION} to form a leader/follower pair.`,
    );
  }

  if (controllability !== null && controllability.band !== 'controllable') {
    verdict ??= 'out_of_band';
    reasons.push(
      `Outside the controllable band [${controllability.band}]: one leg's running time varies by ` +
        `${controllability.legTimeSigmaSeconds.toFixed(0)}s, ` +
        `${(controllability.disturbanceRatio * 100).toFixed(1)}% of the ${shape.targetHeadwaySeconds}s headway.`,
    );
  }

  return {
    routeDirectionId: shape.routeDirectionId,
    routeName: shape.routeName,
    directionCode: shape.directionCode,
    targetHeadwaySeconds: shape.targetHeadwaySeconds,
    calibrationSource: shape.calibrationSource,
    stopCount: shape.cumulativeDistanceMeters.length,
    vehicleCount: shape.vehicleCount,
    controllability,
    inputs,
    verdict: verdict ?? 'eligible',
    reasons,
    eligible: verdict === null,
  };
}

export interface EligibilitySummary {
  total: number;
  eligible: number;
  byVerdict: Record<EligibilityVerdict, number>;
  byBand: Record<ControllabilityBand, number>;
  /** Corridors with no band at all, because they have no measured H* to compute one against. */
  withoutBand: number;
  /** Buses on eligible corridors - the fleet a gated controller would still act on. */
  eligibleVehicles: number;
  /** Buses on corridors a gate would exclude. The operational effort the exclusion buys back. */
  excludedVehicles: number;
}

/** Corridor and vehicle counts by verdict, which is what sizes a rollout. */
export function summariseEligibility(
  verdicts: readonly CorridorEligibility[],
): EligibilitySummary {
  const byVerdict: Record<EligibilityVerdict, number> = {
    eligible: 0,
    uncalibrated: 0,
    too_few_vehicles: 0,
    out_of_band: 0,
  };
  const byBand: Record<ControllabilityBand, number> = {
    too_regular: 0,
    controllable: 0,
    too_disturbed: 0,
  };
  let withoutBand = 0;
  let eligibleVehicles = 0;
  let excludedVehicles = 0;

  for (const entry of verdicts) {
    byVerdict[entry.verdict] += 1;
    if (entry.controllability === null) withoutBand += 1;
    else byBand[entry.controllability.band] += 1;
    if (entry.eligible) eligibleVehicles += entry.vehicleCount;
    else excludedVehicles += entry.vehicleCount;
  }

  return {
    total: verdicts.length,
    eligible: byVerdict.eligible,
    byVerdict,
    byBand,
    withoutBand,
    eligibleVehicles,
    excludedVehicles,
  };
}

/**
 * How much of a corridor's legs must have a fitted travel time before the band
 * is decided on MEASURED running times rather than the harness's defaults.
 *
 * The same bar, and for the same reason, as `calibrate.ts#MIN_CALIBRATED_STOP_SHARE`:
 * a half-fitted corridor is the normal case and the dangerous one, because the
 * unfitted half is still carrying an invented number while the row says
 * "measured".
 */
export const MIN_FITTED_LINK_SHARE = 0.5;

/** One fitted leg, as `calibrate.ts` returns it - keyed by the stop the leg arrives at. */
export interface FittedLink {
  meanSeconds: number;
  stddevSeconds: number;
}

/**
 * Running-time assumptions recovered from a corridor's OWN fitted link travel
 * times, or null when too little of it fitted.
 *
 * This is the only way a verdict on this network stops being an assumption.
 * sigma_leg is `meanLeg / cruiseSpeed x travelTimeVariation`, and with an empty
 * `stop_visits` log both of those come from `DEFAULT_MODELLED_INPUTS` - so the
 * band a corridor lands in is currently a property of two numbers nobody
 * measured on it. `evaluation/calibrate.ts` already fits per-link mean and
 * standard deviation from recorded stop visits; this turns that fit into the
 * two inputs the controllability formula actually takes:
 *
 *   cruiseSpeedKmph      total fitted leg distance / total fitted leg time
 *   travelTimeVariation  the mean of each fitted leg's stddev/mean, which is
 *                        the definition `ControllabilityInputs` documents
 *
 * Legs with a non-positive mean are dropped rather than clamped: a zero-second
 * leg would make the derived cruise speed infinite.
 */
export function measuredAssumptionsFromFittedLinks(
  shape: CorridorShape,
  linkByToStopId: ReadonlyMap<string, FittedLink>,
  minFittedShare: number = MIN_FITTED_LINK_SHARE,
): ControllabilityAssumptions | null {
  const stopIds = shape.stopIds;
  if (!stopIds || stopIds.length !== shape.cumulativeDistanceMeters.length) return null;

  const legCount = Math.max(0, stopIds.length - 1);
  if (legCount === 0) return null;

  let fittedMeters = 0;
  let fittedSeconds = 0;
  let variationSum = 0;
  let fittedLegs = 0;

  for (let i = 1; i < stopIds.length; i++) {
    const link = linkByToStopId.get(stopIds[i]!);
    if (!link || !Number.isFinite(link.meanSeconds) || link.meanSeconds <= 0) continue;
    const legMeters =
      (shape.cumulativeDistanceMeters[i] ?? 0) - (shape.cumulativeDistanceMeters[i - 1] ?? 0);
    if (!Number.isFinite(legMeters) || legMeters <= 0) continue;

    fittedMeters += legMeters;
    fittedSeconds += link.meanSeconds;
    variationSum += Math.max(0, link.stddevSeconds) / link.meanSeconds;
    fittedLegs += 1;
  }

  if (fittedLegs / legCount < minFittedShare) return null;
  if (fittedSeconds <= 0) return null;

  return {
    cruiseSpeedKmph: (fittedMeters / fittedSeconds) * 3.6,
    travelTimeVariation: variationSum / fittedLegs,
    provenance: 'measured',
  };
}
