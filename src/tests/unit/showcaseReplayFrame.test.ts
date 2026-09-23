// @vitest-environment node
//
// The replay's kinematics, pinned on a two-bus fixture.
//
// A leader dispatched at 0 and a follower at 300 s, four station visits
// each, one 60 s hold on the follower's second visit. Every assertion below
// is arithmetic on those numbers: the frame is the simulator's own model of
// "stand for the dwell plus the hold, then move at constant speed", and if
// that model drifts the map draws a bus where the trial never put one.

import { describe, expect, it } from 'vitest';
import { LUCKNOW_CORRIDOR } from '@/lib/showcase/corridor';
import {
  DWELL_SECONDS,
  frameAt,
  holdsServedUpTo,
  replayWindow,
  sweepAt,
  type ReplayContext,
} from '@/lib/showcase/replayFrame';
import type { ReplayScenarioModel } from '@/lib/showcase/resolve';
import type { TrialTrajectory } from '@/lib/showcase/trialData';

const LEADER: TrialTrajectory = {
  vehicleId: 'bus-1',
  points: [
    { t: 0, d: 0, hold: 0 },
    { t: 1000, d: 1000, hold: 0 },
    { t: 2000, d: 2000, hold: 0 },
    { t: 3000, d: 3000, hold: 0 },
  ],
};

const FOLLOWER: TrialTrajectory = {
  vehicleId: 'bus-2',
  points: [
    { t: 300, d: 0, hold: 0 },
    { t: 1100, d: 1000, hold: 60 },
    { t: 2000, d: 2000, hold: 0 },
    { t: 3100, d: 3000, hold: 0 },
  ],
};

/** The other arm dispatches later, so a time before ANY dispatch exists in the fixture. */
const LATE_LEADER: TrialTrajectory = {
  vehicleId: 'bus-1',
  points: LEADER.points.map((point) => ({ ...point, t: point.t + 120 })),
};