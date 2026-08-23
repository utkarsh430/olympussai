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
  | { type: 'non_compliance'; vehicleId: string; complianceProbability: number }
  /**
   * One vehicle running slower than the rest of the fleet for part or all of
   * its trip - a bus with a mechanical fault, a driver taking a route
   * cautiously, a wheelchair boarding sequence repeated at every stop.
   *
   * The single most common way a real bunch STARTS, and the one the other
   * four disturbances cannot express: `demand_burst` slows whichever bus
   * happens to arrive during its window, `missed_trip` removes a bus
   * entirely, and neither produces the characteristic pattern of one late
   * vehicle with a healthy fleet closing on it from behind.
   *
   * `multiplier` scales the SAMPLED link travel time, so the vehicle keeps
   * its stochastic variation and is simply slower on average. Values below 1
   * model a bus running hot, which bunches from the front instead.
   */
  | {
      type: 'slow_vehicle';
      vehicleId: string;
      multiplier: number;
      /** First affected link, named by the index of the stop it arrives at. Defaults to the whole trip. */
      fromStopIndex?: number;
      /** Last affected link, inclusive, named the same way. Defaults to the whole trip. */
      toStopIndex?: number;
    }
  /**
   * A stretch of the corridor running slow for a WINDOW of clock time, for
   * every vehicle that enters it - congestion, weather, an incident on the
   * carriageway.
   *
   * Distinct from `slow_vehicle` in the shape of the damage, which is the
   * reason both exist. A slow vehicle makes ONE gap collapse behind it. A
   * link slowdown delays every bus inside the window and none outside it, so
   * it compresses the whole platoon that was in the affected stretch and
   * leaves a hole after it - the pattern a control law finds hardest,
   * because there is no single culprit to hold behind.
   *
   * MESOSCOPIC SIMPLIFICATION, stated rather than hidden: the multiplier is
   * applied in full to any link a vehicle ENTERS during the window, and not
   * at all to one it entered before. This engine samples a link travel TIME
   * and never a speed profile, so it has no way to slow the second half of a
   * traversal that was already under way. On a corridor whose links are long
   * relative to the window that makes the disturbance coarser than reality;
   * it does not make it milder or harsher on average.
   */
  | {
      type: 'link_slowdown';
      startSeconds: number;
      endSeconds: number;
      multiplier: number;
      /** First affected link, named by the index of the stop it arrives at. Defaults to the whole corridor. */
      fromStopIndex?: number;
      /** Last affected link, inclusive, named the same way. Defaults to the whole corridor. */
      toStopIndex?: number;
    };

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
  /**
   * A TIMETABLE: `scheduledArrivalSeconds[vehicleId][stopIndex]` is when this
   * vehicle was booked to reach that stop.
   *
   * Optional, and its absence is meaningful rather than merely tolerated. The
   * deployed system prices punctuality (`mpc/objective.ts`'s lateness term) and
   * bounds it (`route_policies.max_lateness_seconds`, enforced in
   * `mpc/safety.ts`), and BOTH are inert on the live network because the
   * timetable tables hold no rows - every schedule deviation is null, so the
   * term contributes nothing and the bound rejects nothing.
   *
   * A scenario that supplies one turns both on. A scenario that does not gets
   * exactly today's behaviour: no deviation, no lateness cost, no bound. The
   * distinction must not be papered over with a zero - "on time" and "no
   * schedule exists" are opposite statements, and a zero would tell the
   * objective every bus was perfectly punctual.
   */
  scheduledArrivalSeconds?: Record<string, number[]>;
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
 * A synchronized snapshot of the deciding vehicle and its neighbours, plus
 * the wrap length their gaps are measured against.
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
  /**
   * The vehicle BEHIND the deciding one, which is what the backward headway
   * h_bwd is measured against (`headway/metrics.ts`) and what makes a
   * two-way-looking law two-way rather than forward-only.
   *
   * Supplied by `engine.ts` since it began advancing every vehicle on one
   * clock. It was structurally always null before that, because a
   * vehicle-major engine has not simulated the bus behind at the moment the
   * bus in front decides - and that single absence meant `mpc/twoWayHold.ts`
   * declined every pair it was ever offered in simulation, so Algorithm B
   * and the `kf`/`kb` gains it is tuned by were unmeasurable.
   *
   * Still null, legitimately, when there is no such vehicle: the back-most
   * bus on a linear route-direction has nothing behind it, and one whose
   * follower has not left the origin has nothing behind it YET. Both are
   * real absences, and `mpc/selfEqualizing.ts` taking the pair instead is
   * the deployed fallback running for the deployed reason.
   */
  trailer?: CorridorKinematicState | null;
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
   * True when this decision point is the route-direction's ORIGIN TERMINAL
   * (`route_direction_stops` sequence 0), where a bus has not yet begun its
   * trip.
   *
   * The deployed system distinguishes it because Algorithm A - terminal
   * dispatch regulation - is the one lever that costs no passenger their seat
   * and no driver their schedule, and the solver tries it before any
   * mid-route hold (`mpc/solver.ts`, `mpc/terminalDispatch.ts#isAtTerminal`).
   * A controller that ignores this flag simply treats the origin as another
   * control point, which is what this engine did before the flag existed.
   *
   * Optional so a hand-built test context need not set it; the engine always
   * does.
   */
  isTerminal?: boolean;
  /**
   * Simulation clock at which a bus last DEPARTED this stop, or null when
   * none has.
   *
   * At the origin this is what terminal dispatch regulation needs: `now`
   * minus this is the elapsed departure headway, the quantity blueprint 8.2
   * regulates and the one production reads from `stop_visits.departed_at`.
   * A stationary bus's own `h_fwd` cannot answer it - see
   * `mpc/terminalDispatch.ts` for why that is not a tuning problem but a
   * category error.
   *
   * Null is a real absence (no predecessor yet) and must not be read as zero.
   */
  previousDepartureSeconds?: number | null;
  /**
   * When this vehicle would leave the stop if no hold were applied:
   * arrival plus its own dwell.
   *
   * The decision instant a departure-based control law has to reason about.
   * Production asks the solver DURING a dwell, so its `now` is already close
   * to the release moment and `now - previousDeparture` is the departure
   * headway that a hold extends from. This engine asks on ARRIVAL, before the
   * dwell has been served, so `now` understates that gap by exactly the
   * dwell - and MEASURED, a terminal law reading it compounded: holds of
   * 20s, 80s, 118s, 168s, 208s down a line of buses dispatched exactly one
   * target headway apart, each hold paying for a gap its own dwell was
   * already going to close and enlarging the shortfall for the bus behind.
   */
  readyToDepartSeconds?: number;
  /**
   * Seconds this vehicle is behind its timetable on arrival here (negative =
   * running early), or null when the scenario supplied no timetable.
   *
   * Null is the live network's state and must not be read as zero: the
   * deployed lateness term and the max-lateness bound both distinguish "this
   * bus is on time" from "nobody knows what time this bus should be here",
   * and only the second is true today.
   */
  scheduleDeviationSeconds?: number | null;
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
  actionType:
    | 'no_control'
    | 'self_equalizing_hold'
    | 'two_way_hold'
    | 'terminal_dispatch_hold'
    | 'cost_optimal_hold'
    // The simulator has no model of boarding demand being refused, so it can
    // carry this action type but cannot yet REPRODUCE its effect - see
    // src/simulation/engine.ts, which applies holdSeconds and nothing else.
    // Present here so a rehearsal replaying real solver output does not fail
    // to parse a corridor where the law fired.
    | 'boarding_limit';
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
  /**
   * How long this stop had been accumulating passengers when this bus reached
   * it: `arrival` minus the last moment the queue was swept.
   *
   * The EXACT quantity a passenger wait should be computed from, and not the
   * same as the gap between two buses' arrivals. They coincide only while every
   * bus takes everybody waiting. They part company the moment one does not -
   * after an alighting-only instruction, or a bus that filled to capacity - and
   * then the gap understates the wait of the people who were passed by, which
   * is precisely the population an alighting-only law is spending.
   */
  waitWindowSeconds: number;
  boardings: number;
  /**
   * Passengers left standing because the bus was told to take nobody on.
   *
   * Distinct from `deniedBoardings`, which is a bus that was FULL. These two
   * are the same experience for the passenger and completely different facts
   * about the system - one is a capacity shortfall, the other is a decision
   * somebody made - and a surface that added them together could not tell an
   * operator which had happened.
   */
  boardingLimitedPassengers: number;
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
  /** How many headway samples every dispersion figure below rests on. Null-ish KPIs on a zero count are an absence, not a zero. */
  headwaySampleCount: number;
  /** Mean headway (seconds) sampled at control points, across all vehicles after the first. */
  meanHeadwaySeconds: number | null;
  /**
   * Coefficient of variation of headway (stddev / mean) at control points.
   *
   * DIAGNOSTIC, not the headline. CV is scale-free, so it can improve while
   * passengers wait longer (a controller that lengthens every headway
   * uniformly lowers CV). `algo_new.md` section 8.2 makes EWT the headline
   * and CV the diagnostic for exactly this reason.
   */
  headwayCv: number | null;
  /**
   * Excess Wait Time, SECONDS PER PASSENGER: the second-moment
   * `E[h^2] / (2 E[h])` minus the scheduled wait of half a target headway.
   * The headline control-quality metric, and the same arithmetic the live
   * network is measured with (`lib/dispersion.ts`, shared with
   * `headway/metrics.ts`).
   */
  ewtSeconds: number | null;
  /** Count of headway samples below `bunchedThresholdRatio * targetHeadwaySeconds`. Not comparable across runs of different size - use `bunchingRate`. */
  bunchingIncidents: number;
  /** Share (0-1) of headway samples below `bunchedThresholdRatio * targetHeadwaySeconds`. The comparable form. */
  bunchingRate: number;
  /**
   * @deprecated First-moment proxy, clipped per sample and summed over the
   * run - it understates exactly the long gaps bunching creates, and its
   * units are not those of `ewtSeconds`. Retained so existing readers do not
   * silently change meaning; report `ewtSeconds`.
   */
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
