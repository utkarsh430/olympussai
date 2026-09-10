// Domain types for live route-direction state estimation: map matching,
// direction/confidence scoring, Kalman smoothing, stop-state
// classification, and leader-follower ordering.
//
// These mirror the control-service schema in
// control-service/db/migrations/20260805190000__core_data_model.sql and
// its follow-up 20260805200000__state_estimation.sql (loop/corridor
// ordering columns, confidence flag, persisted filter state).

export interface LatLng {
  lat: number;
  lon: number;
}

export interface PositionEvent {
  vehicleId: string;
  lat: number;
  lon: number;
  headingDegrees?: number | null;
  speedKmph?: number | null;
  /** ISO-8601 timestamp the fix was observed at (not received-at). */
  observedAt: string;
}

// Matches vehicle_states.stop_state's CHECK constraint exactly.
export type StopState =
  | "approaching_stop"
  | "dwelling_at_stop"
  | "held_by_controller"
  | "stopped_in_traffic"
  | "departed_stop"
  | "off_route";

export interface RouteDirectionShape {
  routeDirectionId: string;
  routeId: string;
  directionCode: string;
  corridorId: string | null;
  isLoop: boolean;
  /**
   * Cumulative distance (meters) along THIS route-direction's own shape at
   * which it enters the shared corridor, i.e. the offset that converts a
   * local distance-along-route into a corridor-relative distance. Null
   * when not configured (route-direction is not part of a corridor, or the
   * offset hasn't been surveyed yet).
   */
  corridorOffsetMeters: number | null;
  /**
   * +1 if this route-direction's distance-along-route increases in the
   * same physical direction as the corridor's reference direction, -1 if
   * it runs opposite (e.g. two routes sharing a trunk road but travelling
   * it in opposite senses relative to a common corridor origin).
   */
  corridorDirectionSign: 1 | -1;
  totalDistanceMeters: number;
  /** Ordered polyline vertices; distance 0 is points[0]. */
  points: LatLng[];
}

export interface RouteDirectionStopPoint {
  routeDirectionId: string;
  stopId: string;
  sequence: number;
  cumulativeDistanceMeters: number;
  geofenceRadiusMeters: number;
  isControlPoint: boolean;
}

/** 2x2 covariance matrix, row-major: [[Pss, Psv], [Pvs, Pvv]]. */
export type Covariance2x2 = [[number, number], [number, number]];

export interface KalmanState {
  /** Smoothed distance-along-route estimate, meters. */
  s: number;
  /** Smoothed speed estimate, meters/second (can be negative transiently). */
  v: number;
  p: Covariance2x2;
  /** ISO-8601 timestamp this filter state was last updated at. */
  updatedAt: string;
}

export interface MapMatchCandidate {
  routeDirectionId: string;
  projectedDistanceMeters: number;
  perpendicularDistanceMeters: number;
  headingDeltaDegrees: number | null;
  segmentHeadingDegrees: number;
}

export interface DirectionMatchResult {
  /** Candidates sorted best-first (ascending match score). */
  candidates: MapMatchCandidate[];
}

export interface ConfidenceResult {
  confidence: number;
  isLowConfidence: boolean;
  reasons: string[];
}

export interface PriorVehicleState {
  routeDirectionId: string | null;
  kalmanState: KalmanState | null;
  confidence: number | null;
  currentStopId: string | null;
  /** ISO-8601 timestamp this vehicle's association with currentStopId began (see stopStateClassifier.isAtStop). */
  stopEnteredAt: string | null;
}

export interface VehicleStateEstimate {
  vehicleId: string;
  /** Raw GPS fix that produced this estimate - persisted as vehicle_states.position verbatim. */
  rawPosition: LatLng;
  routeDirectionId: string | null;
  tripId: string | null;
  distanceAlongRouteMeters: number | null;
  speedKmph: number | null;
  headingDegrees: number | null;
  stopState: StopState;
  currentStopId: string | null;
  stopEnteredAt: string | null;
  confidence: number | null;
  isLowConfidence: boolean;
  observedAt: string;
  kalmanState: KalmanState | null;
}

export interface VehicleOrderingInput {
  vehicleId: string;
  routeDirectionId: string;
  distanceAlongRouteMeters: number;
  isLowConfidence: boolean;
  /**
   * Set when `state-estimation/positionPlausibility.ts` has rejected this
   * vehicle's reported position - a fix that is fresh, well-formed and
   * self-consistent but inconsistent with the vehicle's own reported speed
   * and the corridor's pace.
   *
   * OPTIONAL, and absent means false, because that is what makes the whole
   * correction byte-identical when its flag is off: every existing caller
   * builds this object without the field and gets exactly today's ranking.
   *
   * A vehicle carrying it is dropped from the chain the same way a
   * low-confidence match is - see `ordering.ts` - which also keeps it out of
   * `headway/metrics.ts#corridorPaceKmph`, since that skips rank -1. The
   * OTHER handling of a rejected fix, substituting the dead-reckoned belief
   * for the reported distance and leaving the vehicle in the chain, needs no
   * field at all: it is a different `distanceAlongRouteMeters`.
   */
  isImplausiblePosition?: boolean;
}

export interface OrderedVehicle extends VehicleOrderingInput {
  /** 0 = leader-most (furthest along the route); -1 = excluded (flagged). */
  rank: number;
  leaderVehicleId: string | null;
  followerVehicleId: string | null;
}

export interface CorridorVehicleInput extends VehicleOrderingInput {
  corridorOffsetMeters: number | null;
  corridorDirectionSign: 1 | -1;
}

export interface CorridorOrderedVehicle extends CorridorVehicleInput {
  corridorDistanceMeters: number | null;
  rank: number;
  leaderVehicleId: string | null;
  followerVehicleId: string | null;
}
