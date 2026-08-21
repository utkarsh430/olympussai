// Event-based mesoscopic simulator core (blueprint 11.1). Simulates one
// route-direction's vehicles through their stop sequence, sampling
// link-level travel times and stop-level boarding/alighting demand (or
// replaying exact recorded values - see `replay.ts`), applying a
// pluggable `Controller` at control-point stops, and returning the full
// stop-visit timeline plus KPI summary.
//
// ─── ONE CLOCK, ALL VEHICLES ─────────────────────────────────────────────
//
// This engine advances every vehicle on ONE simulated clock, popping the
// earliest pending event across the whole fleet. It used to advance one
// vehicle's complete trip at a time in dispatch order, and that structure
// had a consequence far larger than its appearance: at the instant a vehicle
// was asked for a decision, the vehicle BEHIND it had not been simulated at
// all, so `ControllerKinematics.trailer` was always null, h_bwd was always
// null, and `mpc/twoWayHold.ts` - Algorithm B, the deployed two-way control
// law - declined every pair it was offered. Every simulated run exercised
// the self-equalizing fallback and nothing else, which made `kf` and `kb`
// unmeasurable: a sweep over them returned identical numbers at every point.
//
// Three event kinds, popped in (time, kind, dispatch order):
//
//   dispatch   the vehicle leaves the origin; its first link is sampled here
//   departure  it leaves a stop; its next link is sampled here
//   arrival    it reaches a stop; demand, dwell and the control decision
//
// Departures outrank arrivals at an equal timestamp so a stop is freed
// before the next bus is served there, and ties break on dispatch order so
// the leader is always processed before its follower - which is what makes
// the no-overtake bookkeeping below deterministic.
//
// Sampling happens in simulated-time order rather than vehicle order, so a
// given seed produces a different (still perfectly reproducible) draw
// sequence than the vehicle-major engine did. Replay mode is unaffected: it
// consumes recorded inputs indexed by (vehicle, stop) and draws nothing.
//
// Modeling simplifications (documented, not hidden - see
// docs/CONTROL_SERVICE_SIMULATOR.md "Scope and simplifications"):
//   - No-overtake is corridor-wide rather than per-segment: vehicles keep
//     their terminal-dispatch order for the whole route-direction, enforced
//     by the `minSeparationSeconds` clamp re-checked when each arrival is
//     popped.
//   - One route-direction per run; corridor/shared-trunk interaction
//     across route-directions is out of scope for this engine.
//   - Headway is measured stop-arrival-to-stop-arrival at control points,
//     the standard bunching metric (blueprint 11.1, "Replay mode" /
//     KPI tables).
//
// Isolation: no imports from ../db, ../state, ../routes, ../webhooks, or
// ../mpc - see the header comment in types.ts. (`../lib/dispersion.js` is
// imported by kpi.ts and is a dependency-free arithmetic module; the
// isolation guard in test/simulation/replay.test.ts names the five trees
// that carry live state, and lib/ is not one of them.)
import { Rng } from './rng.js';
import { summarizeKpis } from './kpi.js';
import { corridorStateAt } from './kinematics.js';
import type {
  Controller,
  ControllerKinematics,
  CorridorKinematicState,
  Disturbance,
  KpiSummary,
  RouteDirectionDefinition,
  ScenarioConfig,
  StopVisitRecord,
  SimulationResult,
} from './types.js';

/**
 * The corridor's real geometry, or null when it was not supplied.
 *
 * All-or-nothing on purpose. A partially-measured corridor - some stops
 * carrying a distance, some not - would let a gap be computed across a stop
 * whose position was assumed, and a gap in metres is the denominator of
 * every headway the deployed control laws act on. Either the whole corridor
 * is measured or the engine reports no kinematics at all and every
 * controller sees the documented "input unavailable" case.
 */
