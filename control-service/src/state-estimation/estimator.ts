// Orchestrates one position-event update: map matching -> direction
// selection + confidence -> Kalman smoothing (with loop unwrap) ->
// stop-state classification. Pure function of its inputs (no DB/IO) so it
// is fully unit-testable; the IO side (loading candidates/prior state,
// persisting the result) lives in repository.ts / service.ts.

import { clamp, unwrapLoopMeasurement, wrapDistance } from "./geometry.js";
import { matchCandidates } from "./mapMatching.js";
import { scoreDirectionConfidence, selectChosenCandidate } from "./confidence.js";
import { DistanceKalmanFilter } from "./kalmanFilter.js";
import { classifyStopState } from "./stopStateClassifier.js";
import type {
  LatLng,
  PositionEvent,
  PriorVehicleState,
  RouteDirectionShape,
  RouteDirectionStopPoint,
  VehicleStateEstimate,
} from "./types.js";

export interface EstimationContext {
  vehicleId: string;
  event: PositionEvent;
  /** Route-direction shapes to map-match against - the estimator does not filter these itself. */
  candidateShapes: readonly RouteDirectionShape[];
  /** Route-direction stops, keyed by routeDirectionId, sorted by sequence (order not required). */
  nearestStopsByRouteDirection: ReadonlyMap<string, readonly RouteDirectionStopPoint[]>;
  priorState: PriorVehicleState | null;
  isHeldByController: boolean;
  tripId: string | null;
}

export function estimateVehicleState(ctx: EstimationContext): VehicleStateEstimate {
  const point: LatLng = { lat: ctx.event.lat, lon: ctx.event.lon };
  const observedAt = new Date(ctx.event.observedAt);
  const rawHeading = ctx.event.headingDegrees ?? null;
  const rawSpeedKmph = ctx.event.speedKmph ?? null;

  if (ctx.candidateShapes.length === 0) {
    return offRouteEstimate(ctx, rawHeading, rawSpeedKmph, 0);
  }

  const candidates = matchCandidates(point, ctx.candidateShapes, rawHeading);
  const previousRouteDirectionId = ctx.priorState?.routeDirectionId ?? null;
  const chosen = selectChosenCandidate(candidates, previousRouteDirectionId);
  const confidenceResult = scoreDirectionConfidence(chosen, candidates, previousRouteDirectionId);

  const shape = chosen
    ? ctx.candidateShapes.find((s) => s.routeDirectionId === chosen.routeDirectionId) ?? null
    : null;

  if (!chosen || !shape || confidenceResult.reasons.includes("off_route_distance")) {
    return offRouteEstimate(ctx, rawHeading, rawSpeedKmph, confidenceResult.confidence);
  }

  const sameDirectionAsPrior = previousRouteDirectionId === shape.routeDirectionId;
  const priorKalman = sameDirectionAsPrior ? ctx.priorState?.kalmanState ?? null : null;

  let filter: DistanceKalmanFilter;
  if (priorKalman) {
    filter = new DistanceKalmanFilter(priorKalman);
    const measuredS = shape.isLoop
      ? unwrapLoopMeasurement(
          chosen.projectedDistanceMeters,
          filter.smoothedDistanceMeters,
          shape.totalDistanceMeters
        )
      : chosen.projectedDistanceMeters;
    filter.update(measuredS, observedAt);
  } else {
    filter = DistanceKalmanFilter.initialize(chosen.projectedDistanceMeters, observedAt);
  }

  const smoothedS = shape.isLoop
    ? wrapDistance(filter.smoothedDistanceMeters, shape.totalDistanceMeters)
    : clamp(filter.smoothedDistanceMeters, 0, shape.totalDistanceMeters);
  const smoothedSpeedKmph = filter.smoothedSpeedMetersPerSecond * 3.6;

  const stops = ctx.nearestStopsByRouteDirection.get(shape.routeDirectionId) ?? [];
  const nearestStop = findNearestStop(smoothedS, stops);

  const withinGeofence =
    !!nearestStop &&
    Math.abs(smoothedS - nearestStop.cumulativeDistanceMeters) <= nearestStop.geofenceRadiusMeters;

  const stopEnteredAt = computeStopEnteredAt(
    withinGeofence ? nearestStop.stopId : null,
    ctx.priorState,
    ctx.event.observedAt
  );

  const stopClassification = classifyStopState({
    speedKmph: rawSpeedKmph ?? smoothedSpeedKmph,
    distanceAlongRouteMeters: smoothedS,
    nearestStop,
    isHeldByController: ctx.isHeldByController,
    isOffRoute: false,
  });

  return {
    vehicleId: ctx.vehicleId,
    rawPosition: point,
    routeDirectionId: shape.routeDirectionId,
    tripId: ctx.tripId,
    distanceAlongRouteMeters: smoothedS,
    speedKmph: smoothedSpeedKmph,
    headingDegrees: rawHeading ?? chosen.segmentHeadingDegrees,
    stopState: stopClassification.stopState,
    currentStopId: stopClassification.currentStopId,
    stopEnteredAt: stopClassification.currentStopId ? stopEnteredAt : null,
    confidence: confidenceResult.confidence,
    isLowConfidence: confidenceResult.isLowConfidence,
    observedAt: ctx.event.observedAt,
    kalmanState: filter.serialize(),
  };
}

function offRouteEstimate(
  ctx: EstimationContext,
  headingDegrees: number | null,
  speedKmph: number | null,
  confidence: number
): VehicleStateEstimate {
  return {
    vehicleId: ctx.vehicleId,
    rawPosition: { lat: ctx.event.lat, lon: ctx.event.lon },
    routeDirectionId: null,
    tripId: ctx.tripId,
    distanceAlongRouteMeters: null,
    speedKmph,
    headingDegrees,
    stopState: "off_route",
    currentStopId: null,
    stopEnteredAt: null,
    confidence,
    isLowConfidence: true,
    observedAt: ctx.event.observedAt,
    kalmanState: null,
  };
}

function findNearestStop(
  distanceAlongRouteMeters: number,
  stops: readonly RouteDirectionStopPoint[]
): { stopId: string; cumulativeDistanceMeters: number; geofenceRadiusMeters: number } | null {
  const first = stops[0];
  if (!first) return null;

  let nearest = first;
  let bestDelta = Math.abs(distanceAlongRouteMeters - nearest.cumulativeDistanceMeters);
  for (const stop of stops) {
    const delta = Math.abs(distanceAlongRouteMeters - stop.cumulativeDistanceMeters);
    if (delta < bestDelta) {
      nearest = stop;
      bestDelta = delta;
    }
  }
  return {
    stopId: nearest.stopId,
    cumulativeDistanceMeters: nearest.cumulativeDistanceMeters,
    geofenceRadiusMeters: nearest.geofenceRadiusMeters,
  };
}

function computeStopEnteredAt(
  currentStopId: string | null,
  priorState: PriorVehicleState | null,
  observedAt: string
): string | null {
  if (!currentStopId) return null;
  if (priorState?.currentStopId === currentStopId && priorState.stopEnteredAt) {
    return priorState.stopEnteredAt;
  }
  return observedAt;
}
