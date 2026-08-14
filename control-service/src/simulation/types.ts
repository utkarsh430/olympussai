// Domain types for the calibrated event-based / mesoscopic simulator
// (blueprint section 11.1, "Mesoscopic simulator - non-negotiable").
//
// Isolation note (load-bearing for the AC "simulator runs write no
// production data and never touch the live command path"): nothing in
// `control-service/src/simulation/**` imports `../db/*`, `../state/*`,
// `../routes/*`, `../webhooks/*`, or `../mpc/*`. It has zero dependency on
// the live Postgres pool, the in-memory `stateStore`, the REST/webhook
// API, or the real `mpc.solve` controller. It is a pure, deterministic
// (given a seed), in-memory computation over caller-supplied inputs and
// returns its results as plain data - it never issues an HTTP call, a DB
// write, or a signed webhook. Callers (tests, an offline CLI/report) are
// responsible for anything they do with the returned `SimulationResult`;
// the module itself has no side-effecting sink.

export interface LinkTravelTimeModel {
  /** Mean travel time (seconds) for this link under normal conditions. */
  meanSeconds: number;
  /** Standard deviation (seconds) of stochastic link travel time (0 = deterministic). */
  stddevSeconds: number;
}

export interface StopDemandModel {
  /** Expected boarding passengers per minute of accumulated wait at this stop, under normal demand. */
  boardingRatePerMinute: number;
  /** Fraction of onboard load that alights at this stop under normal conditions. */
  alightingFraction: number;
  /** Fixed dwell overhead (seconds): doors open/close, fare collection setup, etc. */
  baseDwellSeconds: number;
  /** Additional seconds per boarding passenger. */
  secondsPerBoarding: number;
  /** Additional seconds per alighting passenger. */
  secondsPerAlighting: number;
}

export interface StopDefinition {
  stopId: string;
  sequence: number;
  isControlPoint: boolean;
  demand: StopDemandModel;
  /**
   * Distance along the route-direction at which this stop sits, in metres
   * (`route_direction_stops.cumulative_distance_meters`).
   *
   * OPTIONAL, and its absence is meaningful rather than merely tolerated.
   * The hand-authored regression fixtures are synthetic corridors with no
   * real geometry, and inventing a distance for them would put a fabricated
   * number into the one input the deployed control laws measure headway
   * from. When it is absent the engine reports `kinematics: null` on every
   * `ControllerContext`, which is exactly the "input unavailable" case the
   * deployed solver already has a documented answer for.
   *
   * Must be non-decreasing across `stops` when supplied.
   */
  cumulativeDistanceMeters?: number;
}

export interface RouteDirectionDefinition {
  routeDirectionId: string;
  vehicleCapacity: number;
  /** Ordered terminal -> last stop. */
  stops: StopDefinition[];
  /** links[i] is the link INTO stops[i] (links[0] = terminal -> stops[0]). Length must equal stops.length. */
  links: LinkTravelTimeModel[];
  targetHeadwaySeconds: number;
  bunchedThresholdRatio: number;
  maxHoldSeconds: number;
  /**
   * Minimum time separation (seconds) enforced between two vehicles
   * arriving at the same stop, modeling a no-overtake corridor: vehicles
   * keep their terminal-dispatch order for the whole trip (single-lane /
   * no-overtake-segment simplification, blueprint 11.1 "Operations" row).
   */
  minSeparationSeconds: number;
  /**
   * `route_shapes.total_distance_meters`. Supplied together with every
   * stop's `cumulativeDistanceMeters` (both or neither) - it is the wrap
   * length the deployed gap computation needs on a loop route-direction,
   * so a corridor that carries stop distances without it would silently
   * mis-measure exactly the corridors that wrap.
   */
  totalDistanceMeters?: number;
}

export interface TerminalDispatchPlan {
  vehicleId: string;
  /** Scheduled dispatch time, seconds since simulation start. */
  scheduledDispatchSeconds: number;
}

export type Disturbance =
  | { type: 'demand_burst'; stopId: string; startSeconds: number; endSeconds: number; multiplier: number }
  | { type: 'missed_trip'; vehicleId: string }
  | { type: 'gps_dropout'; vehicleId: string; startSeconds: number; endSeconds: number }
  | { type: 'non_compliance'; vehicleId: string; complianceProbability: number };

/**
 * Recorded historical-day inputs for replay mode: when present, the engine
 * uses these EXACT values instead of sampling from `links[]`/`demand`
 * distributions, so a replay run is fully deterministic and reproduces a
 * stored day rather than a statistically similar one.
 */
export interface RecordedInputs {
  /** linkTravelSeconds[vehicleId][stopIndex] = observed travel time for the link into stops[stopIndex]. */
  linkTravelSeconds: Record<string, number[]>;
  /** boardings[vehicleId][stopIndex] = observed boarding count at stops[stopIndex]. */
  boardings: Record<string, number[]>;
  /** alightings[vehicleId][stopIndex] = observed alighting count at stops[stopIndex]. */
  alightings: Record<string, number[]>;
}

export interface ScenarioConfig {
  name: string;
  routeDirection: RouteDirectionDefinition;
  dispatches: TerminalDispatchPlan[];
  disturbances: Disturbance[];
  /** PRNG seed - same seed + same config always produces the same result. */
  seed: number;
  recordedInputs?: RecordedInputs;
}

