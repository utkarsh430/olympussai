// One rehearsal: a real corridor, its real policy, the deployed control
// laws, and a demand model that is openly invented.
//
// ─── WHAT IS REAL AND WHAT IS MODELLED ───────────────────────────────────
//
// Every rehearsal returns a `provenance` manifest saying this field by
// field, because a simulator that does not is a demo. In summary:
//
//   MEASURED (from the seeded network, unchanged)
//     the corridor's stops, their order, their positions, their distances
//     along the route, which of them are control points, the route shape,
//     the corridor's total length, the target headway H*, the bunching and
//     warning threshold ratios, the controller gains Kf/Kb/k, the maximum
//     hold, the cooldown and the prediction horizon.
//
//   MODELLED (invented here, and nowhere in the production system)
//     running time between stops, boarding and alighting rates, dwell
//     times, vehicle capacity, the number of vehicles, the disturbance, and
//     occupancy. Nothing in this system has ever recorded any of them.
//     `route_links` is empty, `trips` and `trip_stop_times` are empty, and
//     `vehicle_states.occupancy_count` is null fleet-wide.
//
// The line between those two lists is the product. A planner rehearsing a
// control strategy needs to know that the CONTROL is the deployed one and
// the TRAFFIC is a guess, not the other way round.
import {
  simulate,
  noControlController,
  summarizeKpis,
  type Disturbance,
  type KpiSummary,
  type LinkTravelTimeModel,
  type RouteDirectionDefinition,
  type ScenarioConfig,
  type StopDemandModel,
  type StopVisitRecord,
  type TerminalDispatchPlan,
} from '../simulation/index.js';
import { corridorStateAt } from '../simulation/kinematics.js';
import { AppError } from '../lib/errors.js';
import {
  createDeployedControlLawsController,
  type RehearsalDecisionRecord,
} from './deployedControlLaws.js';
import { buildShapeRuler, placeAlongShape } from './shape.js';
import type { CorridorInputs } from './corridor.js';

/** Named disturbances a planner can rehearse against. Same four the regression scenario library uses, retargeted onto a real corridor. */
export type RehearsalDisturbance =
  | 'none'
  | 'demand_burst'
  | 'missed_trip'
  | 'gps_dropout'
  | 'non_compliance';

export const REHEARSAL_DISTURBANCES: readonly RehearsalDisturbance[] = [
  'none',
  'demand_burst',
  'missed_trip',
  'gps_dropout',
  'non_compliance',
];

/**
 * The invented half of the inputs, all of it operator-adjustable.
 *
 * Defaults are stated rather than hidden, and every one of them is a guess.
 * They are chosen to be plausible for a UP intercity corridor (the seeded
 * network averages 215 km and 19 stops per route-direction) and for no
 * stronger reason than that.
 */
export interface ModelledInputs {
  /** Average running speed between stops, km/h. Turns a real link DISTANCE into a modelled link TIME. */
  cruiseSpeedKmph: number;
  /** Link travel-time standard deviation as a fraction of its mean. 0 makes the corridor deterministic. */
  travelTimeVariation: number;
  /** Passengers arriving per minute at each stop. */
  boardingRatePerMinute: number;
  /** Fraction of the onboard load that gets off at each stop. */
  alightingFraction: number;
  /** Doors-open overhead per stop, seconds. */
  baseDwellSeconds: number;
  secondsPerBoarding: number;
  secondsPerAlighting: number;
  /** Seats. Also the denominator the occupancy-weighted tier is given in its MODELLED arm. */
  vehicleCapacity: number;
  /** How many vehicles are dispatched, one target headway apart. */
  vehicleCount: number;
  /** PRNG seed. The same seed and inputs always produce the same rehearsal. */
  seed: number;
  disturbance: RehearsalDisturbance;
}

export const DEFAULT_MODELLED_INPUTS: ModelledInputs = {
  cruiseSpeedKmph: 35,
  travelTimeVariation: 0.12,
  boardingRatePerMinute: 1.5,
  alightingFraction: 0.18,
  baseDwellSeconds: 20,
  secondsPerBoarding: 2.5,
  secondsPerAlighting: 1.5,
  vehicleCapacity: 52,
  vehicleCount: 6,
  seed: 20260814,
  disturbance: 'none',
};

