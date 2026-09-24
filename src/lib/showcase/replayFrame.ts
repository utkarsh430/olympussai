/**
 * One instant of a replay, derived from the trial's trajectories.
 *
 * The simulator records a bus once per station visit: when it ARRIVED
 * (`t`), where that station is along the corridor (`d`) and how long the
 * controller held it there (`hold`). Between two visits the bus stands at
 * the first station for a dwell of `DWELL_SECONDS` plus its hold, then
 * moves to the next station at a constant speed and arrives exactly on the
 * next `t`. That is the whole kinematic model, and `frameAt` evaluates it
 * for every sampled bus at one simulated second.
 *
 * Pairs are graded the way the deployed detector grades them: a gap in
 * metres divided by the CORRIDOR'S pace (the median speed of the buses that
 * are moving), never by a standing bus's own speed - see the note in
 * `control-service/src/headway/metrics.ts` on why a divisor of zero turned
 * every dwelling pair into "fine". The ratio against the target headway is
 * then read against the corridor's own thresholds.
 *
 * Pure and allocation-light: it runs on every animation frame, for both
 * arms when the lanes are drawn. No I/O, no Date, no randomness.
 */
import type { ReplayScenarioModel } from './resolve';
import type { TrialSweepPoint, TrialTrajectory } from './trialData';
import { positionAlongRoute, type CorridorRoute, type RoutePosition } from './corridor';

export type ReplayArm = 'controlled' | 'uncontrolled';

export interface ReplayContext {
  route: CorridorRoute;
  /** The simulator's corridor length; trajectory `d` is in these metres. */
  trialCorridorLengthMeters: number;
  targetHeadwaySeconds: number;
  bunchedThresholdRatio: number;
  warningThresholdRatio: number;
}

export interface ReplayVehicle {
  id: string;
  /** 0..1 along the corridor. */
  fraction: number;
  /** The simulator's metres along ITS corridor. */
  distanceMeters: number;
  position: RoutePosition;
  moving: boolean;
  holding: boolean;
  holdRemainingSeconds: number;
  /** 1-based station sequence while standing at one, else null. */
  stopSequence: number | null;
  speedMetersPerSecond: number;
}

export type PairState = 'ok' | 'warning' | 'bunched';

export interface ReplayPair {
  leaderId: string;
  followerId: string;
  gapMeters: number;
  /** Null when the corridor has no pace to measure against. */
  headwaySeconds: number | null;
  ratio: number | null;
  state: PairState;
  leader: RoutePosition;
  follower: RoutePosition;
}

export interface ReplayHoldPulse {
  vehicleId: string;
  stopSequence: number;
  position: RoutePosition;
  remainingSeconds: number;
  totalSeconds: number;
}

export interface ReplayFrame {
  t: number;
  vehicles: ReplayVehicle[];
  pairs: ReplayPair[];
  holds: ReplayHoldPulse[];
  openIncidents: number;
  bunchedPairs: number;
  holdsServed: number;
  busesLive: number;
}

/** Seconds a bus stands at every station before any hold begins. */
export const DWELL_SECONDS = 20;

