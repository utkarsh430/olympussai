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

describe('frameAt', () => {
  it('has nobody on the road before the first dispatch', () => {
    const frame = frameAt(SCENARIO, 'uncontrolled', 60, CTX);
    expect(frame.vehicles).toEqual([]);
    expect(frame.busesLive).toBe(0);
    expect(frame.pairs).toEqual([]);
  });

  it('holds the leader alone until the follower is dispatched', () => {
    const frame = frameAt(SCENARIO, 'controlled', 100, CTX);
    expect(frame.vehicles.map((vehicle) => vehicle.id)).toEqual(['bus-1']);
  });

  it('drops a bus once it has finished', () => {
    const frame = frameAt(SCENARIO, 'controlled', 3050, CTX);
    expect(frame.vehicles.map((vehicle) => vehicle.id)).toEqual(['bus-2']);
  });

  it('stands at the station for the dwell, then interpolates linearly to the next', () => {
    const standing = frameAt(SCENARIO, 'controlled', 10, CTX).vehicles.find(
      (vehicle) => vehicle.id === 'bus-1',
    );
    expect(standing?.moving).toBe(false);
    expect(standing?.distanceMeters).toBe(0);
    expect(standing?.stopSequence).toBe(1);
    expect(standing?.speedMetersPerSecond).toBe(0);

    // Departs at 20 s, arrives at 1000 s: 480 of the 980 travel seconds elapsed.
    const moving = frameAt(SCENARIO, 'controlled', 500, CTX).vehicles.find(
      (vehicle) => vehicle.id === 'bus-1',
    );
    expect(moving?.moving).toBe(true);
    expect(moving?.stopSequence).toBeNull();
    expect(moving?.distanceMeters).toBeCloseTo((1000 * (500 - DWELL_SECONDS)) / 980, 6);
    expect(moving?.speedMetersPerSecond).toBeCloseTo(1000 / 980, 6);
    expect(moving?.fraction).toBeCloseTo((moving?.distanceMeters ?? 0) / 24000, 9);
    expect(moving?.position.headingDegrees).toBeGreaterThanOrEqual(0);
    expect(moving?.position.headingDegrees).toBeLessThan(360);
  });

  it('marks the follower as holding inside its hold window and raises a pulse at that stop', () => {
    // Arrived 1100, dwell to 1120, held until 1180.
    const dwelling = frameAt(SCENARIO, 'controlled', 1110, CTX).vehicles.find(
      (vehicle) => vehicle.id === 'bus-2',
    );
    expect(dwelling?.holding).toBe(false);
    expect(dwelling?.moving).toBe(false);

    const frame = frameAt(SCENARIO, 'controlled', 1150, CTX);
    const held = frame.vehicles.find((vehicle) => vehicle.id === 'bus-2');
    expect(held?.holding).toBe(true);
    expect(held?.moving).toBe(false);
    expect(held?.holdRemainingSeconds).toBe(30);
    expect(held?.stopSequence).toBe(2);
    expect(frame.holds).toHaveLength(1);
    expect(frame.holds[0]).toMatchObject({
      vehicleId: 'bus-2',
      stopSequence: 2,
      remainingSeconds: 30,
      totalSeconds: 60,
    });
    expect(frame.holds[0]?.position.latitude).toBe(held?.position.latitude);

    const released = frameAt(SCENARIO, 'controlled', 1181, CTX).vehicles.find(
      (vehicle) => vehicle.id === 'bus-2',
    );
    expect(released?.holding).toBe(false);
    expect(released?.moving).toBe(true);
    expect(frameAt(SCENARIO, 'controlled', 1181, CTX).holds).toEqual([]);
  });

  it('orders vehicles leader-first and grades a tiny gap as bunched', () => {
    // At 2000 s both buses arrive at the third station: gap zero.
    const frame = frameAt(SCENARIO, 'controlled', 2000, CTX);
    expect(frame.vehicles.map((vehicle) => vehicle.id)).toEqual(['bus-1', 'bus-2']);
    expect(frame.pairs).toHaveLength(1);
    const pair = frame.pairs[0];
    expect(pair?.leaderId).toBe('bus-1');
    expect(pair?.followerId).toBe('bus-2');
    expect(pair?.gapMeters).toBe(0);
    // Nobody is moving, so the pace falls back to the arm's trips: a real
    // number, not null, and the headway is zero against it.
    expect(pair?.headwaySeconds).toBe(0);
    expect(pair?.ratio).toBe(0);
    expect(pair?.state).toBe('bunched');
  });

  it('grades a comfortable gap as ok and a middling one as warning', () => {
    // At 500 s both are moving: the leader ~490 m out, the follower ~231 m.
    // A 259 m gap at the median pace of ~1.15 m/s is ~225 s, above half of
    // the 360 s target.
    const ok = frameAt(SCENARIO, 'controlled', 500, CTX).pairs[0];
    expect(ok?.state).toBe('ok');
    expect(ok?.ratio ?? 0).toBeGreaterThan(CTX.warningThresholdRatio);

    // At 1150 s the follower is held at 1000 m and the leader is ~133 m
    // further on at ~1.02 m/s: ~130 s of headway, between a quarter and half
    // of 360 s.
    const warning = frameAt(SCENARIO, 'controlled', 1150, CTX).pairs[0];
    expect(warning?.state).toBe('warning');
    expect(warning?.ratio ?? 0).toBeGreaterThan(CTX.bunchedThresholdRatio);
    expect(warning?.ratio ?? 1).toBeLessThan(CTX.warningThresholdRatio);
  });

  it('reads incident counts from the latest sweep and counts holds served', () => {
    const before = frameAt(SCENARIO, 'controlled', 30, CTX);
    expect(before.openIncidents).toBe(0);
    expect(before.bunchedPairs).toBe(0);
    expect(before.holdsServed).toBe(0);

    const during = frameAt(SCENARIO, 'controlled', 1150, CTX);
    expect(during.openIncidents).toBe(2);
    expect(during.holdsServed).toBe(1);

    // The other arm has no sweeps at all: zero, never a throw.
    const silent = frameAt(SCENARIO, 'uncontrolled', 1150, CTX);
    expect(silent.openIncidents).toBe(0);
    expect(silent.bunchedPairs).toBe(0);
  });
});