/** How many map frames a rehearsal returns. Bounded so a long intercity corridor cannot return a multi-megabyte payload. */
export const REHEARSAL_FRAME_COUNT = 60;

export interface RehearsalVehicleFrame {
  vehicleId: string;
  distanceAlongRouteMeters: number;
  latitude: number;
  longitude: number;
  headingDegrees: number | null;
  /** Modelled passengers aboard. Modelled - see this file's header. */
  onboard: number;
  status: 'running' | 'dwelling' | 'held';
}

export interface RehearsalFrame {
  atSeconds: number;
  vehicles: RehearsalVehicleFrame[];
}

export interface RehearsalArm {
  name: string;
  kpis: KpiSummary;
  frames: RehearsalFrame[];
  /** Total seconds of hold this arm actually applied across the run. Zero for the uncontrolled arm by construction. */
  appliedHoldSeconds: number;
  /** Holds the control law asked for that a driver did not take (the non-compliance disturbance). */
  refusedHoldSeconds: number;
}

export type ProvenanceSource = 'measured' | 'configured' | 'modelled';

export interface ProvenanceEntry {
  field: string;
  source: ProvenanceSource;
  value: string;
  note: string;
}

export interface RehearsalResult {
  corridor: {
    routeDirectionId: string;
    routeId: string;
    routeName: string | null;
    directionCode: string;
    isLoop: boolean;
    totalDistanceMeters: number;
    calibrationSource: string;
    stops: CorridorInputs['stops'];
    shape: CorridorInputs['shape'];
    controlPointCount: number;
  };
  policy: {
    targetHeadwaySeconds: number;
    bunchedThresholdRatio: number;
    warningThresholdRatio: number;
    kf: number | null;
    kb: number | null;
    selfEqualizingK: number | null;
    maxHoldSeconds: number;
    cooldownSeconds: number;
    predictionHorizonControlPoints: number;
    occupancyCapacity: number | null;
    occupancyStaleSeconds: number | null;
  };
  inputs: ModelledInputs;
  provenance: ProvenanceEntry[];
  arms: { uncontrolled: RehearsalArm; controlled: RehearsalArm };
  decisions: readonly RehearsalDecisionRecord[];
  /**
   * What the occupancy-weighted MPC tier did with a real number for the
   * first time. See `RehearsalDecisionRecord.occupancy` - both arms are the
   * same deployed function; only the occupancy input differs, and the
   * modelled one is invented.
   */
  occupancyContrast: {
    decisionsScored: number;
    /** Decisions where production's own run had to fall back to its fixed mid-load assumption. Always every scored decision, today. */
    decisionsUsingFallbackToday: number;
    /**
     * Mean onboard-delay cost the tier charged for holding, under each
     * occupancy input. This is the term occupancy actually drives
     * (`load(i) x hold(i) x w_onboard`), so it is the honest way to show
     * what an occupancy feed would change.
     *
     * NOT a ranking comparison. A rehearsal decision has exactly one
     * leader/follower pair and therefore at most one candidate, and a
     * one-item list cannot be re-ordered - so a "decisions re-ranked"
     * count would be structurally zero and would read as evidence that
     * occupancy does not matter. `rankingComparable` says whether any
     * decision had more than one candidate for the ranking to bite on.
     */
    meanOnboardCostAsDeployedToday: number | null;
    meanOnboardCostWithModelledOccupancy: number | null;
    rankingComparable: boolean;
  };
  /**
   * The vehicle the disturbance was aimed at, so the surface can label it
   * rather than leaving an operator to infer which bus lost its feed or
   * refused its holds. Null when the run has no disturbance.
   */
  disturbedVehicleId: string | null;
  /** Parts of the deployed decision cycle this rehearsal does NOT exercise, in words, for the surface to print verbatim. */
  notRehearsed: string[];
  horizonSeconds: number;
}

