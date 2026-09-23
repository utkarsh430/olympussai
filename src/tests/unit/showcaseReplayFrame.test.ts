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
const LATE_FOLLOWER: TrialTrajectory = {
  vehicleId: 'bus-2',
  points: FOLLOWER.points.map((point) => ({ ...point, t: point.t + 120 })),
};

const SCENARIO: ReplayScenarioModel = {
  id: 'steady_variability',
  title: 'Steady variability',
  note: 'Ordinary running-time noise.',
  horizonSeconds: 4000,
  vehicleCount: 2,
  trajectories: {
    controlled: [LEADER, FOLLOWER],
    uncontrolled: [LATE_LEADER, LATE_FOLLOWER],
  },
  sweeps: {
    controlled: [
      { atSeconds: 0, openIncidents: 0, bunchedPairs: 0, liveVehicles: 1 },
      { atSeconds: 60, openIncidents: 1, bunchedPairs: 1, liveVehicles: 2 },
      { atSeconds: 120, openIncidents: 2, bunchedPairs: 0, liveVehicles: 2 },
    ],
    uncontrolled: [],
  },
  netPercent: 3.1,
  excessWaitPercent: 40,
  incidentsAvoided: 2,
};

const CTX: ReplayContext = {
  route: LUCKNOW_CORRIDOR,
  trialCorridorLengthMeters: 24000,
  targetHeadwaySeconds: 360,
  bunchedThresholdRatio: 0.25,
  warningThresholdRatio: 0.5,
};