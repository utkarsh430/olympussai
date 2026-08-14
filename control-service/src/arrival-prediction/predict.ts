// The arrival prediction itself: a pure function of live vehicle state, route
// geometry and peer speeds. No database, no clock of its own, no HTTP - all
// three are injected, so every branch below is unit-testable and the honesty
// guards can be exercised without standing anything up.
//
// ─── THE MODEL, IN ONE LINE ──────────────────────────────────────────────
//
//   eta(stop) = remaining dwell here
//             + (distance to stop) / (measured running speed)
//             + (modelled dwell) x (stops in between)
//             - (age of the fix)
//
// The first three terms are seconds from the OBSERVATION. The last converts the
// answer to seconds from NOW, and it is the only extrapolation this service
// performs. It is reported on the wire as `components.stateAgeSeconds` rather
// than folded in silently, because it is the term most likely to be wrong: it
// assumes the bus kept doing what it was doing during a stretch nobody watched.
//
// ─── WHAT IS MEASURED AND WHAT IS MODELLED ───────────────────────────────
//
//   distance to stop   MEASURED - route geometry, plus the Kalman position
//   running speed      MEASURED - this bus, or buses on the same stretch now
//   dwell              MODELLED - a configured constant (see ./dwell.ts)
//   age                MEASURED - two timestamps
//
// The two are never blended into one opaque figure. `components` breaks every
// arrival back into its parts, so the modelled portion of any number on a
// driver's screen can be identified and subtracted.

import { FUTURE_STATE_TOLERANCE_SECONDS } from '../mpc/safety.js';
import { LOW_CONFIDENCE_THRESHOLD } from '../state-estimation/confidence.js';
import { isPositionOnServedNetwork } from '../lib/servedNetwork.js';
import {
  DWELL_UNCERTAINTY_FRACTION,
  computeCurrentStopDwell,
  describeDwellModel,
  DEFAULT_DWELL_SECONDS,
} from './dwell.js';
import { MIN_RUNNING_SPEED_KMPH, resolveRunningSpeed } from './speed.js';
import type {
  ArrivalPredictionResponse,
  ConfidenceBand,
  PeerVehicleSpeed,
  PredictionEnvelope,
  PredictionRouteGeometry,
  PredictionStop,
  PredictionUnavailableReason,
  RunningSpeed,
  StopArrival,
  VehicleStateForPrediction,
} from './types.js';

/**
 * How old a fix may be before this service refuses to predict from it.
 *
 * DERIVED FROM THE NETWORK, not picked. At the measured median running speed of
 * the moving fleet (38.5 kmph, from 512 live rows on 2026-08-14) a bus covers
 * 6.4 km in ten minutes. The measured median gap between consecutive stops on
 * this network is 7.9 km. So at ten minutes of unobserved travel the
 * extrapolation is approaching a full inter-stop gap: past it, the service can
 * no longer be confident WHICH stop is next, let alone when the bus reaches it,
 * and every arrival in the list may be off by one stop rather than off by a few
 * minutes.
 *
 * Deliberately looser than mpc/safety.ts's DEFAULT_STATE_STALE_SECONDS (90 s).
 * That constant governs whether a controller may ISSUE A HOLD on a bus - an
 * action with consequences - and 90 s is right for it. This one governs whether
 * a driver is shown a countdown with its age and its uncertainty attached, which
 * is a weaker claim; measured against the live fleet, a 90 s bound would refuse
 * roughly three quarters of the vehicles that are otherwise perfectly
 * predictable. The two numbers differ because the two questions differ, and
 * neither is a typo for the other.
 */
export const MAX_STATE_AGE_SECONDS = 600;

/** Default number of upcoming stops returned. About an hour of an intercity working. */
export const DEFAULT_STOP_LIMIT = 8;
/** Hard cap. A whole 48-stop route is a timetable request, not a prediction request. */
export const MAX_STOP_LIMIT = 25;

/**
 * Default furthest-out arrival this service will put a time on.
 *
 * An hour. Beyond that, road conditions, crew breaks and dwell dominate a
 * current-speed extrapolation so completely that the arithmetic stops being a
 * prediction. Stops past it are still LISTED - with `beyond_prediction_horizon`
 * - so a driver sees the stop and knows why it has no time, rather than
 * wondering where it went.
 */
export const DEFAULT_HORIZON_SECONDS = 3_600;
/** Hard cap on a caller-supplied horizon. Two hours is already generous for a current-speed model. */
export const MAX_HORIZON_SECONDS = 7_200;

