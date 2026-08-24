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
import { drawStream } from './rng.js';
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

/**
 * Demand-weighted seconds of clock over `[fromSeconds, toSeconds)` at this
 * stop: the integral of the burst multiplier, not its value at one instant.
 *
 * ─── A WINDOW IS NOT AN INSTANT ──────────────────────────────────────────
 *
 * A bus draws its boardings from `rate x window`, and that window reaches
 * back to wherever the queue front is - one headway or more. Reading the
 * multiplier at the ARRIVAL instant and applying it to the whole window,
 * which is what this did, invents passengers at the leading edge of a burst
 * and deletes them at the trailing one.
 *
 * MEASURED on the urban corridor, a x9 surge running 11,580-12,120 s: the bus
 * arriving at 11,841 s had an 811 s window of which 261 s was inside the
 * surge, and was offered a mean of 145.9 passengers against a correct 58.0 -
 * it then denied 115 people who mostly did not exist. The bus arriving at
 * 12,402 s had a 963 s window of which 540 s was inside the surge, and was
 * offered 19.3 against a correct 105.7 - annihilating the crowd the surge had
 * actually left standing. Across the run, 6-16% of that stop's demand was
 * wrong, and the two ARMS were wrong by different amounts (-304 to +478
 * passengers), which puts the error straight into the contrast.
 *
 * Integrated piecewise so overlapping bursts still compound, which is what
 * `cascade` needs.
 */