function corridorGeometry(
  routeDirection: RouteDirectionDefinition,
): { cumulativeDistanceMeters: number[]; totalDistanceMeters: number } | null {
  const total = routeDirection.totalDistanceMeters;
  if (total === undefined || !Number.isFinite(total) || total <= 0) return null;

  const cumulativeDistanceMeters: number[] = [];
  let previous = 0;
  for (const stop of routeDirection.stops) {
    const distance = stop.cumulativeDistanceMeters;
    if (distance === undefined || !Number.isFinite(distance) || distance < previous) return null;
    cumulativeDistanceMeters.push(distance);
    previous = distance;
  }
  return { cumulativeDistanceMeters, totalDistanceMeters: total };
}

function activeDemandBurst(
  disturbances: Disturbance[],
  stopId: string,
  atSeconds: number,
): number {
  let multiplier = 1;
  for (const d of disturbances) {
    if (d.type === 'demand_burst' && d.stopId === stopId && atSeconds >= d.startSeconds && atSeconds <= d.endSeconds) {
      multiplier *= d.multiplier;
    }
  }
  return multiplier;
}

function isMissedTrip(disturbances: Disturbance[], vehicleId: string): boolean {
  return disturbances.some((d) => d.type === 'missed_trip' && d.vehicleId === vehicleId);
}

function isGpsDropout(disturbances: Disturbance[], vehicleId: string, atSeconds: number): boolean {
  return disturbances.some(
    (d) =>
      d.type === 'gps_dropout' &&
      d.vehicleId === vehicleId &&
      atSeconds >= d.startSeconds &&
      atSeconds <= d.endSeconds,
  );
}

function complianceProbabilityFor(disturbances: Disturbance[], vehicleId: string): number | null {
  for (const d of disturbances) {
    if (d.type === 'non_compliance' && d.vehicleId === vehicleId) return d.complianceProbability;
  }
  return null;
}

// ─── Event queue ─────────────────────────────────────────────────────────
//
// A live vehicle has exactly one pending event at any moment, so the queue
// never holds more entries than there are vehicles. A sorted array with
// linear insertion is therefore both the simplest and the fastest thing
// here, and - unlike a heap - it is trivially deterministic.

type EventKind = 'dispatch' | 'departure' | 'arrival';

/** Dispatches and departures release a bus; arrivals consume what a stop has accumulated. Releases first at an equal timestamp. */
const EVENT_RANK: Record<EventKind, number> = { dispatch: 0, departure: 1, arrival: 2 };

interface SimEvent {
  atSeconds: number;
  kind: EventKind;
  /** Index into `runtimes`, which is dispatch order, which (no-overtake) is corridor order. */
  vehicleIndex: number;
  /** For `departure`, the stop being left. For `arrival`, the stop being reached. Unused for `dispatch`. */
  stopIndex: number;
}

function compareEvents(a: SimEvent, b: SimEvent): number {
  if (a.atSeconds !== b.atSeconds) return a.atSeconds - b.atSeconds;
  const rank = EVENT_RANK[a.kind] - EVENT_RANK[b.kind];
  if (rank !== 0) return rank;
  return a.vehicleIndex - b.vehicleIndex;
}

function scheduleEvent(queue: SimEvent[], event: SimEvent): void {
  let low = 0;
  let high = queue.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const at = queue[mid];
    if (at && compareEvents(at, event) <= 0) low = mid + 1;
    else high = mid;
  }
  queue.splice(low, 0, event);
}

// ─── Per-vehicle runtime ─────────────────────────────────────────────────

type VehiclePhase = 'pending_dispatch' | 'in_transit' | 'dwelling' | 'done';

interface VehicleRuntime {
  vehicleId: string;
  dispatchSeconds: number;
  timeline: StopVisitRecord[];
  onboard: number;
  phase: VehiclePhase;
  /** Where this vehicle is heading and when it is currently expected, while `in_transit`. */
  pendingArrivalStopIndex: number;
  pendingArrivalSeconds: number;
  /** When it left the previous stop (or the origin), so a realised link pace can be measured. */
  lastReleaseSeconds: number;
}

