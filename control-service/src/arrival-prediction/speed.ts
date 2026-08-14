// Resolving a MEASURED running speed for one vehicle, or declining to.
//
// ─── WHY THIS IS THE HARD PART ───────────────────────────────────────────
//
// The obvious model is "remaining distance divided by current speed". Against
// this fleet that model is mostly a division by zero. Measured on the live
// control database (2026-08-14, 2,409 map-matched `vehicle_states` rows):
//
//     speed_kmph in [0, 10)      1,532 rows   64%
//     speed_kmph < 0               388 rows   16%   (Kalman velocity, min -82.7)
//     speed_kmph in [5, 100]       445 rows   18%
//     median speed_kmph             0.00
//
// `vehicle_states.speed_kmph` is the Kalman-smoothed velocity, and it is
// legitimately near zero or negative for a bus that is dwelling, stopped in
// traffic, or whose filter has not converged after a direction change. Dividing
// by it yields an ETA of hours or a negative one. So the running speed has to
// come from somewhere else for most of the fleet, and the only honest
// somewhere-else is other buses that are actually moving.
//
// ─── WHY PEERS ARE WINDOWED, AND WHAT THAT COSTS ─────────────────────────
//
// Peers are restricted to vehicles within PEER_WINDOW_METERS of the subject
// ALONG THE SAME ROUTE-DIRECTION. These are intercity corridors: median length
// 115 km, p90 321 km, max 842 km. A peer 80 km away is on a different road,
// in different traffic, possibly in different terrain, and its speed is not
// evidence about this bus's next stop.
//
// The window costs real coverage, and the cost was measured rather than
// guessed. Of 1,024 fresh, confident, map-matched vehicles in one live 10-minute
// window:
//
//     own speed usable                             409   40%
//     + rescued by peers within 15 km               98   10%   -> 507 total, 50%
//     ( + rescued by peers anywhere on corridor    226   22% )
//     no speed basis at all                        389   38%
//
// So dropping the window would raise coverage from 50% to 62%. That trade is
// refused: 128 extra vehicles would get a number that LOOKS like a measurement
// of their own road conditions and is not. Declining is the cheaper mistake -
// a driver who is told nothing goes and looks, while a driver who is told four
// minutes waits.

import type { PeerVehicleSpeed, RunningSpeed, VehicleStateForPrediction } from './types.js';

/**
 * Slowest speed that counts as "running".
 *
 * Below this the vehicle is not making progress in a way that projects forward:
 * it is at a stop, in a queue, or the filter is still settling. Charging 3 kmph
 * across a 22 km inter-stop gap would produce a seven-hour ETA and present it
 * as a measurement.
 */
export const MIN_RUNNING_SPEED_KMPH = 5;

/**
 * Fastest speed that counts as a plausible reading.
 *
 * The live table contains smoothed speeds up to 116 kmph, which is not a bus on
 * a UP state highway - it is filter overshoot after a position jump. Capping
 * rather than clamping: a reading above this is rejected as a speed basis
 * outright, not quietly pulled down to 90, because the reading is evidence that
 * the filter is wrong about this vehicle rather than evidence that it is fast.
 */
export const MAX_RUNNING_SPEED_KMPH = 90;

/**
 * Half-window, in metres along the route, that a peer must be inside.
 *
 * 15 km against a median inter-stop spacing of 7.9 km means a peer is at most
 * about two stops away - the same stretch of road, plausibly the same traffic.
 */
export const PEER_WINDOW_METERS = 15_000;

/**
 * Fewest peers that can constitute a measurement.
 *
 * One peer is a sample of one: that bus might be the one stuck behind a level
 * crossing. Two is still weak, and the resulting spread says so, but it is the
 * minimum at which more than one vehicle agrees.
 */
export const MIN_PEER_SAMPLES = 2;

/** Spread used when the vehicle's own smoothed speed is the basis and its filter covariance is unknown. */
const OWN_SPEED_BASE_SPREAD = 0.25;

/**
 * Spread used when peers are the basis.
 *
 * Wider than own-speed on purpose: a peer median answers "how fast is traffic
 * moving on this stretch", which is a proxy for "how fast is THIS bus about to
 * move", not the same question.
 */
const PEER_SPEED_BASE_SPREAD = 0.4;

/**
 * Ceiling on the fractional spread.
 *
 * Past this the bounds stop being informative - a +/-75% band on a 10-minute
 * ETA already spans 6 to 40 minutes. A vehicle whose uncertainty would exceed
 * it is not made more honest by a wider band; it is handled by the confidence
 * floor, which withdraws the number entirely.
 */
const MAX_RELATIVE_SPREAD = 0.75;

/** Floor on the spread. Nothing about this data justifies claiming better than +/-15%. */
const MIN_RELATIVE_SPREAD = 0.15;