/**
 * Per-stop and per-link values fitted from real observations, replacing the
 * flat invented profile for the stops and links they cover.
 *
 * PARTIAL BY CONSTRUCTION. A fit needs enough samples at a stop to mean
 * anything, and a corridor will have them at some stops and not others. The
 * uncovered ones keep the modelled value and the run's provenance says which
 * were which - substituting a corridor-wide average for a stop that was never
 * observed would turn "we did not measure this" into a measurement.
 */
export interface CorridorOverrides {
  /** Keyed by `stopId`. Merged over the flat modelled demand. */
  demandByStopId?: ReadonlyMap<string, Partial<StopDemandModel>>;
  /** Keyed by the stop the link ARRIVES at, matching `links[i]` being the leg into `stops[i]`. */
  linkByToStopId?: ReadonlyMap<string, LinkTravelTimeModel>;
}

function buildRouteDirection(
  corridor: CorridorInputs,
  inputs: ModelledInputs,
  overrides: CorridorOverrides = {},
): RouteDirectionDefinition {
  const metersPerSecond = inputs.cruiseSpeedKmph / 3.6;
  const stops = corridor.stops;

  const links = stops.map((stop, index) => {
    const fitted = overrides.linkByToStopId?.get(stop.stopId);
    if (fitted) return { meanSeconds: fitted.meanSeconds, stddevSeconds: fitted.stddevSeconds };
    const previous = index > 0 ? (stops[index - 1]?.cumulativeDistanceMeters ?? 0) : 0;
    const linkMeters = Math.max(0, stop.cumulativeDistanceMeters - previous);
    const meanSeconds = metersPerSecond > 0 ? linkMeters / metersPerSecond : 0;
    return { meanSeconds, stddevSeconds: meanSeconds * inputs.travelTimeVariation };
  });

  return {
    routeDirectionId: corridor.routeDirectionId,
    vehicleCapacity: inputs.vehicleCapacity,
    stops: stops.map((stop) => ({
      stopId: stop.stopId,
      sequence: stop.sequence,
      isControlPoint: stop.isControlPoint,
      cumulativeDistanceMeters: stop.cumulativeDistanceMeters,
      demand: {
        // ─── NOBODY BOARDS AT THE END OF THE ROUTE ──────────────────────
        //
        // The last stop of a route-direction is where journeys END. This gave
        // it the corridor's full boarding rate anyway, so passengers queued at
        // the terminus, were charged waiting time, boarded a bus whose trip
        // finished on the spot, and were carried nowhere.
        //
        // Not a rounding error. MEASURED on the urban corridor over ten
        // scenarios x three seeds, the terminus was 4.2% of all boardings and
        // the single largest contributor to the measured wait saving - 137 of
        // 1,456 hours, 9.4% of it, from one stop of twenty-five - because
        // terminal dispersion is worst exactly there and the whole of it was
        // being priced as a benefit of control.
        boardingRatePerMinute: isLastStop(stop, stops) ? 0 : inputs.boardingRatePerMinute,
        // The last stop empties: everyone still aboard has arrived. Every
        // other stop uses the modelled fraction.
        alightingFraction: isLastStop(stop, stops) ? 1 : inputs.alightingFraction,
        baseDwellSeconds: inputs.baseDwellSeconds,
        secondsPerBoarding: inputs.secondsPerBoarding,
        secondsPerAlighting: inputs.secondsPerAlighting,
        ...(overrides.demandByStopId?.get(stop.stopId) ?? {}),
      },
    })),
    links,
    targetHeadwaySeconds: corridor.policy.targetHeadwaySeconds,
    bunchedThresholdRatio: corridor.policy.bunchedThresholdRatio,
    maxHoldSeconds: corridor.policy.maxHoldSeconds,
    totalDistanceMeters: corridor.totalDistanceMeters,
    // No-overtake separation. `route_links.no_overtake` is empty on this
    // database, so this is a modelled floor, not a surveyed restriction.
    minSeparationSeconds: 30,
  };
}