/**
 * A vehicle's position and pace at `atSeconds`, or null when it is not on the
 * corridor then.
 *
 * A vehicle in transit has no recorded visit at the stop it is heading for
 * yet, so a provisional one carrying its currently-expected arrival is
 * appended for the query. `corridorStateAt` then interpolates between the
 * last real departure and that expectation, exactly as it does between two
 * completed visits.
 *
 * The expectation can still move: the no-overtake clamp is re-checked when an
 * arrival is popped, and a clamp only ever pushes it LATER. So a position
 * read for a vehicle that is about to be clamped is a slight over-estimate,
 * bounded by what it covers in `minSeparationSeconds`. That is the same class
 * of approximation as the constant-pace assumption `kinematics.ts` already
 * documents, and it only arises between two buses that are already within one
 * separation interval of each other.
 */
function stateOf(
  runtime: VehicleRuntime,
  atSeconds: number,
  cumulativeDistanceMeters: readonly number[],
): CorridorKinematicState | null {
  if (runtime.phase === 'pending_dispatch' || runtime.phase === 'done') return null;

  const timeline =
    runtime.phase === 'in_transit'
      ? [...runtime.timeline, provisionalVisit(runtime)]
      : runtime.timeline;

  const state = corridorStateAt(
    timeline,
    runtime.dispatchSeconds,
    cumulativeDistanceMeters,
    atSeconds,
  );
  if (!state) return null;
  return { vehicleId: runtime.vehicleId, ...state };
}

/** A placeholder for the arrival a vehicle in transit has not made yet. Only its `stopIndex` and `arrivalSeconds` are ever read. */
function provisionalVisit(runtime: VehicleRuntime): StopVisitRecord {
  return {
    vehicleId: runtime.vehicleId,
    stopId: '',
    stopIndex: runtime.pendingArrivalStopIndex,
    arrivalSeconds: runtime.pendingArrivalSeconds,
    boardings: 0,
    alightings: 0,
    deniedBoardings: 0,
    onboardAfter: runtime.onboard,
    dwellSeconds: 0,
    intendedHoldSeconds: 0,
    appliedHoldSeconds: 0,
    compliant: true,
    departureSeconds: runtime.pendingArrivalSeconds,
    leaderHeadwaySeconds: null,
    isStateStale: false,
  };
}

/**
 * The nearest vehicle ahead of `index` that is on the corridor right now, and
 * the nearest one behind it.
 *
 * Searched rather than assumed to be the adjacent dispatch, because a vehicle
 * that has finished its trip or has not left the origin is not part of the
 * chain at all. That is what production does: `state-estimation/ordering.ts`
 * ranks whichever vehicles are live and links each to its neighbour in that
 * ranking, so a completed trip simply is not there to be followed.
 */
function neighbours(
  runtimes: readonly VehicleRuntime[],
  index: number,
  atSeconds: number,
  cumulativeDistanceMeters: readonly number[],
): { leader: CorridorKinematicState | null; trailer: CorridorKinematicState | null } {
  let leader: CorridorKinematicState | null = null;
  for (let i = index - 1; i >= 0; i--) {
    const runtime = runtimes[i];
    if (!runtime) continue;
    const state = stateOf(runtime, atSeconds, cumulativeDistanceMeters);
    if (state) {
      leader = state;
      break;
    }
  }

  let trailer: CorridorKinematicState | null = null;
  for (let i = index + 1; i < runtimes.length; i++) {
    const runtime = runtimes[i];
    if (!runtime) continue;
    const state = stateOf(runtime, atSeconds, cumulativeDistanceMeters);
    if (state) {
      trailer = state;
      break;
    }
  }

  return { leader, trailer };
}

/**
 * The deciding vehicle's own pace: the average over the link it has just
 * finished, which is the finest resolution this engine has (it samples a link
 * travel TIME, not a speed profile), and measured against the REALISED
 * duration so a no-overtake clamp is reflected in the pace rather than hidden.
 *
 * A zero-length link reports 0 km/h, not "unknown". That case is the origin
 * terminal - `route_direction_stops` sequence 0 sits at distance 0, so the
 * leg into it covers no ground - and a bus standing at the origin has a
 * measured speed of zero in production too (`vehicle_states.speed_kmph` on a
 * `dwelling_at_stop` vehicle). Reporting null there would make
 * `computePairHeadways` return a null h_fwd and Algorithm A - terminal
 * dispatch regulation, the highest-return lever in the blueprint - would
 * never generate a candidate in simulation, for a reason that is an artefact
 * of this engine rather than deployed behaviour.
 */