describe('sweepAt', () => {
  const points = SCENARIO.sweeps.controlled;

  it('returns the latest sample at or before t', () => {
    expect(sweepAt(points, 90)?.atSeconds).toBe(60);
    expect(sweepAt(points, 60)?.atSeconds).toBe(60);
    expect(sweepAt(points, 1000)?.atSeconds).toBe(120);
    expect(sweepAt(points, 0)?.atSeconds).toBe(0);
  });

  it('is null before the first sample and over an empty series', () => {
    expect(sweepAt(points, -1)).toBeNull();
    expect(sweepAt([], 500)).toBeNull();
  });
});

describe('replayWindow', () => {
  it('spans the sampled buses across both arms, with a lead-in floored at zero and a tail', () => {
    // The controlled leader dispatches at 0; the late uncontrolled follower finishes at 3220.
    expect(replayWindow(SCENARIO)).toEqual({ start: 0, end: 3220 + 120 });
  });

  it('starts shortly before the first dispatch when the sample begins hours in', () => {
    const shifted: ReplayScenarioModel = {
      ...SCENARIO,
      trajectories: {
        controlled: [
          { ...LEADER, points: LEADER.points.map((point) => ({ ...point, t: point.t + 7920 })) },
        ],
        uncontrolled: [],
      },
    };
    expect(replayWindow(shifted)).toEqual({ start: 7920 - 300, end: 7920 + 3000 + 120 });
  });

  it('falls back to the horizon when nothing was sampled', () => {
    const empty: ReplayScenarioModel = {
      ...SCENARIO,
      trajectories: { controlled: [], uncontrolled: [] },
    };
    expect(replayWindow(empty)).toEqual({ start: 0, end: 4000 });
  });
});

describe('holdsServedUpTo', () => {
  const trajectories = [LEADER, FOLLOWER];

  it('counts a hold once its window has started', () => {
    expect(holdsServedUpTo(trajectories, 1119)).toBe(0);
    expect(holdsServedUpTo(trajectories, 1120)).toBe(1);
    expect(holdsServedUpTo(trajectories, 5000)).toBe(1);
  });

  it('ignores visits with no hold', () => {
    expect(holdsServedUpTo([LEADER], 5000)).toBe(0);
  });
});
