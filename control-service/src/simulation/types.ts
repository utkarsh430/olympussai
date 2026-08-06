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

export interface ControllerContext {
  routeDirectionId: string;
  stopId: string;
  vehicleId: string;
  /** Simulation clock, seconds since simulation start. */
  now: number;
  /** Gap (seconds) to the vehicle immediately ahead at this stop, or null if unknown/unavailable/first vehicle. */
  leaderHeadwaySeconds: number | null;
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
  actionType: 'no_control' | 'self_equalizing_hold';
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