/**
 * The vehicle that runs ahead of the reported fleet and is excluded from
 * every number this rehearsal returns.
 *
 * MEASURED on a real corridor before this existed: the engine treats each
 * stop as having accumulated passengers since simulated second zero, so on
 * a 164 km corridor the first bus arrived at a mid-route stop 8,000 seconds
 * in and swept up 8,000 seconds' worth of waiting passengers. It reported
 * 5,174 denied boardings for a six-bus run - a number produced almost
 * entirely by a queue that had been standing since midnight in a model that
 * starts at midnight.
 *
 * A warm-up run clears that queue. Every reported bus then sees only the
 * demand that accumulated since the bus in front of it, which is what a
 * steady-state service actually looks like and is the only regime in which
 * a headway comparison means anything.
 */
const WARMUP_VEHICLE_ID = 'WARMUP';

function buildDispatches(inputs: ModelledInputs, targetHeadwaySeconds: number): TerminalDispatchPlan[] {
  return [
    { vehicleId: WARMUP_VEHICLE_ID, scheduledDispatchSeconds: 0 },
    ...Array.from({ length: inputs.vehicleCount }, (_, index) => ({
      vehicleId: `SIM-${String(index + 1).padStart(2, '0')}`,
      scheduledDispatchSeconds: (index + 1) * targetHeadwaySeconds,
    })),
  ];
}

/** Reported vehicles only - the warm-up run is machinery, not a result. */
function isReported(vehicleId: string): boolean {
  return vehicleId !== WARMUP_VEHICLE_ID;
}

/**
 * The bus a disturbance is aimed at: the MIDDLE of the reported fleet.
 *
 * It has both a leader and a follower to work with, which is the requirement,
 * and it is also somewhere the corridor is actually running. This used to take
 * the SECOND reported bus, which met the letter of that requirement and missed
 * its point: the second bus of the day sits in a corridor that is still
 * filling, behind nothing but the warm-up run, at the one part of the timeline
 * where the spacing is still exactly what the dispatcher planned. Aiming a
 * disturbance there and then asking what the control laws did about it is
 * asking the question at the moment there is least to answer - the enclosing
 * comment in `buildDisturbances` has always claimed "the middle of the running
 * fleet" while this returned index 1.
 *
 * MEASURED across twelve seeds of a 32-bus rehearsal on the 215 km test
 * corridor. Aimed at the second bus, a `gps_dropout` run put that bus in a
 * bunch - so that there was a hold for its stale feed to block - on 10 of 12
 * seeds, and a `non_compliance` run produced a hold for its driver to refuse
 * on 9 of 12. Aimed at the middle of the fleet, both happened on all 12.
 *
 * That is not a test-fixture convenience. On the seeds where nothing
 * happened, the rehearsal reported that a dropped feed and a refusing driver
 * had no consequence - which is a statement about where the disturbance was
 * put, presented to a planner as a statement about the corridor.
 */
function disturbanceTarget(dispatches: readonly TerminalDispatchPlan[]): TerminalDispatchPlan | undefined {
  const reported = dispatches.filter((d) => isReported(d.vehicleId));
  if (reported.length === 0) return undefined;
  return reported[Math.floor(reported.length / 2)];
}

function buildDisturbances(
  inputs: ModelledInputs,
  corridor: CorridorInputs,
  dispatches: readonly TerminalDispatchPlan[],
  targetHeadwaySeconds: number,
): Disturbance[] {
  // Deliberately targeted at the middle of the corridor and the middle of
  // the running fleet, so the disturbance lands where the control laws have
  // both a leader and a follower to work with rather than at an edge where
  // nothing can respond.
  const midStop = corridor.stops[Math.floor(corridor.stops.length / 2)];
  const midVehicle = disturbanceTarget(dispatches);
  if (!midStop || !midVehicle) return [];

  switch (inputs.disturbance) {
    case 'demand_burst': {
      // The window has to be placed where the buses actually ARE, not at an
      // arbitrary point on the clock. MEASURED before this was scaled: on a
      // 164 km corridor a window of [H*, 4H*] closed roughly two hours
      // before the first bus reached the target stop, and the "disturbed"
      // run returned results byte-identical to the undisturbed one.
      const freeFlowSeconds =
        (midStop.cumulativeDistanceMeters / 1000 / inputs.cruiseSpeedKmph) * 3600;
      const centre = midVehicle.scheduledDispatchSeconds + freeFlowSeconds;
      return [
        {
          type: 'demand_burst',
          stopId: midStop.stopId,
          startSeconds: Math.max(0, centre - targetHeadwaySeconds),
          endSeconds: centre + targetHeadwaySeconds * 2,
          multiplier: 8,
        },
      ];
    }
    case 'missed_trip':
      return [{ type: 'missed_trip', vehicleId: midVehicle.vehicleId }];
    case 'gps_dropout':
      return [
        {
          type: 'gps_dropout',
          vehicleId: midVehicle.vehicleId,
          startSeconds: 0,
          endSeconds: Number.MAX_SAFE_INTEGER,
        },
      ];
    case 'non_compliance':
      return [{ type: 'non_compliance', vehicleId: midVehicle.vehicleId, complianceProbability: 0.3 }];
    case 'none':
    default:
      return [];
  }
}