export function isPlausibleRunningSpeedKmph(speedKmph: number | null): speedKmph is number {
  if (speedKmph === null || !Number.isFinite(speedKmph)) return false;
  return speedKmph >= MIN_RUNNING_SPEED_KMPH && speedKmph <= MAX_RUNNING_SPEED_KMPH;
}

/** Median of a non-empty list. Median, not mean: one stuck peer must not drag the estimate. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export interface RunningSpeedContext {
  state: VehicleStateForPrediction;
  /** Peers already filtered to the same route-direction, fresh, and not low-confidence. */
  peers: readonly PeerVehicleSpeed[];
  /**
   * Age of `state.observedAt` in seconds. Widens the spread: an older fix says
   * less about the speed the vehicle is doing NOW, which is what the answer is
   * expressed against.
   */
  stateAgeSeconds: number;
  /** MAX_STATE_AGE_SECONDS, passed in so the widening is expressed as a fraction of the refusal boundary. */
  maxStateAgeSeconds: number;
}

/**
 * The measured running speed to project this vehicle forward with, or null when
 * there is no measurement to be had.
 *
 * Null is a real answer and the caller must surface it as `no_speed_basis`. The
 * tempting alternative - a configured network-average speed - would put a
 * number on 38% more of the fleet and make every one of those numbers
 * indistinguishable, on the wire, from one measured off a moving bus.
 */
export function resolveRunningSpeed(ctx: RunningSpeedContext): RunningSpeed | null {
  const ageFactor = 1 + Math.max(0, ctx.stateAgeSeconds) / Math.max(1, ctx.maxStateAgeSeconds);

  const ownSpeed = ctx.state.speedKmph;
  if (isPlausibleRunningSpeedKmph(ownSpeed)) {
    return {
      basis: 'vehicle_smoothed_speed',
      speedKmph: ownSpeed,
      sampleCount: 1,
      relativeSpread: clampSpread(ownSpeedSpread(ctx.state, ownSpeed) * ageFactor),
      peerWindowMeters: null,
    };
  }

  const subjectDistance = ctx.state.distanceAlongRouteMeters;
  if (subjectDistance === null || !Number.isFinite(subjectDistance)) return null;

  const usable = ctx.peers
    .filter(
      (peer) =>
        peer.vehicleId !== ctx.state.vehicleId &&
        Number.isFinite(peer.distanceAlongRouteMeters) &&
        Math.abs(peer.distanceAlongRouteMeters - subjectDistance) <= PEER_WINDOW_METERS &&
        isPlausibleRunningSpeedKmph(peer.speedKmph),
    )
    .map((peer) => peer.speedKmph);

  if (usable.length < MIN_PEER_SAMPLES) return null;

  const speedKmph = median(usable);
  return {
    basis: 'route_peer_median_speed',
    speedKmph,
    sampleCount: usable.length,
    relativeSpread: clampSpread((PEER_SPEED_BASE_SPREAD + peerDispersion(usable, speedKmph)) * ageFactor),
    peerWindowMeters: PEER_WINDOW_METERS,
  };
}

/**
 * Spread implied by the Kalman velocity variance, when the persisted filter
 * state carries one.
 *
 * This is the principled source and it degrades in exactly the right direction:
 * a freshly initialised filter carries INITIAL_VELOCITY_VARIANCE = 100 (m/s)^2,
 * i.e. a 10 m/s (36 kmph) standard deviation, so a cold-started vehicle
 * honestly reports a very wide band instead of borrowing the confidence of a
 * warm one. A converged filter reports a narrow one.
 */
function ownSpeedSpread(state: VehicleStateForPrediction, speedKmph: number): number {
  const variance = state.velocityVarianceMeters2PerSecond2;
  if (variance === null || !Number.isFinite(variance) || variance < 0) return OWN_SPEED_BASE_SPREAD;
  const speedMetersPerSecond = speedKmph / 3.6;
  if (speedMetersPerSecond <= 0) return OWN_SPEED_BASE_SPREAD;
  // 1.96 sigma - the same two-sided 95% interval the rest of the industry means
  // by "the speed is somewhere around here".
  return (1.96 * Math.sqrt(variance)) / speedMetersPerSecond;
}

/**
 * Extra spread from how much the peers disagree with each other.
 *
 * Two peers doing 20 and 60 kmph are not a measurement of 40 kmph; they are two
 * measurements of a stretch of road where the answer depends on where you are.
 * Reported as a widened band rather than hidden behind the median.
 */
function peerDispersion(samples: readonly number[], medianKmph: number): number {
  if (samples.length < 2 || medianKmph <= 0) return 0;
  const absoluteDeviations = samples.map((s) => Math.abs(s - medianKmph));
  return median(absoluteDeviations) / medianKmph;
}

function clampSpread(spread: number): number {
  if (!Number.isFinite(spread)) return MAX_RELATIVE_SPREAD;
  return Math.min(MAX_RELATIVE_SPREAD, Math.max(MIN_RELATIVE_SPREAD, spread));
}