/** Confidence below which a number is withdrawn rather than shown. */
export const MIN_PUBLISHABLE_CONFIDENCE = 0.15;
/** At or above this, the arrival is worth planning against. */
export const FIRM_CONFIDENCE_THRESHOLD = 0.6;
/** At or above this, the arrival is worth glancing at with its band. */
export const USABLE_CONFIDENCE_THRESHOLD = 0.35;

/**
 * Time constant of the confidence decay with horizon.
 *
 * exp(-eta / 3600): about 0.85 at ten minutes out, 0.61 at half an hour, 0.37
 * at an hour. A distance/speed extrapolation genuinely does decay like this -
 * the further ahead, the more chances for the assumption to have broken.
 */
const CONFIDENCE_HORIZON_DECAY_SECONDS = 3_600;

/** How much less a peer-derived speed is trusted than the vehicle's own. */
const PEER_BASIS_CONFIDENCE_FACTOR = 0.6;

export interface PredictArrivalsInput {
  vehicleId: string;
  /** Server clock. Injected so tests are deterministic and so one response has one instant. */
  now: Date;
  /** False when there is no `vehicles` row at all - a bus this service has never heard of. */
  vehicleKnown: boolean;
  /** Null when the vehicle is known but has never been estimated. */
  state: VehicleStateForPrediction | null;
  geometry: PredictionRouteGeometry | null;
  /** Stops on the matched route-direction, any order; sorted here. */
  stops: readonly PredictionStop[];
  /** Candidate peers on the same route-direction, already filtered to fresh and confident. */
  peers: readonly PeerVehicleSpeed[];
  /** True when a controller hold is currently in force on this vehicle. */
  isHeldByController: boolean;
  horizonSeconds?: number;
  stopLimit?: number;
  dwellSeconds?: number;
}

export function predictArrivals(input: PredictArrivalsInput): ArrivalPredictionResponse {
  const horizonSeconds = clampInt(input.horizonSeconds ?? DEFAULT_HORIZON_SECONDS, 60, MAX_HORIZON_SECONDS);
  const stopLimit = clampInt(input.stopLimit ?? DEFAULT_STOP_LIMIT, 1, MAX_STOP_LIMIT);
  const generatedAt = input.now.toISOString();
  const envelope = buildEnvelope(input, horizonSeconds, stopLimit);
  return { vehicleId: input.vehicleId, generatedAt, horizonSeconds, stopLimit, prediction: envelope };
}

