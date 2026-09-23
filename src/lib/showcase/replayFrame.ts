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