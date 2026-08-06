// Pure time-domain headway/EWT/CV computation (blueprint 7.1). No I/O - the
// orchestration layer (./service.ts) supplies live ordering/speed and
// persists the result.
//
// Definitions used here (documented since the source schema has no
// per-stop actual-arrival event log yet to derive headway from crossing
// timestamps directly - see control-service/README.md and
// db/migrations/20260805190000__core_data_model.sql "vehicle_states ...
// current-state table, not a time series"):
//   gapMeters   = distance-along-route between a leader and its follower,
//                 measured along the direction of travel and wrapping at
//                 totalDistanceMeters for a loop route-direction.
//   hFwdSeconds = gapMeters / follower's current speed - the time the
//                 follower would take to reach the leader's current
//                 position if it held its current pace. This is the
//                 "closing" headway a reactive rule watches for bunching.
//   hBwdSeconds = gapMeters / leader's current speed - symmetric backward
//                 headway, using the leader's own pace instead.
// A stationary/near-stationary vehicle (speed at or below MIN_SPEED_KMPH)
// is floored to MIN_SPEED_KMPH rather than producing a division-by-zero or
// an unbounded headway, and every computed headway is capped at
// MAX_HEADWAY_SECONDS so a genuinely stalled vehicle reports a large-but-
// finite, JSON-safe number instead of Infinity.

import type { OrderedVehicle } from "../state-estimation/types.js";
import type { HeadwayAggregate, HeadwayPairMetric } from "./types.js";

export const MIN_SPEED_KMPH = 1;
export const MAX_HEADWAY_SECONDS = 24 * 60 * 60;

function toSpeedMetersPerSecond(speedKmph: number | null): number | null {
  if (speedKmph == null || Number.isNaN(speedKmph)) return null;
  return Math.max(speedKmph, MIN_SPEED_KMPH) / 3.6;
}

function clampHeadwaySeconds(seconds: number): number {
  return Math.min(Math.max(seconds, 0), MAX_HEADWAY_SECONDS);
}

/**
 * Distance-along-route gap from `leaderDistanceMeters` forward to
 * `followerDistanceMeters`, in the direction of travel. On a linear
 * route-direction the leader always has the larger raw distance; on a loop
 * the wrap pair has the follower's raw distance ahead of the leader's, which
 * is exactly the signal used here to fold the wrap in without a special case
 * at the call site.
 */
export function computeGapMeters(
  leaderDistanceMeters: number,
  followerDistanceMeters: number,
  totalDistanceMeters: number
): number {
  if (followerDistanceMeters <= leaderDistanceMeters) {
    return leaderDistanceMeters - followerDistanceMeters;
  }
  return Math.max(0, totalDistanceMeters - (followerDistanceMeters - leaderDistanceMeters));
}

export interface SpeedLookup {
  get(vehicleId: string): number | null | undefined;
}

export interface ConfidenceLookup {
  get(vehicleId: string): number | null | undefined;
}

/**
 * One HeadwayPairMetric per leader/follower link in `ordered` (state-
 * estimation's ordering.ts already computed the links, including the loop
 * wrap-around and the exclusion of low-confidence vehicles via rank -1).
 */
export function computePairHeadways(
  ordered: readonly OrderedVehicle[],
  speedByVehicleId: SpeedLookup,
  confidenceByVehicleId: ConfidenceLookup,
  routeDirection: { totalDistanceMeters: number },
  routeDirectionId: string,
  targetHeadwaySeconds: number
): HeadwayPairMetric[] {
  const byId = new Map(ordered.map((v) => [v.vehicleId, v]));
  const pairs: HeadwayPairMetric[] = [];

  for (const leader of ordered) {
    if (leader.rank < 0 || !leader.followerVehicleId) continue;
    const follower = byId.get(leader.followerVehicleId);
    if (!follower) continue;

    const gapMeters = computeGapMeters(
      leader.distanceAlongRouteMeters,
      follower.distanceAlongRouteMeters,
      routeDirection.totalDistanceMeters
    );

    const leaderSpeedMps = toSpeedMetersPerSecond(speedByVehicleId.get(leader.vehicleId) ?? null);
    const followerSpeedMps = toSpeedMetersPerSecond(speedByVehicleId.get(follower.vehicleId) ?? null);

    const hFwdSeconds = followerSpeedMps == null ? null : clampHeadwaySeconds(gapMeters / followerSpeedMps);
    const hBwdSeconds = leaderSpeedMps == null ? null : clampHeadwaySeconds(gapMeters / leaderSpeedMps);
    const deviationSeconds = hFwdSeconds == null ? null : hFwdSeconds - targetHeadwaySeconds;

    const leaderConfidence = confidenceByVehicleId.get(leader.vehicleId) ?? null;
    const followerConfidence = confidenceByVehicleId.get(follower.vehicleId) ?? null;
    const confidence =
      leaderConfidence == null || followerConfidence == null
        ? null
        : Math.min(leaderConfidence, followerConfidence);

    pairs.push({
      routeDirectionId,
      leaderVehicleId: leader.vehicleId,
      followerVehicleId: follower.vehicleId,
      gapMeters,
      hFwdSeconds,
      hBwdSeconds,
      targetHeadwaySeconds,
      deviationSeconds,
      confidence,
    });
  }

  return pairs;
}

/**
 * Route-direction-wide CV and EWT from one snapshot of forward headways
 * (blueprint 7.1/7.2). EWT follows the standard "actual wait minus
 * scheduled wait" methodology (e.g. TfL's Excess Wait Time KPI):
 * actual mean wait for a Poisson-ish arriving passenger is
 * E[h^2] / (2*E[h]) = (variance + mean^2) / (2*mean); scheduled wait is
 * targetHeadwaySeconds / 2. EWT is the (non-negative) difference.
 */
export function computeAggregate(
  pairs: readonly HeadwayPairMetric[],
  routeDirectionId: string,
  targetHeadwaySeconds: number
): HeadwayAggregate {
  const values = pairs
    .map((p) => p.hFwdSeconds)
    .filter((v): v is number => v != null);

  const sampleCount = values.length;
  if (sampleCount === 0) {
    return {
      routeDirectionId,
      sampleCount: 0,
      meanHeadwaySeconds: null,
      stddevHeadwaySeconds: null,
      cv: null,
      ewtSeconds: null,
      targetHeadwaySeconds,
    };
  }

  const mean = values.reduce((sum, v) => sum + v, 0) / sampleCount;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / sampleCount;
  const stddev = Math.sqrt(variance);
  const cv = mean > 0 ? stddev / mean : null;

  const scheduledWaitSeconds = targetHeadwaySeconds / 2;
  const actualMeanWaitSeconds = mean > 0 ? (variance + mean * mean) / (2 * mean) : 0;
  const ewtSeconds = Math.max(0, actualMeanWaitSeconds - scheduledWaitSeconds);

  return {
    routeDirectionId,
    sampleCount,
    meanHeadwaySeconds: mean,
    stddevHeadwaySeconds: stddev,
    cv,
    ewtSeconds,
    targetHeadwaySeconds,
  };
}