function buildEnvelope(
  input: PredictArrivalsInput,
  horizonSeconds: number,
  stopLimit: number,
): PredictionEnvelope {
  const { state } = input;

  if (!input.vehicleKnown) {
    return unavailable('vehicle_unknown', 'This vehicle is not registered with the control service.');
  }
  if (state === null) {
    return unavailable(
      'no_live_state',
      'No position has been processed for this vehicle yet, so there is nothing to predict from.',
    );
  }

  const observedAtMs = Date.parse(state.observedAt);
  if (Number.isNaN(observedAtMs)) {
    return unavailable(
      'unreadable_observation_time',
      'The last position for this vehicle carries a timestamp that cannot be read, so its age is unknown.',
      { routeDirectionId: state.routeDirectionId, observedAt: state.observedAt },
    );
  }

  const stateAgeSeconds = (input.now.getTime() - observedAtMs) / 1000;

  // Two-sided, for the same reason mpc/safety.ts is two-sided: a reading stamped
  // in the future has a NEGATIVE age, so a one-sided "too old" test can never
  // fire on it. The live table has carried observed_at = 2046-03-27. Under a
  // one-sided test that bus is fresh forever and would be given the most
  // confident countdown on the screen.
  if (stateAgeSeconds < -FUTURE_STATE_TOLERANCE_SECONDS) {
    return unavailable(
      'future_dated_state',
      'The last position for this vehicle is dated in the future, so its true age is unknown.',
      { routeDirectionId: state.routeDirectionId, observedAt: state.observedAt, stateAgeSeconds },
    );
  }

  if (stateAgeSeconds > MAX_STATE_AGE_SECONDS) {
    return unavailable(
      'stale_state',
      `The last position for this vehicle is ${Math.round(stateAgeSeconds / 60)} minutes old, which is too long to project forward from.`,
      { routeDirectionId: state.routeDirectionId, observedAt: state.observedAt, stateAgeSeconds },
    );
  }

  if (state.position !== null && !isPositionOnServedNetwork(state.position.lat, state.position.lon)) {
    return unavailable(
      'implausible_position',
      'The last position for this vehicle is not a location on the network this service covers.',
      { routeDirectionId: state.routeDirectionId, observedAt: state.observedAt, stateAgeSeconds },
    );
  }

  if (input.isHeldByController || state.stopState === 'held_by_controller') {
    return unavailable(
      'held_by_controller',
      'This vehicle is being held. When it departs is the controller’s decision, so no arrival time is predicted until the hold clears.',
      { routeDirectionId: state.routeDirectionId, observedAt: state.observedAt, stateAgeSeconds },
    );
  }

  if (
    state.routeDirectionId === null ||
    state.distanceAlongRouteMeters === null ||
    !Number.isFinite(state.distanceAlongRouteMeters) ||
    state.stopState === 'off_route'
  ) {
    return unavailable(
      'off_route',
      'This vehicle could not be matched to a route, so there is no distance to any stop to measure.',
      { routeDirectionId: state.routeDirectionId, observedAt: state.observedAt, stateAgeSeconds },
    );
  }

  // The estimator already refuses to put a flagged vehicle in the leader/follower
  // chain (state-estimation/ordering.ts). An ETA measured from that same position
  // would be trusting it more than the subsystem that produced it does.
  const matchConfidence = state.confidence ?? 0;
  if (state.isLowConfidence || matchConfidence < LOW_CONFIDENCE_THRESHOLD) {
    return unavailable(
      'low_match_confidence',
      'This vehicle’s position could not be matched to its route with enough certainty to measure a distance from.',
      { routeDirectionId: state.routeDirectionId, observedAt: state.observedAt, stateAgeSeconds },
    );
  }

  if (input.geometry === null || !(input.geometry.totalDistanceMeters > 0)) {
    return unavailable(
      'no_route_geometry',
      'The route this vehicle is on has no surveyed shape, so stop distances cannot be measured.',
      { routeDirectionId: state.routeDirectionId, observedAt: state.observedAt, stateAgeSeconds },
    );
  }

  const downstream = orderDownstreamStops(
    input.stops,
    state.distanceAlongRouteMeters,
    input.geometry,
    excludedCurrentStopId(state),
  );
  if (downstream.length === 0) {
    return unavailable(
      'no_stops_ahead',
      'There are no further stops ahead of this vehicle on its current route.',
      { routeDirectionId: state.routeDirectionId, observedAt: state.observedAt, stateAgeSeconds },
    );
  }

  const speed = resolveRunningSpeed({
    state,
    peers: input.peers,
    stateAgeSeconds,
    maxStateAgeSeconds: MAX_STATE_AGE_SECONDS,
  });
  if (speed === null) {
    return unavailable(
      'no_speed_basis',
      'Neither this vehicle nor any other on this stretch of route is reporting a usable travelling speed right now, so no arrival time can be measured.',
      { routeDirectionId: state.routeDirectionId, observedAt: state.observedAt, stateAgeSeconds },
    );
  }

  const dwellSeconds = input.dwellSeconds ?? DEFAULT_DWELL_SECONDS;
  const currentStopDwell = computeCurrentStopDwell({
    stopState: state.stopState,
    stopEnteredAt: state.stopEnteredAt,
    observedAtMs,
    dwellSeconds,
  });

  const arrivals = downstream.slice(0, stopLimit).map((stop, index) =>
    buildStopArrival({
      stop,
      intermediateStopCount: index,
      speed,
      dwellSeconds,
      currentStopDwellSeconds: currentStopDwell.remainingSeconds,
      stateAgeSeconds,
      matchConfidence,
      horizonSeconds,
      nowMs: input.now.getTime(),
    }),
  );

  return {
    status: 'available',
    routeDirectionId: state.routeDirectionId,
    observedAt: state.observedAt,
    stateAgeSeconds: round(stateAgeSeconds, 1),
    vehicle: {
      distanceAlongRouteMeters: round(state.distanceAlongRouteMeters, 1),
      matchConfidence: round(matchConfidence, 3),
      stopState: state.stopState,
      currentStopId: state.currentStopId,
    },
    speed: { ...speed, speedKmph: round(speed.speedKmph, 1), relativeSpread: round(speed.relativeSpread, 3) },
    dwell: describeDwellModel(
      { basis: currentStopDwell.basis, remainingSeconds: round(currentStopDwell.remainingSeconds, 0) },
      dwellSeconds,
    ),
    arrivals,
  };

  function unavailable(
    reason: PredictionUnavailableReason,
    detail: string,
    extra: { routeDirectionId?: string | null; observedAt?: string | null; stateAgeSeconds?: number } = {},
  ): PredictionEnvelope {
    return {
      status: 'unavailable',
      reason,
      detail,
      routeDirectionId: extra.routeDirectionId ?? null,
      observedAt: extra.observedAt ?? null,
      stateAgeSeconds: extra.stateAgeSeconds === undefined ? null : round(extra.stateAgeSeconds, 1),
      arrivals: [],
    };
  }
}

