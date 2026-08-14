// Domain and wire types for per-stop arrival prediction.
//
// ─── WHY THIS SUBSYSTEM EXISTS, AND WHAT IT REFUSES TO BE ────────────────
//
// Nothing in this product predicted an arrival time before this module. What
// existed was a PUBLISHED TIMETABLE (upstream `CanonicalStop.scheduledArrival`,
// which the feed publishes as a single time reused for both arrival and
// departure) and LIVE VEHICLE STATE (`vehicle_states`: distance-along-route,
// smoothed speed, stop state, confidence). Those are different kinds of claim
// and this module never converts one into the other.
//
// A timetable time is not a prediction, and this service is structurally
// incapable of emitting one as if it were: no type in this file has a field
// that can carry a schedule time, and the control database it reads has no
// schedule to reach for anyway - `trips` and `trip_stop_times` are both empty
// (0 rows, measured 2026-08-14 against the live control database). Where a
// prediction cannot be made, this module says so with a named reason and an
// EMPTY arrivals array. See PredictionUnavailableReason.
//
// ─── THE ONE STRUCTURAL SAFETY PROPERTY ──────────────────────────────────
//
// `arrivals` is present and empty on the unavailable branch too. A consumer
// that ignores this contract entirely and simply maps over `arrivals` renders
// NOTHING when there is no prediction. The failure mode of misreading this API
// is a blank space, never a confident wrong number. Every other guarantee here
// is a matter of the consumer reading the contract; that one is not.

/** 2-D geographic point, matching state-estimation's LatLng. */
export interface ArrivalLatLng {
  lat: number;
  lon: number;
}

/**
 * Why no prediction could be produced for this vehicle at all.
 *
 * Every one of these is a real, observed condition on the live fleet, not a
 * defensive hypothetical. The counts in the comments are from a read-only
 * snapshot of the live control database on 2026-08-14 (7,733 vehicle_states
 * rows) and are recorded so a future reader can tell which branches carry the
 * fleet and which are edge cases.
 */
export type PredictionUnavailableReason =
  /** No `vehicles` row at all - the caller asked about a bus this service has never heard of. */
  | 'vehicle_unknown'
  /** Known vehicle, but no `vehicle_states` row: it has never been estimated. */
  | 'no_live_state'
  /** `observed_at` could not be parsed. Age unknown, so nothing may be extrapolated from it. */
  | 'unreadable_observation_time'
  /**
   * `observed_at` is stamped further ahead than clock skew explains. The live
   * feed has produced `observed_at = 2046-03-27`; under a one-sided staleness
   * test such a row is permanently "fresh". Its true age is unknown, so it is
   * refused here exactly as mpc/safety.ts refuses it.
   */
  | 'future_dated_state'
  /** Last fix older than MAX_STATE_AGE_SECONDS. See that constant for why the bound is where it is. */
  | 'stale_state'
  /**
   * The raw fix is not a position on the network this operator runs. The feed
   * has produced `latitude 0.000` with a plausible longitude - a valid
   * coordinate in the Gulf of Guinea. Same guard the ops map applies at
   * src/lib/maps/plottable.ts in the web app.
   */
  | 'implausible_position'
  /**
   * The estimator could not place the vehicle on any route-direction. 5,324 of
   * 7,733 rows (69%) are in this state right now. Without a
   * distance-along-route there is no distance to any stop, so there is nothing
   * to predict from.
   */
  | 'off_route'
  /**
   * Matched, but below the estimator's own LOW_CONFIDENCE_THRESHOLD. The
   * leader/follower chain already excludes these vehicles rather than silently
   * trusting them (state-estimation/ordering.ts); an ETA built on such a
   * position would trust it MORE than the subsystem that produced it does.
   */
  | 'low_match_confidence'
  /**
   * The vehicle is being held by a controller. When it departs is the
   * controller's decision, not an inference from its position, and every
   * downstream arrival is offset by that unknown. A number here would be a
   * guess about a human, presented as a measurement of a bus.
   */
  | 'held_by_controller'
  /** The matched route-direction has no shape row, so no stop carries a usable cumulative distance. */
  | 'no_route_geometry'
  /** Matched and fresh, but there is no stop ahead of the vehicle on this route-direction. */
  | 'no_stops_ahead'
  /**
   * No MEASURED running speed is available: this vehicle's own smoothed speed
   * is outside the plausible running band, and there are not enough vehicles
   * on the same stretch of road right now to measure one from. Rather than
   * divide the remaining distance by a configured constant and call the result
   * a prediction, this service declines. See resolveRunningSpeed.
   */
  | 'no_speed_basis';