function realisedPaceKmph(linkMeters: number, durationSeconds: number): number | null {
  if (linkMeters === 0) return 0;
  if (durationSeconds <= 0) return null;
  return (linkMeters / durationSeconds) * 3.6;
}

/** Runs one scenario against one controller. Deterministic for a given (config, controller) pair - see rng.ts. */
export function simulate(config: ScenarioConfig, controller: Controller): SimulationResult {
  const { routeDirection, disturbances, recordedInputs } = config;
  validateRouteDirection(routeDirection);
  const rng = new Rng(config.seed);

  const dispatches = [...config.dispatches]
    .filter((d) => !isMissedTrip(disturbances, d.vehicleId))
    .sort((a, b) => a.scheduledDispatchSeconds - b.scheduledDispatchSeconds);

  const stopCount = routeDirection.stops.length;
  const previousArrivalAtStop: Array<number | null> = routeDirection.stops.map(() => null);
  /**
   * How far into the clock each stop's waiting queue has been swept.
   *
   * Advanced at ARRIVAL as well as at departure. Advancing it only at
   * departure - which is what a vehicle-major engine could do, because a
   * leader's whole trip finished before its follower began - credits the
   * follower with a wait window measured from a departure that has not
   * happened yet. On a corridor where two buses overlap at a stop, that is
   * the difference between the follower collecting the handful of passengers
   * who arrived since the leader pulled in and it collecting an entire
   * headway's worth that the leader has already carried away.
   */
  const queueClearedSeconds: number[] = routeDirection.stops.map(() => 0);

  const visits: StopVisitRecord[] = [];
  const geometry = corridorGeometry(routeDirection);

  const runtimes: VehicleRuntime[] = dispatches.map((dispatch) => ({
    vehicleId: dispatch.vehicleId,
    dispatchSeconds: dispatch.scheduledDispatchSeconds,
    timeline: [],
    onboard: 0,
    phase: 'pending_dispatch',
    pendingArrivalStopIndex: 0,
    pendingArrivalSeconds: dispatch.scheduledDispatchSeconds,
    lastReleaseSeconds: dispatch.scheduledDispatchSeconds,
  }));

  const queue: SimEvent[] = [];
  runtimes.forEach((runtime, vehicleIndex) => {
    scheduleEvent(queue, {
      atSeconds: runtime.dispatchSeconds,
      kind: 'dispatch',
      vehicleIndex,
      stopIndex: 0,
    });
  });

  /** Link travel time into `stopIndex`: the recorded value on a replay, a fresh draw otherwise. */
  function sampleTravelSeconds(vehicleId: string, stopIndex: number): number {
    const recorded = recordedInputs?.linkTravelSeconds[vehicleId]?.[stopIndex];
    if (recorded !== undefined) return recorded;
    const link = routeDirection.links[stopIndex];
    if (!link) return 0;
    return rng.nextNonNegativeGaussian(link.meanSeconds, link.stddevSeconds);
  }

  function beginTransit(runtime: VehicleRuntime, vehicleIndex: number, stopIndex: number, fromSeconds: number): void {
    const travelSeconds = sampleTravelSeconds(runtime.vehicleId, stopIndex);
    runtime.phase = 'in_transit';
    runtime.pendingArrivalStopIndex = stopIndex;
    runtime.pendingArrivalSeconds = fromSeconds + travelSeconds;
    runtime.lastReleaseSeconds = fromSeconds;
    scheduleEvent(queue, {
      atSeconds: runtime.pendingArrivalSeconds,
      kind: 'arrival',
      vehicleIndex,
      stopIndex,
    });
  }

  while (queue.length > 0) {
    const event = queue.shift();
    if (!event) break;
    const runtime = runtimes[event.vehicleIndex];
    if (!runtime) continue;

    if (event.kind === 'dispatch') {
      beginTransit(runtime, event.vehicleIndex, 0, event.atSeconds);
      continue;
    }

    if (event.kind === 'departure') {
      const stopIndex = event.stopIndex;
      queueClearedSeconds[stopIndex] = Math.max(queueClearedSeconds[stopIndex] ?? 0, event.atSeconds);
      const nextStopIndex = stopIndex + 1;
      if (nextStopIndex >= stopCount) {
        runtime.phase = 'done';
        continue;
      }
      beginTransit(runtime, event.vehicleIndex, nextStopIndex, event.atSeconds);
      continue;
    }

    // ── arrival ──
    const stopIndex = event.stopIndex;
    const stop = routeDirection.stops[stopIndex];
    if (!stop) {
      runtime.phase = 'done';
      continue;
    }

    // No-overtake, re-checked at the moment of arrival rather than assumed at
    // scheduling time: the vehicle ahead may have been delayed after this
    // arrival was scheduled. A clamp can only move an arrival later, so this
    // re-queue always advances the clock and cannot loop.
    const prevArrival = previousArrivalAtStop[stopIndex] ?? null;
    if (prevArrival !== null && event.atSeconds < prevArrival + routeDirection.minSeparationSeconds) {
      const clampedSeconds = prevArrival + routeDirection.minSeparationSeconds;
      runtime.pendingArrivalSeconds = clampedSeconds;
      scheduleEvent(queue, { ...event, atSeconds: clampedSeconds });
      continue;
    }

    const arrivalSeconds = event.atSeconds;
    const onboard = runtime.onboard;

    const recordedBoardings = recordedInputs?.boardings[runtime.vehicleId]?.[stopIndex];
    const recordedAlightings = recordedInputs?.alightings[runtime.vehicleId]?.[stopIndex];

    let rawBoardings: number;
    let alightings: number;
    if (recordedBoardings !== undefined && recordedAlightings !== undefined) {
      rawBoardings = recordedBoardings;
      alightings = recordedAlightings;
    } else {
      const waitWindowSeconds = Math.max(0, arrivalSeconds - (queueClearedSeconds[stopIndex] ?? 0));
      const burstMultiplier = activeDemandBurst(disturbances, stop.stopId, arrivalSeconds);
      rawBoardings = rng.nextNonNegativeCount(
        (stop.demand.boardingRatePerMinute / 60) * waitWindowSeconds * burstMultiplier,
      );
      alightings = Math.min(onboard, rng.nextNonNegativeCount(stop.demand.alightingFraction * onboard));
    }
    queueClearedSeconds[stopIndex] = Math.max(queueClearedSeconds[stopIndex] ?? 0, arrivalSeconds);

    const capacityAfterAlighting = Math.max(0, routeDirection.vehicleCapacity - (onboard - alightings));
    const actualBoardings = Math.min(rawBoardings, capacityAfterAlighting);
    const deniedBoardings = rawBoardings - actualBoardings;
    const onboardAfter = Math.max(0, onboard - alightings + actualBoardings);

    const dwellSeconds =
      stop.demand.baseDwellSeconds +
      stop.demand.secondsPerBoarding * actualBoardings +
      stop.demand.secondsPerAlighting * alightings;

    const rawLeaderHeadway = prevArrival !== null ? arrivalSeconds - prevArrival : null;
    const isStateStale = isGpsDropout(disturbances, runtime.vehicleId, arrivalSeconds);

    let intendedHoldSeconds = 0;
    let appliedHoldSeconds = 0;
    let compliant = true;

    if (stop.isControlPoint) {
      let kinematics: ControllerKinematics | null = null;
      if (geometry) {
        const followerDistance = geometry.cumulativeDistanceMeters[stopIndex];
        if (followerDistance !== undefined) {
          const previousDistance =
            stopIndex > 0 ? (geometry.cumulativeDistanceMeters[stopIndex - 1] ?? 0) : 0;
          const { leader, trailer } = neighbours(
            runtimes,
            event.vehicleIndex,
            arrivalSeconds,
            geometry.cumulativeDistanceMeters,
          );
          if (leader) {
            kinematics = {
              follower: {
                vehicleId: runtime.vehicleId,
                distanceAlongRouteMeters: followerDistance,
                speedKmph: realisedPaceKmph(
                  followerDistance - previousDistance,
                  arrivalSeconds - runtime.lastReleaseSeconds,
                ),
              },
              leader,
              trailer,
              totalDistanceMeters: geometry.totalDistanceMeters,
            };
          }
        }
      }

      const decision = controller.decide({
        routeDirectionId: routeDirection.routeDirectionId,
        stopId: stop.stopId,
        vehicleId: runtime.vehicleId,
        now: arrivalSeconds,
        leaderHeadwaySeconds: isStateStale ? null : rawLeaderHeadway,
        // Supplied even when this vehicle's state is stale, deliberately.
        // A dropped GPS feed does not delete the last known position; it
        // makes its AGE the thing that must stop a command. Handing the
        // controller nothing here would move that judgement into the
        // engine, when the deployed system's answer is a named rejection
        // reason from its own hard safety filter. `isStateStale` says
        // which case this is; refusing to act on it is the controller's
        // job, and is asserted as one in the regression suite.
        kinematics,
        // Stop index 0 is `route_direction_stops` sequence 0, the origin
        // terminal, and a bus there has not begun its trip. That is the
        // precondition Algorithm A regulates on (`mpc/terminalDispatch.ts`
        // #isAtTerminal), and the engine is the only thing that knows it.
        isTerminal: stopIndex === 0,
        onboardCount: onboard,
        targetHeadwaySeconds: routeDirection.targetHeadwaySeconds,
        maxHoldSeconds: routeDirection.maxHoldSeconds,
        isStateStale,
      });
      intendedHoldSeconds = Math.max(0, Math.min(decision.holdSeconds, routeDirection.maxHoldSeconds));

      if (intendedHoldSeconds > 0) {
        const complianceProbability = complianceProbabilityFor(disturbances, runtime.vehicleId);
        if (complianceProbability !== null && !rng.nextBoolean(complianceProbability)) {
          compliant = false;
          appliedHoldSeconds = 0;
        } else {
          appliedHoldSeconds = intendedHoldSeconds;
        }
      }
    }

    const departureSeconds = arrivalSeconds + dwellSeconds + appliedHoldSeconds;

    const visit: StopVisitRecord = {
      vehicleId: runtime.vehicleId,
      stopId: stop.stopId,
      stopIndex,
      arrivalSeconds,
      boardings: actualBoardings,
      alightings,
      deniedBoardings,
      onboardAfter,
      dwellSeconds,
      intendedHoldSeconds,
      appliedHoldSeconds,
      compliant,
      departureSeconds,
      leaderHeadwaySeconds: rawLeaderHeadway,
      isStateStale,
    };
    visits.push(visit);
    runtime.timeline.push(visit);

    previousArrivalAtStop[stopIndex] = arrivalSeconds;
    runtime.onboard = onboardAfter;
    runtime.phase = 'dwelling';
    scheduleEvent(queue, {
      atSeconds: departureSeconds,
      kind: 'departure',
      vehicleIndex: event.vehicleIndex,
      stopIndex,
    });
  }

  // Visits are produced in clock order across the fleet, which is what a
  // reader of a timeline wants; KPI math sorts per stop anyway.
  visits.sort((a, b) => a.arrivalSeconds - b.arrivalSeconds || a.vehicleId.localeCompare(b.vehicleId));

  const controlPointStopIds = new Set(
    routeDirection.stops.filter((s) => s.isControlPoint).map((s) => s.stopId),
  );
  const kpis: KpiSummary = summarizeKpis(
    visits,
    controlPointStopIds,
    routeDirection.targetHeadwaySeconds,
    routeDirection.bunchedThresholdRatio,
  );

  return { scenarioName: config.name, controllerName: controller.name, visits, kpis };
}

function validateRouteDirection(routeDirection: RouteDirectionDefinition): void {
  if (routeDirection.stops.length !== routeDirection.links.length) {
    throw new Error(
      `route-direction ${routeDirection.routeDirectionId}: stops.length (${routeDirection.stops.length}) must equal links.length (${routeDirection.links.length})`,
    );
  }
  if (routeDirection.stops.length === 0) {
    throw new Error(`route-direction ${routeDirection.routeDirectionId}: must have at least one stop`);
  }
}