function visitsByVehicle(visits: readonly StopVisitRecord[]): Map<string, StopVisitRecord[]> {
  const byVehicle = new Map<string, StopVisitRecord[]>();
  for (const visit of visits) {
    const bucket = byVehicle.get(visit.vehicleId) ?? [];
    bucket.push(visit);
    byVehicle.set(visit.vehicleId, bucket);
  }
  return byVehicle;
}

function buildFrames(
  visits: readonly StopVisitRecord[],
  dispatches: readonly TerminalDispatchPlan[],
  corridor: CorridorInputs,
  horizonSeconds: number,
): RehearsalFrame[] {
  const ruler = buildShapeRuler(corridor.shape);
  if (!ruler) return [];

  const cumulative = corridor.stops.map((stop) => stop.cumulativeDistanceMeters);
  const byVehicle = visitsByVehicle(visits);
  const dispatchByVehicle = new Map(dispatches.map((d) => [d.vehicleId, d.scheduledDispatchSeconds]));

  const frames: RehearsalFrame[] = [];
  const step = horizonSeconds / (REHEARSAL_FRAME_COUNT - 1);

  for (let frameIndex = 0; frameIndex < REHEARSAL_FRAME_COUNT; frameIndex++) {
    const atSeconds = frameIndex * step;
    const vehicles: RehearsalVehicleFrame[] = [];

    for (const [vehicleId, timeline] of byVehicle) {
      if (!isReported(vehicleId)) continue;
      const dispatchSeconds = dispatchByVehicle.get(vehicleId);
      if (dispatchSeconds === undefined) continue;
      const state = corridorStateAt(timeline, dispatchSeconds, cumulative, atSeconds);
      if (!state) continue;
      const placed = placeAlongShape(ruler, state.distanceAlongRouteMeters, corridor.totalDistanceMeters);
      if (!placed) continue;

      // The most recent visit whose arrival has happened tells us the load
      // and whether the vehicle is sitting still because of dwell or
      // because a hold was applied on top of it.
      let onboard = 0;
      let status: RehearsalVehicleFrame['status'] = 'running';
      for (const visit of timeline) {
        if (visit.arrivalSeconds > atSeconds) break;
        onboard = visit.onboardAfter;
        if (atSeconds <= visit.departureSeconds) {
          const holdStart = visit.departureSeconds - visit.appliedHoldSeconds;
          status = visit.appliedHoldSeconds > 0 && atSeconds >= holdStart ? 'held' : 'dwelling';
        } else {
          status = 'running';
        }
      }

      vehicles.push({
        vehicleId,
        distanceAlongRouteMeters: state.distanceAlongRouteMeters,
        latitude: placed.latitude,
        longitude: placed.longitude,
        headingDegrees: placed.headingDegrees,
        onboard,
        status,
      });
    }

    frames.push({ atSeconds, vehicles });
  }

  return frames;
}

/**
 * KPIs over the reported fleet only, using the same summariser the
 * regression suite scores every scenario with - not a second copy of the
 * metric definitions.
 */
