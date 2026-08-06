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

export function classifyStopState(input: StopStateInput): StopStateResult {
  if (input.isOffRoute) {
    return { stopState: "off_route", currentStopId: null };
  }

  if (input.isHeldByController) {
    return { stopState: "held_by_controller", currentStopId: input.nearestStop?.stopId ?? null };
  }

  const speed = input.speedKmph ?? 0;
  const nearest = input.nearestStop;

  if (nearest) {
    const distanceToStop = Math.abs(input.distanceAlongRouteMeters - nearest.cumulativeDistanceMeters);
    const withinGeofence = distanceToStop <= nearest.geofenceRadiusMeters;

    if (withinGeofence) {
      if (speed <= DWELL_SPEED_THRESHOLD_KMPH) {
        return { stopState: "dwelling_at_stop", currentStopId: nearest.stopId };
      }
      if (input.distanceAlongRouteMeters >= nearest.cumulativeDistanceMeters) {
        return { stopState: "departed_stop", currentStopId: nearest.stopId };
      }
      return { stopState: "approaching_stop", currentStopId: nearest.stopId };
    }

    if (
      input.distanceAlongRouteMeters < nearest.cumulativeDistanceMeters &&
      distanceToStop <= APPROACH_WINDOW_METERS
    ) {
      return { stopState: "approaching_stop", currentStopId: nearest.stopId };
    }
  }

  if (speed <= STOPPED_IN_TRAFFIC_SPEED_THRESHOLD_KMPH) {
    return { stopState: "stopped_in_traffic", currentStopId: null };
  }

  return { stopState: "departed_stop", currentStopId: null };
}