/**
 * Where a vehicle is on the corridor, and how fast it is moving, at one
 * instant of simulated time.
 *
 * This is the shape the DEPLOYED headway computation consumes
 * (`src/headway/metrics.ts#computePairHeadways` reads a distance-along-route
 * and a speed per vehicle, and derives both h_fwd and h_bwd from the single
 * gap between a leader and its follower). Carrying it on the controller
 * context is what lets a simulator controller call that real function
 * instead of approximating its output - see `src/rehearsal/`.
 *
 * `speedKmph` is null when the vehicle's position is known but its pace is
 * not - the same three-state distinction `vehicle_states.speed_kmph`
 * already carries, and the reason `computePairHeadways` returns a null
 * headway rather than guessing.
 */
export interface CorridorKinematicState {
  vehicleId: string;
  distanceAlongRouteMeters: number;
  speedKmph: number | null;
}

/**
 * A synchronized snapshot of the deciding vehicle and the one ahead of it,
 * plus the wrap length their gap is measured against.
 *
 * Null whenever the route-direction was not given real geometry
 * (`StopDefinition.cumulativeDistanceMeters`), or the vehicle ahead is not
 * on the corridor at this instant (it has not been dispatched, or has
 * already completed its trip). A controller must treat null as "no headway
 * state for this vehicle" - never as a licence to assume one.
 */
export interface ControllerKinematics {
  follower: CorridorKinematicState;
  leader: CorridorKinematicState;
  totalDistanceMeters: number;
}

export interface ControllerContext {
  routeDirectionId: string;
  stopId: string;
  vehicleId: string;
  /** Simulation clock, seconds since simulation start. */
  now: number;
  /** Gap (seconds) to the vehicle immediately ahead at this stop, or null if unknown/unavailable/first vehicle. */
  leaderHeadwaySeconds: number | null;
  /**
   * Positions and speeds of this vehicle and the one ahead of it at `now`,
   * when the corridor carries real geometry. See `ControllerKinematics`.
   * Optional so a test may build a context by hand without it; the engine
   * always sets it, to a value or explicitly to null.
   */
  kinematics?: ControllerKinematics | null;
  /**
   * Passengers modelled aboard this vehicle as it arrives, before boarding
   * and alighting at this stop are applied.
   *
   * MODELLED, never observed. Nothing in the production system writes
   * occupancy (`vehicle_states.occupancy_count` is null fleet-wide), which
   * is why the deployed occupancy-weighted MPC tier always falls back to a
   * fixed mid-load assumption. A simulator is allowed to have this number
   * because it made it up, and every surface that shows it must say so.
   */
  onboardCount?: number;
  targetHeadwaySeconds: number;
  maxHoldSeconds: number;
  /**
   * True when this vehicle's state is unavailable/unreliable (e.g. an
   * active `gps_dropout` disturbance). A correct controller MUST NOT
   * issue a hold when this is true - see `noControlController` and
   * `selfEqualizingController` in `controllers.ts`, and the guardrail
   * assertion in `test/simulation/regression.test.ts`.
   */
  isStateStale: boolean;
}

export interface ControllerDecision {
  holdSeconds: number;
  /**
   * Mirrors the deployed engine's own action vocabulary
   * (`src/mpc/types.ts#CandidateAction['actionType']`) plus `no_control`.
   * `two_way_hold` became reachable when the controller context started
   * carrying `kinematics`: two-way holding needs h_bwd, and h_bwd needs the
   * leader's pace, which a headway-difference alone cannot supply.
   */
  actionType: 'no_control' | 'self_equalizing_hold' | 'two_way_hold' | 'terminal_dispatch_hold';
}

export interface Controller {
  name: string;
  decide(context: ControllerContext): ControllerDecision;
}

export interface StopVisitRecord {
  vehicleId: string;
  stopId: string;
  stopIndex: number;
  arrivalSeconds: number;
  boardings: number;
  alightings: number;
  deniedBoardings: number;
  onboardAfter: number;
  dwellSeconds: number;
  intendedHoldSeconds: number;
  appliedHoldSeconds: number;
  compliant: boolean;
  departureSeconds: number;
  leaderHeadwaySeconds: number | null;
  /** True when this visit occurred while a `gps_dropout` disturbance was active for this vehicle. */
  isStateStale: boolean;
}

export interface KpiSummary {
  /** Mean headway (seconds) sampled at control points, across all vehicles after the first. */
  meanHeadwaySeconds: number | null;
  /** Coefficient of variation of headway (stddev / mean) at control points - the standard bunching metric. */
  headwayCv: number | null;
  /** Count of headway samples below `bunchedThresholdRatio * targetHeadwaySeconds`. */
  bunchingIncidents: number;
  /** Sum over all stop visits of (actual wait - scheduled wait), assuming uniform passenger arrivals (avg wait = headway / 2). */
  excessWaitSeconds: number;
  /** Passengers who could not board because the vehicle was at capacity. */
  deniedBoardings: number;
  /** Passengers still waiting (uncleared demand) at the end of the simulated window. */
  strandedPassengers: number;
  /** Fraction of terminal dispatches within `targetHeadwaySeconds * bunchedThresholdRatio` of their scheduled headway. */
  onTimeDispatchRate: number;
  /** Fraction of issued (non-zero, non-stale) hold decisions the simulated driver actually complied with. */
  complianceRate: number | null;
  totalBoardings: number;
}

export interface SimulationResult {
  scenarioName: string;
  controllerName: string;
  visits: StopVisitRecord[];
  kpis: KpiSummary;
}

export interface HistoricalDayFixture {
  routeDirection: RouteDirectionDefinition;
  dispatches: TerminalDispatchPlan[];
  recordedInputs: RecordedInputs;
  /** Ground-truth KPIs derived independently from `recordedInputs` - see `referenceKpi.ts`. */
  recordedKpis: KpiSummary;
}
