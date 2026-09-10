// Stop-state classification against the exact enum vehicle_states.stop_state
// allows. There is no generic "cruising between stops" value in that enum,
// so a vehicle that is not at/near a stop and not held is reported as
// 'departed_stop' (i.e. "en route since its last stop") - the closest fit
// the schema's constrained vocabulary offers, documented here rather than
// left implicit.

import type { StopState } from "./types.js";

const DWELL_SPEED_THRESHOLD_KMPH = 2;
const STOPPED_IN_TRAFFIC_SPEED_THRESHOLD_KMPH = 2;
const APPROACH_WINDOW_METERS = 150;

export interface NearestStop {
  stopId: string;
  cumulativeDistanceMeters: number;
  geofenceRadiusMeters: number;
}

export interface StopStateInput {
  speedKmph: number | null;
  distanceAlongRouteMeters: number;
  nearestStop: NearestStop | null;
  isHeldByController: boolean;
  isOffRoute: boolean;
}

export interface StopStateResult {
  stopState: StopState;
  currentStopId: string | null;
}

/**
 * Whether the vehicle counts as OCCUPYING `nearest` - inside its geofence, or
 * closing on it within the approach window.
 *
 * This is the single definition of "which stop is this vehicle at", and every
 * branch below answers `currentStopId` from it. It is exported because the
 * estimator has to timestamp the beginning of exactly this association: when
 * the two disagreed, an approach-window vehicle got a `current_stop_id` with a
 * null `stop_state_entered_at`, and `detectCompletedStopVisit` needs both, so
 * 43% of live stop associations (528 with a stop id, 302 with an entry time)
 * could never yield a visit.
 */
export function isAtStop(
  distanceAlongRouteMeters: number,
  nearest: NearestStop | null,
): nearest is NearestStop {
  if (!nearest) return false;
  const distanceToStop = Math.abs(distanceAlongRouteMeters - nearest.cumulativeDistanceMeters);
  if (distanceToStop <= nearest.geofenceRadiusMeters) return true;
  return (
    distanceAlongRouteMeters < nearest.cumulativeDistanceMeters &&
    distanceToStop <= APPROACH_WINDOW_METERS
  );
}

export function classifyStopState(input: StopStateInput): StopStateResult {
  if (input.isOffRoute) {
    return { stopState: "off_route", currentStopId: null };
  }

  const speed = input.speedKmph ?? 0;
  const nearest = input.nearestStop;
  const atStop = isAtStop(input.distanceAlongRouteMeters, nearest);

  if (input.isHeldByController) {
    // Bounded by `isAtStop` like every other branch. A hold stays 'active' in
    // the table after the bus pulls away, so this branch is reached with the
    // nearest stop kilometres off; naming that stop as the current one made a
    // held bus look like it was standing at a stop it had long since left -
    // and, now that every association is timestamped, would have manufactured
    // a stop visit spanning the whole inter-stop leg.
    return { stopState: "held_by_controller", currentStopId: atStop ? nearest.stopId : null };
  }

  if (atStop) {
    const withinGeofence =
      Math.abs(input.distanceAlongRouteMeters - nearest.cumulativeDistanceMeters) <=
      nearest.geofenceRadiusMeters;

    if (!withinGeofence) {
      // The other half of `isAtStop`: closing on the stop from behind.
      return { stopState: "approaching_stop", currentStopId: nearest.stopId };
    }
    if (speed <= DWELL_SPEED_THRESHOLD_KMPH) {
      return { stopState: "dwelling_at_stop", currentStopId: nearest.stopId };
    }
    if (input.distanceAlongRouteMeters >= nearest.cumulativeDistanceMeters) {
      return { stopState: "departed_stop", currentStopId: nearest.stopId };
    }
    return { stopState: "approaching_stop", currentStopId: nearest.stopId };
  }

  if (speed <= STOPPED_IN_TRAFFIC_SPEED_THRESHOLD_KMPH) {
    return { stopState: "stopped_in_traffic", currentStopId: null };
  }

  return { stopState: "departed_stop", currentStopId: null };
}