/** Why one particular stop carries no time, inside an otherwise available prediction. */
export type StopUnavailableReason =
  /**
   * Further out than the requested horizon. Extrapolating a current road speed
   * across hours is arithmetic, not prediction: these are intercity corridors
   * with a median length of 115 km and a maximum of 842 km, so the last stop of
   * a route can be most of a day away.
   */
  | 'beyond_prediction_horizon'
  /** The model puts the vehicle at or past this stop already; the next fix settles it. */
  | 'due_or_passed'
  /** Confidence fell below MIN_PUBLISHABLE_CONFIDENCE - a number nobody should act on. */
  | 'confidence_below_floor';

/**
 * Where the running speed came from.
 *
 * Both values are MEASUREMENTS of buses that are actually moving right now.
 * There is deliberately no third value for a configured constant: this service
 * emits no time it cannot ground in an observation.
 */
export type SpeedBasisKind =
  /** This vehicle's own Kalman-smoothed speed, inside the plausible running band. */
  | 'vehicle_smoothed_speed'
  /**
   * The median smoothed speed of other vehicles on the SAME stretch of the same
   * route-direction right now (within PEER_WINDOW_METERS along the route), used
   * when this vehicle's own speed is unusable - typically because it is
   * dwelling, stopped in traffic, or its filter has not converged.
   */
  | 'route_peer_median_speed';

export interface RunningSpeed {
  basis: SpeedBasisKind;
  speedKmph: number;
  /** How many vehicle observations the figure was measured from. 1 for the vehicle's own speed. */
  sampleCount: number;
  /**
   * Fractional half-width applied to the speed when computing the arrival
   * bounds, after basis, filter covariance, peer dispersion and state age are
   * all accounted for. 0.25 means the bounds were computed at +/-25% of
   * `speedKmph`.
   */
  relativeSpread: number;
  /** Along-route half-window the peers were drawn from. Null for the vehicle's own speed. */
  peerWindowMeters: number | null;
}

/** How the current stop's remaining dwell was arrived at. */
export type CurrentStopDwellBasis =
  /** The vehicle is not inside a stop geofence, so there is no dwell left to serve. */
  | 'not_at_stop'
  /** Dwelling, and `stop_state_entered_at` was readable: remaining = modelled dwell minus elapsed. */
  | 'observed_dwell_elapsed'
  /**
   * Dwelling, but `stop_state_entered_at` was missing, unreadable or stamped in
   * the future, so how long it has already been there is unknown. The full
   * modelled dwell is charged rather than assuming it is nearly done.
   */
  | 'dwell_elapsed_unknown';

/**
 * The dwell half of the model, described so a consumer can see exactly how much
 * of every number below is modelled rather than measured.
 *
 * `measured: false` is not decoration. Travel time here is measured distance
 * divided by measured speed; dwell is a configured constant, because this
 * service has no dwell history to measure from - `vehicle_states` is a
 * current-state table by design and there is no telemetry time series
 * (control-service/db/migrations/20260805190000__core_data_model.sql). Rather
 * than blend the two into one opaque figure, every arrival reports its travel
 * and dwell components separately, so the modelled portion is visible and can
 * be subtracted back out by anyone who wants only the measured part.
 */
export interface DwellModel {
  basis: 'configured_default';
  /** Always false: this is configuration, not an observation of these stops. */
  measured: false;
  secondsPerIntermediateStop: number;
  currentStop: {
    basis: CurrentStopDwellBasis;
    remainingSeconds: number;
  };
}

/** The parts an arrival time is built from, kept separate so the modelled portion stays visible. */
export interface ArrivalComponents {
  /** Measured: remaining distance divided by measured running speed. */
  travelSeconds: number;
  /** Modelled: DwellModel.secondsPerIntermediateStop x intermediateStopCount. */
  dwellSeconds: number;
  /** Modelled or measured-elapsed: what is left to serve at the stop the vehicle is at now. */
  currentStopDwellSeconds: number;
  /**
   * How much of the elapsed real time since the fix was subtracted to express
   * the answer as "from now" rather than "from the observation". This is the
   * only extrapolation this service performs, and it is reported rather than
   * hidden.
   */
  stateAgeSeconds: number;
}

