// Projection from the state estimator's output (VehicleStateEstimate) onto
// the in-memory runtime row (VehicleStateRow) that /v1/vehicle-states and
// the MPC solver read.
//
// Kept out of both the estimator (a pure library that must not know about
// the process-wide store) and the store (which must not depend on the
// state-estimation types), so neither side grows a dependency on the other.

import type { VehicleStateEstimate } from '../state-estimation/types.js';
import type { VehicleStateRow } from './store.js';

/**
 * Builds the runtime row for `estimate`.
 *
 * `occupancyCount` / `occupancyLoadBand` are NOT part of a
 * VehicleStateEstimate - the estimator only sees a GPS fix. They are
 * carried forward from `prior` rather than nulled, because an occupancy
 * sample that arrived through a different path (rehydration, an APC feed)
 * is still the best known value and must not be erased just because a
 * position update happened to land afterwards.
 *
 * `kalmanState` is deliberately absent from VehicleStateRow: nothing that
 * reads this store needs the filter internals, StateEstimationService keeps
 * its own prior cache, and duplicating it would create a second copy free
 * to drift out of step with the first.
 */
export function vehicleStateRowFromEstimate(
  estimate: VehicleStateEstimate,
  prior?: VehicleStateRow,
): VehicleStateRow {
  return {
    vehicleId: estimate.vehicleId,
    tripId: estimate.tripId,
    routeDirectionId: estimate.routeDirectionId,
    position: { lat: estimate.rawPosition.lat, lon: estimate.rawPosition.lon },
    distanceAlongRouteMeters: estimate.distanceAlongRouteMeters,
    speedKmph: estimate.speedKmph,
    headingDegrees: estimate.headingDegrees,
    stopState: estimate.stopState,
    currentStopId: estimate.currentStopId,
    confidence: estimate.confidence,
    isLowConfidence: estimate.isLowConfidence,
    observedAt: estimate.observedAt,
    occupancyCount: prior?.occupancyCount ?? null,
    occupancyLoadBand: prior?.occupancyLoadBand ?? null,
  };
}