/** The latest detector sample at or before `t`, or null before the first. Points are in time order. */
export function sweepAt(points: readonly TrialSweepPoint[], t: number): TrialSweepPoint | null {
  let low = 0;
  let high = points.length - 1;
  let found: TrialSweepPoint | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const point = points[mid];
    if (!point) break;
    if (point.atSeconds <= t) {
      found = point;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * How many holds have BEGUN by `t`: station visits with a hold whose dwell
 * has elapsed. A hold in progress counts, because the readout it feeds is
 * the number the controller has acted on so far, not the number it has
 * finished with.
 */
export function holdsServedUpTo(trajectories: readonly TrialTrajectory[], t: number): number {
  let count = 0;
  for (const trajectory of trajectories) {
    for (const point of trajectory.points) {
      if (point.hold > 0 && point.t + DWELL_SECONDS <= t) count += 1;
    }
  }
  return count;
}

/** The segment index `i` with `points[i].t <= t < points[i+1].t`, or the last index at the final point. */
function segmentIndex(points: TrialTrajectory['points'], t: number): number {
  let low = 0;
  let high = points.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const point = points[mid];
    if (!point) break;
    if (point.t <= t) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * Where one bus is at `t`, or null when it is not on the road: not yet
 * dispatched (`t` before its first visit) or finished (`t` after its last).
 */
function locateVehicle(
  trajectory: TrialTrajectory,
  t: number,
  ctx: ReplayContext,
): ReplayVehicle | null {
  const points = trajectory.points;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  if (t < first.t || t > last.t) return null;

  const index = segmentIndex(points, t);
  const here = points[index];
  if (!here) return null;
  const next = points[index + 1];

  const holdBegins = here.t + DWELL_SECONDS;
  const windowEnd = holdBegins + here.hold;
  // A dwell longer than the gap to the next visit is data noise; the bus
  // simply stays until the next arrival rather than teleporting backwards.
  const departsAt = next ? Math.min(windowEnd, next.t) : windowEnd;

  if (!next || t <= departsAt) {
    const holding = here.hold > 0 && t >= holdBegins && t < departsAt;
    const position = positionAlongRoute(ctx.route, here.d, ctx.trialCorridorLengthMeters);
    return {
      id: trajectory.vehicleId,
      fraction: position.fraction,
      distanceMeters: here.d,
      position,
      moving: false,
      holding,
      holdRemainingSeconds: holding ? departsAt - t : 0,
      stopSequence: index + 1,
      speedMetersPerSecond: 0,
    };
  }

  const travel = next.t - departsAt;
  const progress = travel > 0 ? (t - departsAt) / travel : 1;
  const d = here.d + (next.d - here.d) * progress;
  const position = positionAlongRoute(ctx.route, d, ctx.trialCorridorLengthMeters);
  return {
    id: trajectory.vehicleId,
    fraction: position.fraction,
    distanceMeters: d,
    position,
    moving: true,
    holding: false,
    holdRemainingSeconds: 0,
    stopSequence: null,
    speedMetersPerSecond: travel > 0 ? Math.abs(next.d - here.d) / travel : 0,
  };
}

/** Median of a small array, sorting a copy. Zero when empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * The corridor's pace in metres per second: the median speed of the buses
 * that are moving. When none is moving - the first seconds of a scenario,
 * or a frame where every sampled bus is dwelling - fall back to the pace the
 * arm's whole trips imply, so a standing pair still gets a headway rather
 * than a fabricated one.
 */
function corridorPace(
  vehicles: readonly ReplayVehicle[],
  trajectories: readonly TrialTrajectory[],
  corridorLength: number,
): number {
  const speeds: number[] = [];
  for (const vehicle of vehicles) {
    if (vehicle.moving && vehicle.speedMetersPerSecond > 0) {
      speeds.push(vehicle.speedMetersPerSecond);
    }
  }
  const live = median(speeds);
  if (live > 0) return live;

  const durations: number[] = [];
  for (const trajectory of trajectories) {
    const first = trajectory.points[0];
    const last = trajectory.points[trajectory.points.length - 1];
    if (first && last && last.t > first.t) durations.push(last.t - first.t);
  }
  const trip = median(durations);
  return trip > 0 && corridorLength > 0 ? corridorLength / trip : 0;
}

function pairState(ratio: number | null, ctx: ReplayContext): PairState {
  if (ratio === null) return 'ok';
  if (ratio < ctx.bunchedThresholdRatio) return 'bunched';
  if (ratio < ctx.warningThresholdRatio) return 'warning';
  return 'ok';
}

/**
 * Every sampled bus, every adjacent pair and every hold in progress at `t`,
 * for one arm of a scenario.
 *
 * Vehicles are returned leader-first (descending distance), which is the
 * order the pairs are formed in. Ties are broken by id so two buses at one
 * station pair the same way on every frame.
 */
export function frameAt(
  scenario: ReplayScenarioModel,
  arm: ReplayArm,
  t: number,
  ctx: ReplayContext,
): ReplayFrame {
  const trajectories = scenario.trajectories[arm];
  const vehicles: ReplayVehicle[] = [];
  for (const trajectory of trajectories) {
    const vehicle = locateVehicle(trajectory, t, ctx);
    if (vehicle) vehicles.push(vehicle);
  }
  vehicles.sort((a, b) => b.distanceMeters - a.distanceMeters || (a.id < b.id ? -1 : 1));

  const pace = corridorPace(vehicles, trajectories, ctx.trialCorridorLengthMeters);
  const pairs: ReplayPair[] = [];
  for (let index = 1; index < vehicles.length; index += 1) {
    const leader = vehicles[index - 1];
    const follower = vehicles[index];
    if (!leader || !follower) continue;
    const gapMeters = leader.distanceMeters - follower.distanceMeters;
    const headwaySeconds = pace > 0 ? gapMeters / pace : null;
    const ratio =
      headwaySeconds !== null && ctx.targetHeadwaySeconds > 0
        ? headwaySeconds / ctx.targetHeadwaySeconds
        : null;
    pairs.push({
      leaderId: leader.id,
      followerId: follower.id,
      gapMeters,
      headwaySeconds,
      ratio,
      state: pairState(ratio, ctx),
      leader: leader.position,
      follower: follower.position,
    });
  }

  const holds: ReplayHoldPulse[] = [];
  for (const vehicle of vehicles) {
    if (!vehicle.holding || vehicle.stopSequence === null) continue;
    const trajectory = trajectories.find((entry) => entry.vehicleId === vehicle.id);
    const point = trajectory?.points[vehicle.stopSequence - 1];
    holds.push({
      vehicleId: vehicle.id,
      stopSequence: vehicle.stopSequence,
      position: vehicle.position,
      remainingSeconds: vehicle.holdRemainingSeconds,
      totalSeconds: point?.hold ?? vehicle.holdRemainingSeconds,
    });
  }

  const sweep = sweepAt(scenario.sweeps[arm], t);

  return {
    t,
    vehicles,
    pairs,
    holds,
    openIncidents: sweep?.openIncidents ?? 0,
    bunchedPairs: sweep?.bunchedPairs ?? 0,
    holdsServed: holdsServedUpTo(trajectories, t),
    busesLive: vehicles.length,
  };
}

/**
 * The buses the detector has raised at this instant: both ends of every
 * pair whose state is not `ok`. Both renderers colour a chevron by
 * membership here - red in, green out - so the verdict a bus is painted
 * with is the same on the tactical plot and on the basemap.
 */
export function raisedVehicleIds(frame: ReplayFrame): Set<string> {
  const ids = new Set<string>();
  for (const pair of frame.pairs) {
    if (pair.state === 'ok') continue;
    ids.add(pair.leaderId);
    ids.add(pair.followerId);
  }
  return ids;
}

/** The span of trial time the sampled buses occupy, with a lead-in and a tail. */
export interface ReplayWindow {
  start: number;
  end: number;
}

/** Seconds of empty corridor shown before the first sampled dispatch. */
export const REPLAY_WINDOW_LEAD_SECONDS = 300;
/** Seconds kept after the last sampled bus finishes. */
export const REPLAY_WINDOW_TAIL_SECONDS = 120;

/**
 * The window of trial time worth replaying: from shortly before the first
 * sampled bus is dispatched in either arm to shortly after the last one
 * finishes. A scenario's horizon is ~25,000 s but its ten sampled buses
 * occupy a few hours of it, so a replay that runs from zero shows an empty
 * corridor for the first two hours. `frameAt` still takes absolute trial
 * time; the scene adds `start` to its clock. Falls back to the scenario's
 * horizon when no trajectory has a point.
 */
export function replayWindow(scenario: ReplayScenarioModel): ReplayWindow {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const arm of [scenario.trajectories.uncontrolled, scenario.trajectories.controlled]) {
    for (const trajectory of arm) {
      const head = trajectory.points[0];
      const tail = trajectory.points[trajectory.points.length - 1];
      if (head && head.t < first) first = head.t;
      if (tail && tail.t > last) last = tail.t;
    }
  }
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return { start: 0, end: Math.max(0, scenario.horizonSeconds) };
  }
  const start = Math.max(0, first - REPLAY_WINDOW_LEAD_SECONDS);
  const end = Math.max(start, last + REPLAY_WINDOW_TAIL_SECONDS);
  return { start, end };
}

/** A frame with nothing on the road, for a scene with no scenario to draw. */
export function emptyFrame(t: number): ReplayFrame {
  return {
    t,
    vehicles: [],
    pairs: [],
    holds: [],
    openIncidents: 0,
    bunchedPairs: 0,
    holdsServed: 0,
    busesLive: 0,
  };
}