/**
 * The scenario a rehearsal runs, without running it.
 *
 * Exported for `src/evaluation/`, which needs the SAME corridor-to-scenario
 * mapping across thousands of runs but none of the presentation a single
 * rehearsal produces - `buildFrames` alone would render 60 map frames per
 * arm per run, which is the dominant cost of a batch and is read by nobody
 * in a batch. Sharing the builder rather than the whole function is what
 * keeps a swept corridor and a rehearsed corridor the same corridor.
 */
/** The end of the route-direction: where journeys finish and nobody starts one. */
function isLastStop(
  stop: { sequence: number },
  stops: readonly { sequence: number }[],
): boolean {
  return stop.sequence === stops[stops.length - 1]?.sequence;
}

export function buildRehearsalScenario(
  corridor: CorridorInputs,
  inputs: ModelledInputs,
  overrides: CorridorOverrides = {},
): { scenario: ScenarioConfig; dispatches: TerminalDispatchPlan[] } {
  if (corridor.policy.targetHeadwaySeconds <= 0) {
    throw new AppError('no_active_policy', 'Corridor has no usable target headway', 404);
  }
  const routeDirection = buildRouteDirection(corridor, inputs, overrides);
  const dispatches = buildDispatches(inputs, corridor.policy.targetHeadwaySeconds);
  const disturbances = buildDisturbances(inputs, corridor, dispatches, corridor.policy.targetHeadwaySeconds);
  return {
    scenario: {
      name: `rehearsal:${corridor.routeDirectionId}:${inputs.disturbance}`,
      routeDirection,
      dispatches,
      disturbances,
      seed: inputs.seed,
    },
    dispatches,
  };
}

/** The wall-clock instant simulated second 0 maps to. Shared so a rehearsal and an evaluation run age their state identically. */
export const REHEARSAL_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

export { isReported, summarizeHolds, reportedKpis, WARMUP_VEHICLE_ID };

function reportedKpis(
  visits: readonly StopVisitRecord[],
  corridor: CorridorInputs,
): KpiSummary {
  const controlPointStopIds = new Set(
    corridor.stops.filter((stop) => stop.isControlPoint).map((stop) => stop.stopId),
  );
  return summarizeKpis(
    visits.filter((visit) => isReported(visit.vehicleId)),
    controlPointStopIds,
    corridor.policy.targetHeadwaySeconds,
    corridor.policy.bunchedThresholdRatio,
  );
}

function summarizeHolds(visits: readonly StopVisitRecord[]): { applied: number; refused: number } {
  let applied = 0;
  let refused = 0;
  for (const visit of visits) {
    applied += visit.appliedHoldSeconds;
    if (!visit.compliant) refused += visit.intendedHoldSeconds;
  }
  return { applied, refused };
}