/**
 * The stop the vehicle has already reached, which must not appear as an arrival.
 *
 * `approaching_stop` is deliberately NOT excluded: there the current stop is the
 * next one, and it is exactly the arrival a driver most wants. `dwelling_at_stop`
 * and `departed_stop` mean the vehicle is at or past it - and its geofenced
 * position can sit a few metres SHORT of the stop's surveyed cumulative
 * distance, which would otherwise make the stop it is standing at look like a
 * five-second arrival.
 */
function excludedCurrentStopId(state: VehicleStateForPrediction): string | null {
  if (state.stopState === 'dwelling_at_stop' || state.stopState === 'departed_stop') {
    return state.currentStopId;
  }
  return null;
}

interface DownstreamStop extends PredictionStop {
  forwardDistanceMeters: number;
}

/**
 * Stops ahead of the vehicle, nearest first.
 *
 * On a loop route-direction "ahead" wraps: a stop behind the vehicle in raw
 * cumulative distance is ahead of it on the next lap, so forward distance is
 * taken modulo the shape length. Only one route-direction on this network is a
 * loop today, which is precisely why the case has to be handled here rather than
 * discovered later.
 */
export function orderDownstreamStops(
  stops: readonly PredictionStop[],
  distanceAlongRouteMeters: number,
  geometry: PredictionRouteGeometry,
  excludeStopId: string | null,
): DownstreamStop[] {
  const total = geometry.totalDistanceMeters;
  const result: DownstreamStop[] = [];

  for (const stop of stops) {
    if (stop.stopId === excludeStopId) continue;
    if (!Number.isFinite(stop.cumulativeDistanceMeters)) continue;

    let forward = stop.cumulativeDistanceMeters - distanceAlongRouteMeters;
    if (geometry.isLoop && total > 0) {
      forward = ((forward % total) + total) % total;
    }
    if (forward <= 0) continue;
    result.push({ ...stop, forwardDistanceMeters: forward });
  }

  // Distance first, then sequence: two stops surveyed at the same cumulative
  // distance (a shared interchange kerb) must still come out in timetable order.
  result.sort((a, b) =>
    a.forwardDistanceMeters === b.forwardDistanceMeters
      ? a.sequence - b.sequence
      : a.forwardDistanceMeters - b.forwardDistanceMeters,
  );
  return result;
}

interface StopArrivalInput {
  stop: DownstreamStop;
  intermediateStopCount: number;
  speed: RunningSpeed;
  dwellSeconds: number;
  currentStopDwellSeconds: number;
  stateAgeSeconds: number;
  matchConfidence: number;
  horizonSeconds: number;
  nowMs: number;
}