export type ConfidenceBand = 'firm' | 'usable' | 'rough';

export interface StopArrivalBase {
  stopId: string;
  stopName: string;
  /** `route_direction_stops.sequence` - the stop's position along this route-direction. */
  sequence: number;
  isControlPoint: boolean;
  /** Along-route distance from the vehicle's estimated position to this stop, at observation time. */
  distanceRemainingMeters: number;
  /** Stops strictly between the vehicle and this one, each charged one modelled dwell. */
  intermediateStopCount: number;
}

export type StopArrival = StopArrivalBase &
  (
    | {
        status: 'predicted';
        /** Seconds from `generatedAt`. Always > 0; a non-positive result is reported as `due_or_passed` instead. */
        etaSeconds: number;
        /** `generatedAt` + etaSeconds, ISO-8601. */
        etaAt: string;
        /** Fastest plausible arrival, from the upper speed bound. Never greater than etaSeconds. */
        lowerBoundSeconds: number;
        /** Slowest plausible arrival, from the lower speed bound. Never less than etaSeconds. */
        upperBoundSeconds: number;
        /** [0, 1]. See computeArrivalConfidence for the four factors it multiplies. */
        confidence: number;
        confidenceBand: ConfidenceBand;
        components: ArrivalComponents;
      }
    | {
        status: 'unavailable';
        reason: StopUnavailableReason;
      }
  );

/** The vehicle state the prediction was computed from, echoed so the answer is auditable. */
export interface PredictionVehicleState {
  distanceAlongRouteMeters: number;
  /** `vehicle_states.confidence` - the estimator's own trust in the map match. */
  matchConfidence: number;
  stopState: string;
  currentStopId: string | null;
}

export type PredictionEnvelope =
  | {
      status: 'unavailable';
      reason: PredictionUnavailableReason;
      /** Plain-language statement of what is missing, safe to show an operator. */
      detail: string;
      routeDirectionId: string | null;
      observedAt: string | null;
      stateAgeSeconds: number | null;
      /** Always empty. Present so a consumer that ignores `status` renders nothing rather than something wrong. */
      arrivals: [];
    }
  | {
      status: 'available';
      routeDirectionId: string;
      observedAt: string;
      stateAgeSeconds: number;
      vehicle: PredictionVehicleState;
      speed: RunningSpeed;
      dwell: DwellModel;
      arrivals: StopArrival[];
    };

export interface ArrivalPredictionResponse {
  vehicleId: string;
  /** Server clock at compute time. Every `etaSeconds` is relative to this instant. */
  generatedAt: string;
  /** The horizon actually applied, after clamping the request. */
  horizonSeconds: number;
  /** The stop count actually applied, after clamping the request. */
  stopLimit: number;
  prediction: PredictionEnvelope;
}

// ─── Repository-facing inputs (no HTTP, no Postgres types) ───────────────

/** One vehicle's live state, projected down to what prediction needs. */
export interface VehicleStateForPrediction {
  vehicleId: string;
  routeDirectionId: string | null;
  distanceAlongRouteMeters: number | null;
  speedKmph: number | null;
  stopState: string;
  currentStopId: string | null;
  stopEnteredAt: string | null;
  confidence: number | null;
  isLowConfidence: boolean;
  observedAt: string;
  position: ArrivalLatLng | null;
  /** Velocity variance from the persisted Kalman covariance, (m/s)^2. Null when the filter state is absent or malformed. */
  velocityVarianceMeters2PerSecond2: number | null;
}

/** A peer vehicle on the same route-direction, used only to measure a running speed. */
export interface PeerVehicleSpeed {
  vehicleId: string;
  distanceAlongRouteMeters: number;
  speedKmph: number;
}

/** One stop on the route-direction, with the distance the shape puts it at. */
export interface PredictionStop {
  stopId: string;
  stopName: string;
  sequence: number;
  cumulativeDistanceMeters: number;
  isControlPoint: boolean;
}

export interface PredictionRouteGeometry {
  routeDirectionId: string;
  isLoop: boolean;
  totalDistanceMeters: number;
}