function buildProvenance(corridor: CorridorInputs, inputs: ModelledInputs): ProvenanceEntry[] {
  const km = (meters: number) => `${(meters / 1000).toFixed(1)} km`;
  const minutes = (seconds: number) => `${(seconds / 60).toFixed(1)} min`;
  return [
    {
      field: 'Corridor geometry',
      source: 'measured',
      value: `${corridor.stops.length} stops over ${km(corridor.totalDistanceMeters)}`,
      note: 'Seeded route-direction: stop order, stop positions and distance along the route, straight from the network seed.',
    },
    {
      field: 'Control points',
      source: 'configured',
      value: `${corridor.stops.filter((s) => s.isControlPoint).length} of ${corridor.stops.length} stops`,
      note: 'route_direction_stops.is_control_point. The simulator promotes no stop of its own.',
    },
    {
      field: 'Target headway H*',
      source: 'measured',
      value: minutes(corridor.policy.targetHeadwaySeconds),
      note:
        corridor.calibrationSource === 'timetable'
          ? 'Median gap between published departures of this line-direction at one stop (getStaticData departure board).'
          : 'Median gap between published departures, bucketed by boarding stop, from the statewide origin-destination schedule.',
    },
    {
      field: 'Bunching threshold',
      source: 'measured',
      value: `${corridor.policy.bunchedThresholdRatio} x H*`,
      note: 'route_policies.bunched_threshold_ratio, the same ratio live detection uses.',
    },
    {
      field: 'Controller gains',
      source: 'measured',
      value: `Kf ${corridor.policy.kf ?? '-'}, Kb ${corridor.policy.kb ?? '-'}, k ${corridor.policy.selfEqualizingK ?? '-'}`,
      note: 'route_policies. The rehearsal runs the deployed control laws with these exact gains; it does not tune them.',
    },
    {
      field: 'Maximum hold',
      source: 'measured',
      value: `${corridor.policy.maxHoldSeconds} s`,
      note: 'route_policies.max_hold_seconds, enforced by the same hard safety filter the live decision cycle runs.',
    },
    {
      field: 'Running time between stops',
      source: 'modelled',
      value: `${inputs.cruiseSpeedKmph} km/h, ${Math.round(inputs.travelTimeVariation * 100)}% variation`,
      note: 'INVENTED. route_links is empty and there are no trip stop times, so no measured running time exists anywhere in this system.',
    },
    {
      field: 'Passenger demand',
      source: 'modelled',
      value: `${inputs.boardingRatePerMinute}/min boarding, ${Math.round(inputs.alightingFraction * 100)}% alighting`,
      note: 'INVENTED. No boarding, alighting or ticketing data is held anywhere in this system.',
    },
    {
      field: 'Occupancy',
      source: 'modelled',
      value: `capacity ${inputs.vehicleCapacity}`,
      note: 'INVENTED, and it is the honest gap this surface exists to show: vehicle_states.occupancy_count is null fleet-wide, so the deployed occupancy-weighted tier has never seen a real number.',
    },
    {
      field: 'Service pattern',
      source: 'modelled',
      value: `${inputs.vehicleCount} vehicles, one target headway apart`,
      note: 'INVENTED. A clean on-target dispatch, so any irregularity that appears was produced by the corridor and the disturbance, not by the starting conditions.',
    },
    {
      field: 'Disturbance',
      source: 'modelled',
      value: inputs.disturbance,
      note: 'INVENTED. The same four disturbance shapes the control-service regression suite uses, retargeted onto this corridor.',
    },
  ];
}

const NOT_REHEARSED: readonly string[] = [
  'Terminal dispatch regulation, unless this corridor marks its origin stop as a control point. The model can now hold a bus before it leaves the terminal, but only where the corridor says a hold may be executed there; on a corridor whose first control point is further out, that first-line law has nothing to act on.',
  'The state estimator. The simulator knows every position exactly, so map matching, the Kalman filter and the low-confidence exclusion that precede live detection never run.',
  'The command lifecycle. Cooldowns, minimum action time, acknowledgement and expiry live in the command path, which a rehearsal never touches. What you see is what the control law intends, not the rate at which instructions would reach a driver.',
  'Interaction between corridors. One route-direction at a time; buses of other routes sharing the same road are not modelled.',
];