function buildStopArrival(input: StopArrivalInput): StopArrival {
  const base = {
    stopId: input.stop.stopId,
    stopName: input.stop.stopName,
    sequence: input.stop.sequence,
    isControlPoint: input.stop.isControlPoint,
    distanceRemainingMeters: round(input.stop.forwardDistanceMeters, 1),
    intermediateStopCount: input.intermediateStopCount,
  };

  const centralSpeedMps = input.speed.speedKmph / 3.6;
  // The band's speeds, not the central one. `speedKmph` is already inside the
  // plausible running band, and the spread is capped below 1, so both stay
  // strictly positive - but the floor is kept explicit so a future change to
  // either constant cannot silently reintroduce a division by zero.
  const fastKmph = Math.max(MIN_RUNNING_SPEED_KMPH, input.speed.speedKmph * (1 + input.speed.relativeSpread));
  const slowKmph = Math.max(MIN_RUNNING_SPEED_KMPH, input.speed.speedKmph * (1 - input.speed.relativeSpread));

  const travelSeconds = input.stop.forwardDistanceMeters / centralSpeedMps;
  const dwellTotalSeconds = input.dwellSeconds * input.intermediateStopCount;
  const modelledSeconds = input.currentStopDwellSeconds + travelSeconds + dwellTotalSeconds;
  const etaSecondsRaw = modelledSeconds - input.stateAgeSeconds;

  if (etaSecondsRaw <= 0) {
    return { ...base, status: 'unavailable', reason: 'due_or_passed' };
  }

  const confidence = computeArrivalConfidence({
    matchConfidence: input.matchConfidence,
    stateAgeSeconds: input.stateAgeSeconds,
    basis: input.speed.basis,
    etaSeconds: etaSecondsRaw,
  });

  if (etaSecondsRaw > input.horizonSeconds) {
    return { ...base, status: 'unavailable', reason: 'beyond_prediction_horizon' };
  }
  if (confidence < MIN_PUBLISHABLE_CONFIDENCE) {
    return { ...base, status: 'unavailable', reason: 'confidence_below_floor' };
  }

  const dwellSlack = DWELL_UNCERTAINTY_FRACTION;
  const lowerRaw =
    input.currentStopDwellSeconds * (1 - dwellSlack) +
    input.stop.forwardDistanceMeters / (fastKmph / 3.6) +
    dwellTotalSeconds * (1 - dwellSlack) -
    input.stateAgeSeconds;
  const upperRaw =
    input.currentStopDwellSeconds * (1 + dwellSlack) +
    input.stop.forwardDistanceMeters / (slowKmph / 3.6) +
    dwellTotalSeconds * (1 + dwellSlack) -
    input.stateAgeSeconds;

  // Rounding directions are load-bearing, not cosmetic: floor the lower bound
  // and ceil the upper one so `lower <= eta <= upper` survives the trip to
  // integer seconds. A consumer rendering "4-9 min" must never be handed a
  // range that excludes the point estimate it renders beside it.
  const etaSeconds = Math.round(etaSecondsRaw);
  const lowerBoundSeconds = Math.min(etaSeconds, Math.max(0, Math.floor(lowerRaw)));
  const upperBoundSeconds = Math.max(etaSeconds, Math.ceil(upperRaw));

  return {
    ...base,
    status: 'predicted',
    etaSeconds,
    etaAt: new Date(input.nowMs + etaSeconds * 1000).toISOString(),
    lowerBoundSeconds,
    upperBoundSeconds,
    confidence: round(confidence, 3),
    confidenceBand: bandFor(confidence),
    components: {
      travelSeconds: Math.round(travelSeconds),
      dwellSeconds: Math.round(dwellTotalSeconds),
      currentStopDwellSeconds: Math.round(input.currentStopDwellSeconds),
      stateAgeSeconds: Math.round(input.stateAgeSeconds),
    },
  };
}

export interface ArrivalConfidenceInput {
  matchConfidence: number;
  stateAgeSeconds: number;
  basis: RunningSpeed['basis'];
  etaSeconds: number;
}

/**
 * Confidence as the product of four independent things that can each be wrong.
 *
 * A product, not an average: these are not competing opinions to be balanced,
 * they are consecutive links, and a prediction is no better than its weakest.
 * A perfectly fresh fix on a perfectly matched bus is still a poor prediction
 * an hour out, and an averaging rule would hide that behind three good scores.
 *
 *   match      the estimator's own trust that this bus is on this route
 *   freshness  how much of the staleness budget the fix has already spent
 *   basis      whether the speed is this bus's or a neighbour's
 *   horizon    how far ahead the extrapolation is being asked to reach
 */
export function computeArrivalConfidence(input: ArrivalConfidenceInput): number {
  const match = clamp01(input.matchConfidence);
  const freshness = clamp01(1 - Math.max(0, input.stateAgeSeconds) / MAX_STATE_AGE_SECONDS);
  const basis = input.basis === 'vehicle_smoothed_speed' ? 1 : PEER_BASIS_CONFIDENCE_FACTOR;
  const horizon = Math.exp(-Math.max(0, input.etaSeconds) / CONFIDENCE_HORIZON_DECAY_SECONDS);
  return clamp01(match * freshness * basis * horizon);
}

export function bandFor(confidence: number): ConfidenceBand {
  if (confidence >= FIRM_CONFIDENCE_THRESHOLD) return 'firm';
  if (confidence >= USABLE_CONFIDENCE_THRESHOLD) return 'usable';
  return 'rough';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
