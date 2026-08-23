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
// ─── WHY A STATIONARY BUS IS NOT MEASURED AT ITS OWN SPEED ───────────────
//
// h_fwd converts a gap in METRES into a gap in SECONDS, and the divisor has
// to be the pace at which the follower will actually cover that gap. Its
// INSTANTANEOUS speed is a poor estimator of that pace and is catastrophically
// poor in one specific state: standing at a stop.
//
// That state is not an edge case, it is the only state in which anything can
// be done about a bunch. `mpc/eligibility.ts` will only propose a hold to a
// bus that is `dwelling_at_stop` or `approaching_stop`, because a hold is
// executed by standing still somewhere passengers can board. So the deployed
// system asks "how bunched is this pair?" at precisely the moment its own
// estimator is least able to answer.
//
// MEASURED, on one pair 4 km apart on a corridor whose nominal gap is 30 km -
// the same two buses, the same instant, three different reported speeds:
//
//   follower at 60 km/h   h_fwd    240 s   ratio 0.13   BUNCHED, hold 600 s
//   follower at 12 km/h   h_fwd  1,200 s   ratio 0.67   "fine",  hold 252 s
//   follower at  0 km/h   h_fwd 14,400 s   ratio 8.00   "fine",  no candidate
//
// Flooring at MIN_SPEED_KMPH = 1 is what produces the third line, and the
// third line is the one production is in. Across a 1,000-bus trial, moving
// from the engine's link-average pace to the speed `vehicle_states` actually
// carries collapsed two-way holding from 2,373 generated candidates to 122 -
// 95% of the control law - and cut the excess-wait improvement from 44% to
// 10%. This is the same arithmetic that made Algorithm A incapable of ever
// firing (see mpc/terminalDispatch.ts and test/terminalDispatch.test.ts); that
// law was given a measured departure headway instead, and the mid-route laws
// and the bunching detector were left on the broken divisor.
//
// THE FIX. A bus standing at a stop is about to resume at roughly the pace the
// corridor is running at, so that is the divisor - `corridorPaceKmph` below,
// the MEDIAN speed of the vehicles on this corridor that are actually moving.
// It is a measurement, not an assumption, it needs no new schema and no new
// query, and it degrades honestly: when NOTHING on the corridor is moving
// there is no pace to borrow and the headway is null - "no opinion" - rather
// than a fabricated number. A vehicle that is genuinely under way keeps its
// own speed and is completely unaffected.
//
// Every computed headway is still capped at MAX_HEADWAY_SECONDS so a genuinely
// stalled corridor reports a large-but-finite, JSON-safe number, never Infinity.

import { computeDispersion } from "../lib/dispersion.js";
import type { HeadwayDispersion } from "../lib/dispersion.js";
import type { OrderedVehicle } from "../state-estimation/types.js";
import type { HeadwayAggregate, HeadwayPairMetric } from "./types.js";

export const MIN_SPEED_KMPH = 1;
export const MAX_HEADWAY_SECONDS = 24 * 60 * 60;

/**
 * At or below this a vehicle is not making progress along the route.
 *
 * 5 km/h is below the slowest pace at which a bus is meaningfully under way
 * and above the noise a GPS fix puts on a stationary vehicle. It covers all
 * three ways a bus stands still - dwelling at a stop, waiting at a signal,
 * held in a queue - without needing to know which one it is in, because for
 * this arithmetic they are the same: the gap ahead is not being closed at the
 * speed currently being reported.
 */
export const STATIONARY_SPEED_KMPH = 5;

/**
 * The pace this corridor is running at right now: the median speed of the
 * vehicles on it that are actually moving, or null when none of them is.
 *
 * MEDIAN rather than mean, because on a short chain one bus pulling out of a
 * stop at 6 km/h would drag a mean down far enough to matter, and the median
 * of a handful of moving buses is exactly the robust summary wanted here.
 *
 * Low-confidence vehicles are already excluded from `ordered` by
 * state-estimation/ordering.ts (rank -1), and are skipped here too so a
 * position nobody vouches for cannot set the pace every other pair is
 * measured against.
 */
function corridorPaceKmph(
  ordered: readonly OrderedVehicle[],
  speedByVehicleId: SpeedLookup,
): number | null {
  const moving: number[] = [];
  for (const vehicle of ordered) {
    if (vehicle.rank < 0) continue;
    const speed = speedByVehicleId.get(vehicle.vehicleId);
    if (speed == null || Number.isNaN(speed)) continue;
    if (speed < STATIONARY_SPEED_KMPH) continue;
    moving.push(speed);
  }
  if (moving.length === 0) return null;
  moving.sort((a, b) => a - b);
  const middle = moving.length >> 1;
  return moving.length % 2 === 1
    ? moving[middle]!
    : (moving[middle - 1]! + moving[middle]!) / 2;
}

/**
 * The pace to divide this vehicle's gap by, in metres per second.
 *
 * Null means "no opinion", and both routes to it are real absences rather
 * than defaults: the vehicle's speed was never reported, or it is standing
 * still on a corridor where nothing else is moving either. Callers already
 * treat a null headway as "no headway state for this pair" and generate no
 * candidate from it.
 */
function closingSpeedMetersPerSecond(
  speedKmph: number | null | undefined,
  corridorPace: number | null,
): number | null {
  if (speedKmph == null || Number.isNaN(speedKmph)) return null;
  if (speedKmph >= STATIONARY_SPEED_KMPH) return speedKmph / 3.6;
  if (corridorPace == null) return null;
  return Math.max(corridorPace, MIN_SPEED_KMPH) / 3.6;
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
  // Computed once for the whole chain: it is a property of the corridor at
  // this instant, not of any one pair, and re-deriving it per pair would let
  // two rows in the same snapshot be measured against different paces.
  const corridorPace = corridorPaceKmph(ordered, speedByVehicleId);

  for (const leader of ordered) {
    if (leader.rank < 0 || !leader.followerVehicleId) continue;
    const follower = byId.get(leader.followerVehicleId);
    if (!follower) continue;

    const gapMeters = computeGapMeters(
      leader.distanceAlongRouteMeters,
      follower.distanceAlongRouteMeters,
      routeDirection.totalDistanceMeters
    );

    const followerSpeedMps = closingSpeedMetersPerSecond(
      speedByVehicleId.get(follower.vehicleId) ?? null,
      corridorPace,
    );
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
      trailer == null
        ? null
        : closingSpeedMetersPerSecond(speedByVehicleId.get(trailer.vehicleId) ?? null, corridorPace);
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