export function runRehearsal(corridor: CorridorInputs, inputs: ModelledInputs): RehearsalResult {
  if (corridor.policy.targetHeadwaySeconds <= 0) {
    // Unreachable through loadCorridorInputs (the sentinel row is refused
    // before this point) and kept as a hard stop anyway: it is the one
    // input whose corruption would silently produce confident numbers.
    throw new AppError('no_active_policy', 'Corridor has no usable target headway', 404);
  }

  const { scenario, dispatches } = buildRehearsalScenario(corridor, inputs);

  const uncontrolled = simulate(scenario, noControlController);

  const controller = createDeployedControlLawsController({
    policy: corridor.policy,
    epochMs: REHEARSAL_EPOCH_MS,
    modelledCapacity: inputs.vehicleCapacity,
  });
  const controlled = simulate(scenario, controller);

  const horizonSeconds = Math.max(
    ...uncontrolled.visits.map((v) => v.departureSeconds),
    ...controlled.visits.map((v) => v.departureSeconds),
    1,
  );

  const reportedUncontrolled = uncontrolled.visits.filter((v) => isReported(v.vehicleId));
  const reportedControlled = controlled.visits.filter((v) => isReported(v.vehicleId));
  const uncontrolledHolds = summarizeHolds(reportedUncontrolled);
  const controlledHolds = summarizeHolds(reportedControlled);

  // A decision the occupancy tier actually SCORED, not merely one where it
  // was called. With no safe candidate to re-rank there is nothing for
  // occupancy to weigh, and counting those would inflate the denominator of
  // the contrast below with decisions occupancy could never have changed.
  const reportedDecisions = controller.decisions.filter((d) => isReported(d.vehicleId));
  const scored = reportedDecisions.filter(
    (d) => (d.occupancy?.asDeployedToday.candidates.length ?? 0) > 0,
  );
  const mean = (values: number[]): number | null =>
    values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
  const deployedOnboardCosts = scored.flatMap((d) =>
    (d.occupancy?.asDeployedToday.candidates ?? []).map((c) => c.onboardCost),
  );
  const modelledOnboardCosts = scored.flatMap((d) =>
    (d.occupancy?.withModelledOccupancy.candidates ?? []).map((c) => c.onboardCost),
  );

  return {
    corridor: {
      routeDirectionId: corridor.routeDirectionId,
      routeId: corridor.routeId,
      routeName: corridor.routeName,
      directionCode: corridor.directionCode,
      isLoop: corridor.isLoop,
      totalDistanceMeters: corridor.totalDistanceMeters,
      calibrationSource: corridor.calibrationSource,
      stops: corridor.stops,
      shape: corridor.shape,
      controlPointCount: corridor.stops.filter((s) => s.isControlPoint).length,
    },
    policy: {
      targetHeadwaySeconds: corridor.policy.targetHeadwaySeconds,
      bunchedThresholdRatio: corridor.policy.bunchedThresholdRatio,
      warningThresholdRatio: corridor.policy.warningThresholdRatio,
      kf: corridor.policy.kf,
      kb: corridor.policy.kb,
      selfEqualizingK: corridor.policy.selfEqualizingK,
      maxHoldSeconds: corridor.policy.maxHoldSeconds,
      cooldownSeconds: corridor.policy.cooldownSeconds,
      predictionHorizonControlPoints: corridor.policy.predictionHorizonControlPoints,
      occupancyCapacity: corridor.policy.occupancyCapacity,
      occupancyStaleSeconds: corridor.policy.occupancyStaleSeconds,
    },
    inputs,
    provenance: buildProvenance(corridor, inputs),
    arms: {
      uncontrolled: {
        name: uncontrolled.controllerName,
        kpis: reportedKpis(uncontrolled.visits, corridor),
        frames: buildFrames(uncontrolled.visits, dispatches, corridor, horizonSeconds),
        appliedHoldSeconds: uncontrolledHolds.applied,
        refusedHoldSeconds: uncontrolledHolds.refused,
      },
      controlled: {
        name: controlled.controllerName,
        kpis: reportedKpis(controlled.visits, corridor),
        frames: buildFrames(controlled.visits, dispatches, corridor, horizonSeconds),
        appliedHoldSeconds: controlledHolds.applied,
        refusedHoldSeconds: controlledHolds.refused,
      },
    },
    decisions: controller.decisions.filter((d) => isReported(d.vehicleId)),
    occupancyContrast: {
      decisionsScored: scored.length,
      decisionsUsingFallbackToday: scored.filter((decision) =>
        decision.occupancy?.asDeployedToday.candidates.some((c) => c.occupancyEstimated),
      ).length,
      meanOnboardCostAsDeployedToday: mean(deployedOnboardCosts),
      meanOnboardCostWithModelledOccupancy: mean(modelledOnboardCosts),
      // Counted off the SAFE, RANKED pool rather than off the advisory list.
      // The advisory is holds only and includes the closed-form optimum,
      // which is generated on nearly every decision and cannot be selected -
      // so "more than one advisory row" was never the same question as "more
      // than one candidate a ranking could reorder".
      rankingComparable: scored.some((d) => d.rankedCandidateCount > 1),
    },
    disturbedVehicleId:
      inputs.disturbance === 'none' ? null : (disturbanceTarget(dispatches)?.vehicleId ?? null),
    notRehearsed: [...NOT_REHEARSED],
    horizonSeconds,
  };
}
