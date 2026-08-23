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

/**
 * How much longer this vehicle takes over this link than the fleet does,
 * from the disturbances aimed at it.
 *
 * Multiplicative and cumulative across disturbances, matching
 * `activeDemandBurst` above: a scenario that puts a slow bus into a
 * congested stretch gets both effects, which is the compounding case a
 * control law is least likely to handle and therefore the one most worth
 * being able to express.
 */
function travelTimeMultiplier(
  disturbances: Disturbance[],
  vehicleId: string,
  stopIndex: number,
  enteredAtSeconds: number,
): number {
  let multiplier = 1;
  for (const d of disturbances) {
    if (d.type === 'slow_vehicle') {
      if (d.vehicleId !== vehicleId) continue;
      if (stopIndex < (d.fromStopIndex ?? 0)) continue;
      if (d.toStopIndex !== undefined && stopIndex > d.toStopIndex) continue;
      multiplier *= d.multiplier;
      continue;
    }
    if (d.type === 'link_slowdown') {
      // Judged on the instant the vehicle ENTERS the link - see the variant's
      // own comment in types.ts for why a partial traversal cannot be slowed.
      if (enteredAtSeconds < d.startSeconds || enteredAtSeconds > d.endSeconds) continue;
      if (stopIndex < (d.fromStopIndex ?? 0)) continue;
      if (d.toStopIndex !== undefined && stopIndex > d.toStopIndex) continue;
      multiplier *= d.multiplier;
    }
  }
  return multiplier;
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
  /** Set when an alighting-only instruction was served here: the queue must outlive this bus's departure. */
  skipQueueSweepAtDeparture: boolean;
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
    waitWindowSeconds: 0,
    boardings: 0,
    boardingLimitedPassengers: 0,
    boardingWaitPassengerSeconds: 0,
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
  const queueClearedSeconds: Array<number | null> = routeDirection.stops.map(() => null);
  /**
   * When a bus last DEPARTED each stop, and nothing else.
   *
   * Distinct from `queueClearedSeconds` on purpose, even though the two move
   * together most of the time. That one answers "how much demand has piled
   * up here" and is advanced by arrivals as well; this one answers "how long
   * since a bus pulled out", which is the quantity terminal dispatch
   * regulation acts on (`mpc/terminalDispatch.ts`) and the one production
   * reads from `stop_visits.departed_at`. Folding them together would feed
   * the deployed law an elapsed time that a mere arrival had reset.
   */
  const lastDepartureAtStop: Array<number | null> = routeDirection.stops.map(() => null);

  const visits: StopVisitRecord[] = [];
  const geometry = corridorGeometry(routeDirection);

  /** This vehicle's booked arrival at this stop, or null when no timetable was supplied. */
  function scheduledArrival(vehicleId: string, stopIndex: number): number | null {
    const booked = config.scheduledArrivalSeconds?.[vehicleId]?.[stopIndex];
    return booked === undefined ? null : booked;
  }

  const runtimes: VehicleRuntime[] = dispatches.map((dispatch) => ({
    vehicleId: dispatch.vehicleId,
    dispatchSeconds: dispatch.scheduledDispatchSeconds,
    timeline: [],
    onboard: 0,
    phase: 'pending_dispatch',
    pendingArrivalStopIndex: 0,
    pendingArrivalSeconds: dispatch.scheduledDispatchSeconds,
    lastReleaseSeconds: dispatch.scheduledDispatchSeconds,
    skipQueueSweepAtDeparture: false,
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

  /**
   * Link travel time into `stopIndex`: the recorded value on a replay, a
   * fresh draw otherwise.
   *
   * A RECORDED value is returned untouched, disturbances included. Replay
   * mode exists to reproduce a stored day exactly (`replay.ts`), and a
   * multiplier applied on top of an observation would return a number that
   * is neither the day that happened nor a draw from the model - so a
   * scenario that wants a slowdown must model it rather than replay it.
   */
  function sampleTravelSeconds(vehicleId: string, stopIndex: number, enteredAtSeconds: number): number {
    const recorded = recordedInputs?.linkTravelSeconds[vehicleId]?.[stopIndex];
    if (recorded !== undefined) return recorded;
    const link = routeDirection.links[stopIndex];
    if (!link) return 0;
    const drawn = rng.nextNonNegativeGaussian(link.meanSeconds, link.stddevSeconds);
    return drawn * travelTimeMultiplier(disturbances, vehicleId, stopIndex, enteredAtSeconds);
  }

  function beginTransit(runtime: VehicleRuntime, vehicleIndex: number, stopIndex: number, fromSeconds: number): void {
    const travelSeconds = sampleTravelSeconds(runtime.vehicleId, stopIndex, fromSeconds);
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
      // A bus that was told to take nobody on leaves the queue exactly as it
      // found it, and that has to survive its DEPARTURE as well as its arrival.
      // Sweeping here regardless - which is what this did - erased the people
      // it had just left standing, so the action cost nothing and the follower
      // gained nothing. Both halves of the trade vanished and the lever
      // measured as free.
      if (!runtime.skipQueueSweepAtDeparture) {
        queueClearedSeconds[stopIndex] = Math.max(
          queueClearedSeconds[stopIndex] ?? event.atSeconds,
          event.atSeconds,
        );
      }
      runtime.skipQueueSweepAtDeparture = false;
      lastDepartureAtStop[stopIndex] = event.atSeconds;
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
    // How long this stop has been accumulating passengers. Read BEFORE the
    // sweep, because whether the sweep happens at all depends on a decision
    // that has not been made yet - an alighting-only instruction leaves the
    // queue standing for the bus behind.
    // NULL means no bus has called here yet, and the honest window is then ZERO,
    // not "everything since midnight".
    //
    // The engine used to start every stop's clock at simulated second 0, so the
    // first bus to reach a stop 5,000 s down the route swept up 5,000 s of
    // accumulated passengers - a queue that had been standing since before the
    // service began. `rehearsal/run.ts` works around it by running a WARM-UP bus
    // ahead of the reported fleet whose whole job is to absorb that fiction.
    //
    // It stopped being a workaround the moment the queue began PERSISTING past a
    // bus that could not take everybody: the warm-up bus cannot clear a queue it
    // has no room for, so the invented start-of-day crowd survived into the
    // reported fleet and denied-boarding counts rose fifteenfold. The fix is to
    // stop inventing the crowd. A service starts when its first bus arrives.
    const clearedAt = queueClearedSeconds[stopIndex] ?? null;
    const waitWindowSeconds = clearedAt === null ? 0 : Math.max(0, arrivalSeconds - clearedAt);

    const recordedBoardings = recordedInputs?.boardings[runtime.vehicleId]?.[stopIndex];
    const recordedAlightings = recordedInputs?.alightings[runtime.vehicleId]?.[stopIndex];

    let rawBoardings: number;
    let alightings: number;
    if (recordedBoardings !== undefined && recordedAlightings !== undefined) {
      rawBoardings = recordedBoardings;
      alightings = recordedAlightings;
    } else {
      const burstMultiplier = activeDemandBurst(disturbances, stop.stopId, arrivalSeconds);
      rawBoardings = rng.nextNonNegativeCount(
        (stop.demand.boardingRatePerMinute / 60) * waitWindowSeconds * burstMultiplier,
      );
      alightings = Math.min(onboard, rng.nextNonNegativeCount(stop.demand.alightingFraction * onboard));
    }

    const capacityAfterAlighting = Math.max(0, routeDirection.vehicleCapacity - (onboard - alightings));
    let actualBoardings = Math.min(rawBoardings, capacityAfterAlighting);
    const deniedBoardings = rawBoardings - actualBoardings;
    let boardingLimited = 0;
    /** Late arrivals the bus could not fit. They stay for the next one. */
    let lateUnserved = 0;

    // Provisional: what the dwell would be if everybody who could board did.
    // An alighting-only decision below shortens it, which is the entire point
    // of the action, so the controller is offered this value as the release
    // instant it would otherwise be measuring against.
    const dwellIfBoarding =
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
        // When a bus last departed THIS stop, which at the origin is the
        // departure headway Algorithm A regulates on. Null before any bus has
        // left - the first bus of the day has no predecessor, and production
        // reads exactly the same absence out of an empty `stop_visits`.
        previousDepartureSeconds: lastDepartureAtStop[stopIndex] ?? null,
        // Arrival plus dwell: when this bus would leave absent a hold, which
        // is the instant a departure-headway law must measure to. See the
        // field's own comment for the compounding artefact that reading
        // `now` here produced.
        readyToDepartSeconds: arrivalSeconds + dwellIfBoarding,
        onboardCount: onboard,
        // How late this bus is against its own booked arrival, when the
        // scenario booked one. Null - not zero - when it did not; see
        // `ScenarioConfig.scheduledArrivalSeconds`.
        scheduleDeviationSeconds: scheduledArrival(runtime.vehicleId, stopIndex) === null
          ? null
          : arrivalSeconds - scheduledArrival(runtime.vehicleId, stopIndex)!,
        targetHeadwaySeconds: routeDirection.targetHeadwaySeconds,
        maxHoldSeconds: routeDirection.maxHoldSeconds,
        isStateStale,
      });
      // ── ALIGHTING-ONLY ──
      //
      // Let people off, take nobody on. The bus sheds its whole boarding dwell
      // and pulls away sooner; the passengers it leaves are collected by the
      // bus behind, which gains that dwell and drops back. Both move toward
      // where they should be, and unlike every hold in this engine it makes the
      // instructed bus EARLIER rather than later.
      //
      // The queue is deliberately NOT swept: those passengers are still there,
      // still accumulating wait, and the next bus finds all of them. Sweeping
      // it would make them vanish, which would credit the action with a benefit
      // and hide its entire cost.
      if (decision.actionType === 'boarding_limit') {
        boardingLimited = actualBoardings;
        actualBoardings = 0;
      }

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

    let boardedTotal = actualBoardings;
    const dwellSeconds =
      stop.demand.baseDwellSeconds +
      stop.demand.secondsPerBoarding * actualBoardings +
      stop.demand.secondsPerAlighting * alightings;
    const departureBeforeLateBoarders = arrivalSeconds + dwellSeconds + appliedHoldSeconds;

    // ─── PEOPLE WHO ARRIVE WHILE THE BUS IS STILL THERE ─────────────────
    //
    // A bus stands at a stop for its dwell and then, if it was held, for the
    // hold on top. Passengers turning up during that time walk on. The engine
    // drew boardings ONCE, at the arrival instant, and then swept the queue to
    // the DEPARTURE instant - so everyone who arrived in between was deleted
    // without ever boarding.
    //
    // For an ordinary dwell that is a small leak. For a hold it is not, and it
    // leaked in the direction that flatters holding: a bus held ten minutes
    // absorbed ten minutes of arrivals for free, so its onboard load - and
    // therefore the onboard-delay cost of holding it, and the occupancy taper
    // that prices that cost - were all understated.
    //
    // They cost no extra dwell. During a HOLD the bus is standing anyway, and
    // during the dwell their boarding time is already in the figure above; a
    // second dwell term here would be charging twice for the same door cycle.
    let lateBoardings = 0;
    const standingSeconds = Math.max(0, departureBeforeLateBoarders - arrivalSeconds);
    if (boardingLimited === 0 && deniedBoardings === 0 && standingSeconds > 0) {
      const lateOffered =
        recordedBoardings !== undefined
          ? 0
          : rng.nextNonNegativeCount(
              (stop.demand.boardingRatePerMinute / 60) *
                standingSeconds *
                activeDemandBurst(disturbances, stop.stopId, arrivalSeconds),
            );
      const roomLeft = Math.max(
        0,
        routeDirection.vehicleCapacity - (onboard - alightings + actualBoardings),
      );
      lateBoardings = Math.min(lateOffered, roomLeft);
      boardedTotal += lateBoardings;
      // Anyone who still could not fit stays for the next bus, exactly like the
      // ones refused at the arrival instant.
      lateUnserved = lateOffered - lateBoardings;
    }

    const onboardAfter = Math.max(0, onboard - alightings + boardedTotal);

    // ─── THE QUEUE IS SWEPT ONLY AS FAR AS THE BUS ACTUALLY SERVED IT ───
    //
    // Passengers arrive uniformly across the window and board oldest-first, so
    // a bus that takes `served` of `offered` clears the OLDEST `served/offered`
    // of the window and leaves the rest standing. Anything else deletes them.
    //
    // This used to sweep to the arrival instant unconditionally, which made
    // every passenger a full bus turned away VANISH: they were counted once in
    // `deniedBoardings` and then never waited for anything, so the extra time
    // they spend on the kerb appeared in no metric at all. That is not a small
    // omission on a corridor where control is what stops buses arriving to
    // double queues - it meant a configuration that stranded three times as
    // many people scored the same on total passenger time as one that did not,
    // and the trial had no way to see the difference.
    //
    // Alighting-only is the same rule with `served` = 0, so the two cases stop
    // needing separate handling.
    const offered = rawBoardings;
    const servedFraction = offered > 0 ? actualBoardings / offered : 1;

    const previouslyCleared = clearedAt ?? arrivalSeconds;
    queueClearedSeconds[stopIndex] = Math.max(
      previouslyCleared,
      previouslyCleared + servedFraction * waitWindowSeconds,
    );
    // The departure sweep credits this bus with the people who turned up while
    // it stood there - which it may do only if it actually took them all. A bus
    // that was full at the arrival instant, that was told to take nobody on, or
    // that filled up on the late boarders, leaves the rest standing.
    runtime.skipQueueSweepAtDeparture = servedFraction < 1 || lateUnserved > 0;

    const departureSeconds = departureBeforeLateBoarders;

    const visit: StopVisitRecord = {
      vehicleId: runtime.vehicleId,
      stopId: stop.stopId,
      stopIndex,
      arrivalSeconds,
      waitWindowSeconds,
      // Everyone who got on: those waiting when it pulled in, plus those who
      // arrived while it was standing there.
      boardings: boardedTotal,
      boardingWaitPassengerSeconds:
        actualBoardings * (waitWindowSeconds / 2) + lateBoardings * (standingSeconds / 2),
      boardingLimitedPassengers: boardingLimited,
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
