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
//   hBwdSeconds = the SAME quantity one link further back down the chain:
//                 the time the follower's OWN follower would take to reach
//                 the follower's current position. Blueprint 7.1 defines it
//                 as "predicted time for the follower to reach bus i's
//                 current route position", and every row here is scored,
//                 held and commanded against its `followerVehicleId`
//                 (mpc/twoWayHold.ts), so bus i IS the follower and the bus
//                 behind it is the third vehicle in the chain. Null when
//                 there is no such vehicle - the back-most bus on a linear
//                 route has nothing behind it, which is a real absence and
//                 not a zero.
//
// ─── WHY hBwd IS NOT gapMeters / leader's speed ──────────────────────────
//
// It used to be, and that is a different quantity entirely: the same
// leader->follower gap, divided by the other vehicle's pace. It never
// observed the bus behind. Substituted into the two-way law
//
//   hold = Kf x (H* - h_fwd) - Kb x (H* - h_bwd)
//
// two buses travelling at similar speeds give h_fwd ~= h_bwd, and the law
// collapses to (Kf - Kb) x (H* - h_fwd) - a forward-only proportional
// controller at a fraction of the intended gain, which is exactly the
// design defect blueprint 12.4 lists as "Forward-only control creates
// downstream holding cascades". Worse, the residual backward term was then
// driven by the speed DIFFERENTIAL between those same two buses, so a
// follower running slower than its leader grew the backward term and
// cancelled its own hold precisely as the pair closed up.
//
// The correct value needs no new data. It is already in the adjacent row
// of the same leader/follower chain, which is why this is computed here
// (where the whole chain is in hand) rather than by having the control law
// hunt for a sibling row.
// A stationary/near-stationary vehicle (speed at or below MIN_SPEED_KMPH)
// is floored to MIN_SPEED_KMPH rather than producing a division-by-zero or
// an unbounded headway, and every computed headway is capped at
// MAX_HEADWAY_SECONDS so a genuinely stalled vehicle reports a large-but-
// finite, JSON-safe number instead of Infinity.

import { computeDispersion } from "../lib/dispersion.js";
import type { HeadwayDispersion } from "../lib/dispersion.js";
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

    const followerSpeedMps = toSpeedMetersPerSecond(speedByVehicleId.get(follower.vehicleId) ?? null);
    const hFwdSeconds = followerSpeedMps == null ? null : clampHeadwaySeconds(gapMeters / followerSpeedMps);

    // Backward headway of the FOLLOWER - the vehicle this row's candidate
    // would be issued to - measured one link further back: the gap from the
    // follower to the bus behind it, closed at that bus's own pace. Same
    // shape as hFwd, one position down the chain. `trailer` is absent for
    // the back-most vehicle on a linear route-direction (on a loop the wrap
    // link in state-estimation/ordering.ts always supplies one), and a
    // null here is the documented trigger for mpc/selfEqualizing.ts to take
    // the pair instead of mpc/twoWayHold.ts.
    const trailer = follower.followerVehicleId ? byId.get(follower.followerVehicleId) : undefined;
    const trailerSpeedMps =
      trailer == null ? null : toSpeedMetersPerSecond(speedByVehicleId.get(trailer.vehicleId) ?? null);
    const backGapMeters =
      trailer == null
        ? null
        : computeGapMeters(
            follower.distanceAlongRouteMeters,
            trailer.distanceAlongRouteMeters,
            routeDirection.totalDistanceMeters
          );
    const hBwdSeconds =
      backGapMeters == null || trailerSpeedMps == null
        ? null
        : clampHeadwaySeconds(backGapMeters / trailerSpeedMps);

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
 * (blueprint 7.1/7.2).
 *
 * The arithmetic itself lives in `lib/dispersion.ts` and is re-exported here
 * unchanged, so this module's public surface is what it always was. It moved
 * because `simulation/kpi.ts` needs the identical formula and may not import
 * `../headway/*` - see that file's header for what a second copy of it was
 * costing.
 */
export { computeDispersion };
export type { HeadwayDispersion };

export function computeAggregate(
  pairs: readonly HeadwayPairMetric[],
  routeDirectionId: string,
  targetHeadwaySeconds: number
): HeadwayAggregate {
  const values = pairs
    .map((p) => p.hFwdSeconds)
    .filter((v): v is number => v != null);

  return {
    routeDirectionId,
    ...computeDispersion(values, targetHeadwaySeconds),
    targetHeadwaySeconds,
  };
}