function demandWeightedSeconds(
  disturbances: Disturbance[],
  stopId: string,
  fromSeconds: number,
  toSeconds: number,
): number {
  if (toSeconds <= fromSeconds) return 0;
  const bursts = disturbances.filter(
    (d): d is Extract<Disturbance, { type: 'demand_burst' }> =>
      d.type === 'demand_burst' &&
      d.stopId === stopId &&
      d.endSeconds > fromSeconds &&
      d.startSeconds < toSeconds,
  );
  if (bursts.length === 0) return toSeconds - fromSeconds;

  const edges = new Set<number>([fromSeconds, toSeconds]);
  for (const burst of bursts) {
    if (burst.startSeconds > fromSeconds && burst.startSeconds < toSeconds) edges.add(burst.startSeconds);
    if (burst.endSeconds > fromSeconds && burst.endSeconds < toSeconds) edges.add(burst.endSeconds);
  }
  const sorted = [...edges].sort((a, b) => a - b);

  let weighted = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i]!;
    const to = sorted[i + 1]!;
    const middle = (from + to) / 2;
    let multiplier = 1;
    for (const burst of bursts) {
      if (middle >= burst.startSeconds && middle <= burst.endSeconds) multiplier *= burst.multiplier;
    }
    weighted += (to - from) * multiplier;
  }
  return weighted;
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
  baseSeconds: number,
): number {
  // Per-VEHICLE slowdowns first: they set the pace this bus would run the leg
  // at, which is what decides how much of a congestion window it sits in.
  let multiplier = 1;
  for (const d of disturbances) {
    if (d.type !== 'slow_vehicle') continue;
    if (d.vehicleId !== vehicleId) continue;
    if (stopIndex < (d.fromStopIndex ?? 0)) continue;
    if (d.toStopIndex !== undefined && stopIndex > d.toStopIndex) continue;
    multiplier *= d.multiplier;
  }

  // ─── A WINDOW SLOWS THE PART OF THE TRAVERSE INSIDE IT ─────────────────
  //
  // This used to be judged on the ENTRY INSTANT alone: a bus entering one
  // second inside the window ran the whole 44-minute leg at x1.9, and one
  // entering a second earlier ran all of it at x1. Only the CONTROLLED arm
  // has holds, and a hold is exactly what moves a bus across that boundary.
  //
  // MEASURED on inter-city `traffic_shock`, three seeds: the entry rule
  // over-applied the slowdown by 15-29% against a traverse-overlap model,
  // and - the part that matters - the excess it invented differed BETWEEN THE
  // ARMS by 5,211 / -343 / 7,245 travel-seconds. At about forty-four
  // passengers aboard that is +63.7 h / -4.2 h / +88.6 h charged against the
  // controlled arm, on measured effects of +1,006.9 h, +400.6 h and -314.8 h.
  // On one seed the artefact was 28% of the reported loss, on the scenario
  // this trial names as the hardest case for the laws.
  //
  // The share is taken against the leg the bus would have run at its own
  // pace, not against the slowed one - a single iteration of a fixed point.
  // A bus slowed by the window sits in it slightly longer than that, so this
  // still understates a little; it is bounded by the window and no longer
  // depends on which side of an instant the bus happened to arrive.
  const vehicleLegSeconds = baseSeconds * multiplier;
  if (vehicleLegSeconds <= 0) return multiplier;
  for (const d of disturbances) {
    if (d.type !== 'link_slowdown') continue;
    if (stopIndex < (d.fromStopIndex ?? 0)) continue;
    if (d.toStopIndex !== undefined && stopIndex > d.toStopIndex) continue;
    const overlapSeconds = Math.max(
      0,
      Math.min(enteredAtSeconds + vehicleLegSeconds, d.endSeconds) -
        Math.max(enteredAtSeconds, d.startSeconds),
    );
    if (overlapSeconds <= 0) continue;
    const share = Math.min(1, overlapSeconds / vehicleLegSeconds);
    multiplier *= 1 + (d.multiplier - 1) * share;
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
    onboardDelayPassengerSeconds: 0,
    dwellPassengerSeconds: 0,
    firstTimeDeniedBoardings: 0,
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
 *
 * ─── RANKED BY POSITION, NOT BY DISPATCH ORDER ───────────────────────────
 *
 * `computeLeaderFollowerOrder` sorts by `distanceAlongRouteMeters`, so on a
 * linear route-direction production's leader ALWAYS has the larger distance.
 * `headway/metrics.ts#computeGapMeters` relies on exactly that: a follower
 * whose distance exceeds its leader's is read as the loop wrap-around and the
 * gap is folded round the corridor.
 *
 * This used to walk outwards in dispatch order and take the first live
 * vehicle either side, which is the same thing ONLY while dispatch order and
 * corridor order agree. They come apart routinely: the arrival clamp below
 * enforces a minimum SEPARATION at each stop, not an ORDER, so a follower
 * whose leader is standing through a long dwell or a hold passes it and keeps
 * the lead. MEASURED across ten scenarios x three seeds, the deciding bus was
 * handed a "leader" that was physically BEHIND it on 1.5% of urban decisions
 * and 4.8% of inter-city ones - and because the corridor is linear rather
 * than a loop, `computeGapMeters` turned each of those into a fabricated gap
 * of very nearly the whole route (379 km of a 400 km corridor). A pair that
 * had just crossed - the deepest bunch there is - was reported to the control
 * laws as the most generous gap on the corridor, and every law declined it.
 *
 * So the chain is ranked here the way production ranks it. Ties go to the
 * lower dispatch index, which keeps the choice deterministic; a vehicle at
 * exactly the deciding bus's distance is ahead of it for this purpose, which
 * is the honest reading of two buses occupying the same stop.
 */
function neighbours(
  runtimes: readonly VehicleRuntime[],
  index: number,
  atSeconds: number,
  cumulativeDistanceMeters: readonly number[],
  isVisible: (vehicleId: string) => boolean,
  selfDistanceMeters: number,
): {
  leader: CorridorKinematicState | null;
  trailer: CorridorKinematicState | null;
  /** Everyone else visible on the corridor right now - see `ControllerKinematics.corridor`. */
  others: CorridorKinematicState[];
} {
  let leader: CorridorKinematicState | null = null;
  let trailer: CorridorKinematicState | null = null;
  const others: CorridorKinematicState[] = [];

  for (let i = 0; i < runtimes.length; i++) {
    if (i === index) continue;
    const runtime = runtimes[i];
    if (!runtime) continue;
    if (!isVisible(runtime.vehicleId)) continue;
    const state = stateOf(runtime, atSeconds, cumulativeDistanceMeters);
    if (!state) continue;
    others.push(state);

    if (state.distanceAlongRouteMeters >= selfDistanceMeters) {
      // Ahead: keep the CLOSEST one ahead, which is the leader.
      if (leader === null || state.distanceAlongRouteMeters < leader.distanceAlongRouteMeters) {
        leader = state;
      }
    } else if (
      trailer === null ||
      state.distanceAlongRouteMeters > trailer.distanceAlongRouteMeters
    ) {
      // Behind: keep the closest one behind.
      trailer = state;
    }
  }

  return { leader, trailer, others };
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
  // Every draw below takes a stream of its OWN, keyed by what it is for - see
  // `rng.ts#drawStream`. A single stream makes the two arms of a trial diverge
  // at the first hold, because a hold changes how many draws are taken and in
  // what order.
  const seed = config.seed;

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
   * How far into the clock each stop's arrivals have been OFFERED a bus,
   * whether or not one took them.
   *
   * Distinct from `queueClearedSeconds`, which is how far they have been
   * CARRIED. The gap between the two is the standing queue, and the two
   * watermarks are what separate a refusal EVENT from a person refused: a
   * passenger a full bus turns away stays in the window and is offered to the
   * next bus, and to the one after that, and `deniedBoardings` counts each of
   * those. Three buses passing one stranded passenger reports three denials.
   * Against `boardings`, which counts people once, that inflates the
   * denied-share the saturation warning is drawn at.
   */
  const queueOfferedSeconds: Array<number | null> = routeDirection.stops.map(() => null);
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
    const drawn = drawStream(seed, 'link', vehicleId, stopIndex).nextNonNegativeGaussian(
      link.meanSeconds,
      link.stddevSeconds,
    );
    return drawn * travelTimeMultiplier(disturbances, vehicleId, stopIndex, enteredAtSeconds, drawn);
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
      // The stop's queue is NOT swept here. Everything this bus took - the
      // people already waiting and the people who turned up while it stood
      // there - was claimed when it arrived, because that is the moment the
      // claim has to be visible to the next bus in. A second sweep here
      // erased whatever a bus that arrived in the meantime had left standing,
      // and it erased it in proportion to how long this one was HELD.
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
      // The whole accumulation window, weighted by whatever surge covered each
      // part of it - never the multiplier at the arrival instant.
      rawBoardings = drawStream(seed, 'boardings', runtime.vehicleId, stopIndex).nextNonNegativeCount(
        (stop.demand.boardingRatePerMinute / 60) *
          demandWeightedSeconds(
            disturbances,
            stop.stopId,
            arrivalSeconds - waitWindowSeconds,
            arrivalSeconds,
          ),
      );
      alightings = Math.min(
        onboard,
        drawStream(seed, 'alightings', runtime.vehicleId, stopIndex).nextNonNegativeCount(
          stop.demand.alightingFraction * onboard,
        ),
      );
    }

    const capacityAfterAlighting = Math.max(0, routeDirection.vehicleCapacity - (onboard - alightings));
    let actualBoardings = Math.min(rawBoardings, capacityAfterAlighting);
    const deniedBoardings = rawBoardings - actualBoardings;
    let boardingLimited = 0;

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
          // ─── A NEIGHBOUR NOBODY CAN SEE IS NOT A NEIGHBOUR ───────────
          //
          // Production's state estimator drops a low-confidence vehicle from
          // the leader/follower chain BEFORE any headway is computed
          // (`state-estimation/ordering.ts`), so the buses either side of it
          // are linked to each other. This engine was handing a bus whose feed
          // had gone dark straight to the controller as a leader, complete
          // with an exact position and a fresh timestamp - the one thing
          // production guarantees cannot happen. The deciding vehicle's own
          // staleness was modelled; its neighbours' was not.
          const { leader, trailer, others } = neighbours(
            runtimes,
            event.vehicleIndex,
            arrivalSeconds,
            geometry.cumulativeDistanceMeters,
            (vehicleId) => !isGpsDropout(disturbances, vehicleId, arrivalSeconds),
            // The deciding bus is standing AT this stop, so its position is
            // the stop's own - the same exact value handed to the controller
            // as `follower.distanceAlongRouteMeters` below, so the chain it
            // receives is ranked against the position it is told about.
            followerDistance,
          );
          if (leader) {
            const follower: CorridorKinematicState = {
              vehicleId: runtime.vehicleId,
              distanceAlongRouteMeters: followerDistance,
              speedKmph: realisedPaceKmph(
                followerDistance - previousDistance,
                arrivalSeconds - runtime.lastReleaseSeconds,
              ),
            };
            kinematics = {
              follower,
              leader,
              trailer,
              // The deciding bus is part of its own corridor. Its position
              // here is the stop's exact distance rather than the
              // interpolation `stateOf` would produce, which is the same
              // value `follower` carries - a chain that disagreed with the
              // pair row built from it would rank the deciding vehicle
              // against a position it was never told about.
              corridor: [follower, ...others],
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
        if (
          complianceProbability !== null &&
          !drawStream(seed, 'compliance', runtime.vehicleId, stopIndex).nextBoolean(
            complianceProbability,
          )
        ) {
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
    //
    // ─── AND ONLY THE PART OF THE CLOCK NOBODY ELSE HAS ─────────────────
    //
    // The window starts at the queue front, not at this bus's arrival. Two
    // buses stand at one stop routinely - the arrival clamp enforces a
    // minimum SEPARATION, not a berth - and a bus arriving into a stop its
    // leader is still standing at would otherwise draw a second, independent
    // set of passengers out of seconds the leader has already claimed.
    // MEASURED over ten scenarios x three seeds, 5.4% of the urban corridor's
    // stop-clock was offered to two buses at once with nobody controlling and
    // 3.1% with the controller running, so about 5% of the uncontrolled arm's
    // boardings and 3% of the controlled arm's were passengers the model had
    // invented - and the difference went straight into the contrast between
    // the arms, which is the entire output of this trial.
    let lateBoardings = 0;
    let lateOffered = 0;
    const standingFromSeconds = Math.max(arrivalSeconds, clearedAt ?? arrivalSeconds);
    const standingSeconds = Math.max(0, departureBeforeLateBoarders - standingFromSeconds);
    // A bus told to take nobody on takes nobody on while it stands there
    // either, and one that was already full has no room for them.
    const takesLateBoarders = boardingLimited === 0 && deniedBoardings === 0 && standingSeconds > 0;
    if (takesLateBoarders) {
      lateOffered =
        recordedBoardings !== undefined
          ? 0
          : drawStream(seed, 'lateBoardings', runtime.vehicleId, stopIndex).nextNonNegativeCount(
              (stop.demand.boardingRatePerMinute / 60) *
                demandWeightedSeconds(
                  disturbances,
                  stop.stopId,
                  standingFromSeconds,
                  departureBeforeLateBoarders,
                ),
            );
      const roomLeft = Math.max(
        0,
        routeDirection.vehicleCapacity - (onboard - alightings + actualBoardings),
      );
      lateBoardings = Math.min(lateOffered, roomLeft);
      boardedTotal += lateBoardings;
      // Anyone who still could not fit stays for the next bus, exactly like the
      // ones refused at the arrival instant - which is what the served
      // fraction below leaves behind rather than a flag of its own.
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
    //
    // ─── AND THE WHOLE CLAIM IS MADE HERE, NOT AT DEPARTURE ─────────────
    //
    // The standing window used to be claimed by a second sweep on the
    // departure event, which is far too late: between this bus's arrival and
    // its departure another bus can arrive, read a queue front that has not
    // moved, and be offered the same seconds over again. Claiming it now
    // makes the front monotone in the order events actually happen, so the
    // next bus in sees exactly what is left - which for a bus pulling in
    // behind one that is still loading is nothing, the honest reading of two
    // buses at one stop.
    const offered = rawBoardings;
    const servedFraction = offered > 0 ? actualBoardings / offered : 1;
    const standingServedFraction = lateOffered > 0 ? lateBoardings / lateOffered : 1;

    // ─── HOW MANY OF THOSE REFUSALS WERE NEW PEOPLE ────────────────────
    //
    // Boarding is oldest-first, so the refused are the YOUNGEST part of the
    // window - those who arrived after `cleared + servedFraction x W`. Of
    // them, only the ones past `queueOfferedSeconds` are being refused for
    // the first time; the rest were already refused by an earlier bus and are
    // being counted again.
    const previouslyOffered = queueOfferedSeconds[stopIndex] ?? arrivalSeconds;
    const deniedFromSeconds = (clearedAt ?? arrivalSeconds) + servedFraction * waitWindowSeconds;
    const deniedWindowSeconds = Math.max(0, arrivalSeconds - deniedFromSeconds);
    const firstTimeWindowSeconds = Math.max(
      0,
      arrivalSeconds - Math.max(deniedFromSeconds, previouslyOffered),
    );
    const firstTimeShare =
      deniedWindowSeconds > 0 ? firstTimeWindowSeconds / deniedWindowSeconds : 1;
    // Anyone the bus filled up on during its own standing window is a refusal
    // too, and always a new one - that stretch of clock had never been
    // offered to anybody.
    const lateUnserved = takesLateBoarders ? Math.max(0, lateOffered - lateBoardings) : 0;
    const firstTimeDeniedBoardings =
      Math.round(deniedBoardings * firstTimeShare) + lateUnserved;
    queueOfferedSeconds[stopIndex] = Math.max(previouslyOffered, arrivalSeconds, departureBeforeLateBoarders);

    const previouslyCleared = clearedAt ?? arrivalSeconds;
    let clearedTo = previouslyCleared + servedFraction * waitWindowSeconds;
    if (takesLateBoarders) {
      clearedTo = Math.max(
        clearedTo,
        standingFromSeconds + standingServedFraction * standingSeconds,
      );
    }
    queueClearedSeconds[stopIndex] = Math.max(previouslyCleared, clearedTo);

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
      // ─── OLDEST FIRST, SO A TRUNCATED QUEUE WAITED LONGER ────────────
      //
      // Passengers arrive uniformly across a window of W seconds and board
      // oldest first, so a bus that takes the fraction `f` of them takes the
      // ones who arrived in the first `fW` - whose mean wait is `W(1 - f/2)`,
      // not `W/2`. The two agree only when the bus takes everybody.
      //
      // Charged at `W/2` regardless, a bus that took 4 of 10 was billed
      // 4 x 180 s on a 360 s window where the truth is 4 x 288 s. The people
      // it left behind are charged correctly by the NEXT bus, so the error
      // lives entirely on the visit that truncated the queue - and a bus
      // truncates a queue because it is full, which the uncontrolled arm does
      // more often. Same arithmetic for the standing window, where the ones
      // who fit are again the ones who have been there longest.
      boardingWaitPassengerSeconds:
        actualBoardings * waitWindowSeconds * (1 - servedFraction / 2) +
        lateBoardings * standingSeconds * (1 - standingServedFraction / 2),
      // Everybody aboard when this bus would have pulled away, times the
      // hold. The late boarders are excluded deliberately - see the field.
      onboardDelayPassengerSeconds: appliedHoldSeconds * Math.max(0, onboardAfter - lateBoardings),
      // The same population through the ordinary door cycle.
      dwellPassengerSeconds: dwellSeconds * Math.max(0, onboardAfter - lateBoardings),
      boardingLimitedPassengers: boardingLimited,
      alightings,
      deniedBoardings: deniedBoardings + lateUnserved,
      firstTimeDeniedBoardings,
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
