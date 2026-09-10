import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computePairHeadways } from '../src/headway/metrics.js';
import { computeLeaderFollowerOrder } from '../src/state-estimation/ordering.js';
import {
  DEFAULT_PLAUSIBILITY_CONFIG,
  PositionPlausibilityTracker,
  type PositionSample,
} from '../src/state-estimation/positionPlausibility.js';
import type { VehicleOrderingInput } from '../src/state-estimation/types.js';

const PACE_KMPH = 20;
const PACE_MPS = PACE_KMPH / 3.6;
const DT = 30;

/** A corridor of honest buses, so the tracker always has a pace to judge against. */
function honestFleet(step: number, count = 6): PositionSample[] {
  return Array.from({ length: count }, (_, i) => ({
    vehicleId: `HONEST-${i}`,
    distanceAlongRouteMeters: i * 1_000 + step * DT * PACE_MPS,
    speedKmph: PACE_KMPH,
  }));
}

describe('position plausibility: a healthy feed is never rejected', () => {
  it('does not reject a vehicle whose displacement matches its own reported speed', () => {
    const tracker = new PositionPlausibilityTracker();
    for (let step = 0; step < 60; step++) {
      const verdicts = tracker.observe(step * DT, honestFleet(step));
      for (const verdict of verdicts.values()) {
        expect(verdict.isImplausible).toBe(false);
      }
    }
    expect(tracker.audit().implausibleVehicleIds.size).toBe(0);
  });

  it('does not reject a vehicle that dwells, then resumes at the corridor pace', () => {
    const tracker = new PositionPlausibilityTracker();
    let distance = 5_000;
    for (let step = 0; step < 40; step++) {
      // Ten samples of standing at a stop in the middle of the run, which is
      // the state every hold is executed from.
      const dwelling = step >= 15 && step < 25;
      if (!dwelling) distance += DT * PACE_MPS;
      const verdicts = tracker.observe(step * DT, [
        ...honestFleet(step),
        {
          vehicleId: 'DWELLER',
          distanceAlongRouteMeters: distance,
          speedKmph: dwelling ? 0 : PACE_KMPH,
        },
      ]);
      expect(verdicts.get('DWELLER')!.isImplausible).toBe(false);
    }
  });

  it('has no opinion when the vehicle reports no speed and nothing on the corridor moves', () => {
    const tracker = new PositionPlausibilityTracker();
    for (let step = 0; step < 20; step++) {
      const verdicts = tracker.observe(step * DT, [
        { vehicleId: 'SILENT', distanceAlongRouteMeters: step * 900, speedKmph: null },
      ]);
      const verdict = verdicts.get('SILENT')!;
      expect(verdict.isImplausible).toBe(false);
      if (step > 0) expect(verdict.reason).toBe('no_reference_speed');
    }
  });

  it('starts again rather than inferring across a gap in the feed', () => {
    const tracker = new PositionPlausibilityTracker();
    tracker.observe(0, [{ vehicleId: 'GAPPY', distanceAlongRouteMeters: 0, speedKmph: PACE_KMPH }]);
    // Away for longer than anything can be inferred across, and back a long
    // way down the route - exactly where it would be if it had kept running.
    const verdicts = tracker.observe(
      DEFAULT_PLAUSIBILITY_CONFIG.maxSampleGapSeconds + 60,
      [{ vehicleId: 'GAPPY', distanceAlongRouteMeters: 9_000, speedKmph: PACE_KMPH }],
    );
    expect(verdicts.get('GAPPY')!.reason).toBe('unjudged');
    expect(verdicts.get('GAPPY')!.isImplausible).toBe(false);
  });
});

describe('position plausibility: the three shapes of a lying feed', () => {
  /**
   * `blind_slowdown`'s shape. A constant along-route offset that arrives when
   * the bus reaches a mis-mapped stretch and clears when it leaves it - so it
   * produces ONE jump and then looks perfectly stable, which is the property
   * the scenario was built around.
   */
  it('rejects a constant offset when it arrives, and keeps rejecting while it lasts', () => {
    const tracker = new PositionPlausibilityTracker();
    const offset = 5_000;
    let rejectedAtOnset = false;
    for (let step = 0; step < 30; step++) {
      const biased = step >= 10;
      const verdicts = tracker.observe(step * DT, [
        ...honestFleet(step),
        {
          vehicleId: 'SNAPPED',
          distanceAlongRouteMeters: step * DT * PACE_MPS + (biased ? offset : 0),
          speedKmph: PACE_KMPH,
        },
      ]);
      const verdict = verdicts.get('SNAPPED')!;
      if (step < 10) expect(verdict.isImplausible).toBe(false);
      if (step === 10) rejectedAtOnset = verdict.isImplausible;
      // The whole point: still rejected long after the jump stopped being new.
      if (step >= 10) expect(verdict.isImplausible).toBe(true);
    }
    expect(rejectedAtOnset).toBe(true);
  });

  it('supplies a fallback position that tracks the truth while the offset lasts', () => {
    const tracker = new PositionPlausibilityTracker();
    const offset = 5_000;
    for (let step = 0; step < 25; step++) {
      const truth = step * DT * PACE_MPS;
      const verdicts = tracker.observe(step * DT, [
        ...honestFleet(step),
        {
          vehicleId: 'SNAPPED',
          distanceAlongRouteMeters: truth + (step >= 10 ? offset : 0),
          speedKmph: PACE_KMPH,
        },
      ]);
      const verdict = verdicts.get('SNAPPED')!;
      if (step >= 11) {
        expect(verdict.isImplausible).toBe(true);
        // Within one sample's travel of where the bus actually is, against a
        // reported position 5 km away from it.
        expect(Math.abs(verdict.believedDistanceAlongRouteMeters - truth)).toBeLessThan(
          DT * PACE_MPS,
        );
      }
    }
  });

  it('trusts the vehicle again once the offset clears - a correction, not a ban', () => {
    const tracker = new PositionPlausibilityTracker();
    const offset = 5_000;
    let trustedAgain = false;
    for (let step = 0; step < 30; step++) {
      const biased = step >= 10 && step < 20;
      const verdicts = tracker.observe(step * DT, [
        ...honestFleet(step),
        {
          vehicleId: 'SNAPPED',
          distanceAlongRouteMeters: step * DT * PACE_MPS + (biased ? offset : 0),
          speedKmph: PACE_KMPH,
        },
      ]);
      if (step >= 25) trustedAgain ||= !verdicts.get('SNAPPED')!.isImplausible;
    }
    expect(trustedAgain).toBe(true);
  });

  /**
   * `frozen_feed`'s shape. The modem republishes the last fix with a current
   * timestamp, so the age-based guard sees nothing wrong; the reported speed
   * is frozen with it, and it is the disagreement between a speed that says
   * "moving" and a position that says "not" which gives the lie away.
   */
  it('rejects a frozen feed, whose position stops while its speed says it has not', () => {
    const tracker = new PositionPlausibilityTracker();
    const frozenAt = 10 * DT * PACE_MPS;
    let rejected = false;
    for (let step = 0; step < 40; step++) {
      const frozen = step >= 10;
      const verdicts = tracker.observe(step * DT, [
        ...honestFleet(step),
        {
          vehicleId: 'FROZEN',
          distanceAlongRouteMeters: frozen ? frozenAt : step * DT * PACE_MPS,
          speedKmph: PACE_KMPH,
        },
      ]);
      rejected ||= verdicts.get('FROZEN')!.isImplausible;
    }
    expect(rejected).toBe(true);
  });
});

describe('position plausibility: what the correction removes it from', () => {
  it('drops a rejected vehicle out of the chain and links its neighbours to each other', () => {
    const inputs: VehicleOrderingInput[] = [
      { vehicleId: 'A', routeDirectionId: 'rd', distanceAlongRouteMeters: 3_000, isLowConfidence: false },
      { vehicleId: 'B', routeDirectionId: 'rd', distanceAlongRouteMeters: 2_000, isLowConfidence: false, isImplausiblePosition: true },
      { vehicleId: 'C', routeDirectionId: 'rd', distanceAlongRouteMeters: 1_000, isLowConfidence: false },
    ];
    const ordered = computeLeaderFollowerOrder(inputs, { isLoop: false, totalDistanceMeters: 10_000 });
    const byId = new Map(ordered.map((v) => [v.vehicleId, v]));
    expect(byId.get('B')!.rank).toBe(-1);
    expect(byId.get('A')!.followerVehicleId).toBe('C');
    expect(byId.get('C')!.leaderVehicleId).toBe('A');
  });

  it('is byte-identical when no vehicle carries the flag', () => {
    const inputs: VehicleOrderingInput[] = [
      { vehicleId: 'A', routeDirectionId: 'rd', distanceAlongRouteMeters: 3_000, isLowConfidence: false },
      { vehicleId: 'B', routeDirectionId: 'rd', distanceAlongRouteMeters: 2_000, isLowConfidence: false },
    ];
    const withField = computeLeaderFollowerOrder(
      inputs.map((v) => ({ ...v, isImplausiblePosition: false })),
      { isLoop: false, totalDistanceMeters: 10_000 },
    );
    const without = computeLeaderFollowerOrder(inputs, { isLoop: false, totalDistanceMeters: 10_000 });
    expect(withField.map((v) => [v.vehicleId, v.rank, v.leaderVehicleId, v.followerVehicleId])).toEqual(
      without.map((v) => [v.vehicleId, v.rank, v.leaderVehicleId, v.followerVehicleId]),
    );
  });

  it('keeps rejecting a vehicle for as long as its reported fix disagrees with the belief', () => {
    // The property both call sites read: `isImplausible` is what withholds the
    // speed from `corridorPaceKmph` and what `exclude` mode ranks -1 on.
    const tracker = new PositionPlausibilityTracker();
    const offset = 5_000;
    let verdicts = tracker.observe(0, [
      ...honestFleet(0),
      { vehicleId: 'SNAPPED', distanceAlongRouteMeters: 0, speedKmph: PACE_KMPH },
    ]);
    for (let step = 1; step <= 12; step++) {
      verdicts = tracker.observe(step * DT, [
        ...honestFleet(step),
        {
          vehicleId: 'SNAPPED',
          distanceAlongRouteMeters: step * DT * PACE_MPS + (step >= 10 ? offset : 0),
          speedKmph: PACE_KMPH,
        },
      ]);
    }
    expect(verdicts.get('SNAPPED')!.isImplausible).toBe(true);
    for (const honest of honestFleet(12)) {
      expect(verdicts.get(honest.vehicleId)!.isImplausible).toBe(false);
    }
  });
});

// ─── THE PRODUCTION PATH, NOT ONLY THE MODULE ──────────────────────────
//
// `AGENTS.md`'s own lesson from the `recordStopVisit` omission: a check that
// works in isolation and is not reached by the running service is worth
// nothing, and the type system will not catch it. These two cases go through
// `headway/service.ts#computeRouteDirectionHeadway` - the function the sweep
// and every read endpoint actually call - with the deployed switch flipped by
// the same env seam `test/health.test.ts` uses.
describe('position plausibility: reached by the production headway path', () => {
  const META = {
    routeDirectionId: 'rd-1',
    routeId: 'route-1',
    directionCode: 'UP',
    isLoop: false,
    totalDistanceMeters: 40_000,
  };
  const POLICY = {
    routeDirectionId: 'rd-1',
    targetHeadwaySeconds: 300,
    bunchedThresholdRatio: 0.25,
    warningThresholdRatio: 0.5,
    requiredSamples: 2,
  };

  /**
   * Three buses at the corridor pace, then the middle one's fix jumps 20 km
   * forward with its speed unchanged - the `blind_slowdown` shape.
   *
   * Ranked on the reported fix it becomes the leader-most vehicle and every
   * gap on the corridor is measured against a bus that is not there. The
   * check should put it back where its own speed says it is.
   */
  function fleet(step: number, biasedFrom: number) {
    const advanced = step * 30 * (20 / 3.6);
    return [
      { vehicleId: 'A', distanceAlongRouteMeters: 6_000 + advanced },
      {
        vehicleId: 'B',
        distanceAlongRouteMeters: 4_000 + advanced + (step >= biasedFrom ? 20_000 : 0),
      },
      { vehicleId: 'C', distanceAlongRouteMeters: 2_000 + advanced },
    ].map((v) => ({
      ...v,
      routeDirectionId: 'rd-1',
      isLowConfidence: false,
      speedKmph: 20,
      confidence: 0.9,
      observedAt: new Date().toISOString(),
    }));
  }

  async function sweepChain(enabled: boolean): Promise<string[]> {
    vi.resetModules();
    process.env.GPS_POSITION_PLAUSIBILITY_ENABLED = enabled ? 'true' : 'false';
    vi.doMock('../src/headway/repository.js', () => ({
      loadRouteDirectionMeta: vi.fn().mockResolvedValue(META),
      loadActiveRoutePolicy: vi.fn().mockResolvedValue(POLICY),
      loadVehicleStatesForRouteDirection: vi.fn(),
      insertHeadwaySample: vi.fn().mockImplementation((input: unknown) => Promise.resolve(input)),
      loadRecentHeadwayRatios: vi.fn().mockResolvedValue([]),
      loadRecentHeadwaySamples: vi.fn().mockResolvedValue([]),
      findOpenIncidentForPair: vi.fn().mockResolvedValue(null),
      openIncident: vi.fn(),
      escalateIncident: vi.fn(),
      closeIncident: vi.fn(),
      listOpenIncidents: vi.fn().mockResolvedValue([]),
      listOpenIncidentPairsForRouteDirection: vi.fn().mockResolvedValue([]),
      listActiveRouteDirections: vi.fn().mockResolvedValue([]),
    }));
    const repo = await import('../src/headway/repository.js');
    const { _resetEnvCacheForTests } = await import('../src/config/env.js');
    _resetEnvCacheForTests();
    const { computeRouteDirectionHeadway } = await import('../src/headway/service.js');

    let leaders: string[] = [];
    // Four sweeps 30 s apart: the tracker needs a history before it can have
    // an opinion, exactly as it does in the running service.
    for (let step = 0; step < 4; step++) {
      vi.setSystemTime(new Date(1_800_000_000_000 + step * 30_000));
      vi.mocked(repo.loadVehicleStatesForRouteDirection).mockResolvedValue(fleet(step, 2));
      const result = await computeRouteDirectionHeadway('rd-1');
      leaders = result.pairs.map((p) => `${p.leaderVehicleId}>${p.followerVehicleId}`);
    }
    _resetEnvCacheForTests();
    delete process.env.GPS_POSITION_PLAUSIBILITY_ENABLED;
    return leaders;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../src/headway/repository.js');
    vi.resetModules();
  });

  it('ranks the corridor on the phantom fix while the check is off', async () => {
    // B reports itself 20 km ahead of A, so the deployed ordering makes it the
    // leader-most vehicle. This is the defect, and it is what today does.
    expect(await sweepChain(false)).toEqual(['B>A', 'A>C']);
  });

  it('puts the phantom back where its own speed says it is once the check is on', async () => {
    expect(await sweepChain(true)).toEqual(['A>B', 'B>C']);
  });
});

// ─── THE CORRECTION MUST NOT BECOME A REFUSAL ──────────────────────────
//
// A rejected vehicle is kept out of the CORRIDOR PACE, and it must still be
// measured at its own closing speed when it is the one being decided about.
// `headway/metrics.ts#closingSpeedMetersPerSecond` divides this pair's gap by
// the FOLLOWER's speed, so withholding that particular speed is not an
// exclusion from a median - it is a null h_fwd, no candidate, and a hold
// declined. MEASURED: doing it takes `blind_slowdown` on urban from +7.26
// points of excess-wait gain (6/6 seeds) to -1.33 (3/6). See the comment on
// `speedByVehicleId.set(followerId, ...)` in
// `rehearsal/deployedControlLaws.ts`, which this pins.
describe('position plausibility: a corrected vehicle is still controllable', () => {
  it('still reports a forward headway for a rejected vehicle that is the follower', () => {
    const ordered = computeLeaderFollowerOrder(
      [
        { vehicleId: 'LEAD', routeDirectionId: 'rd', distanceAlongRouteMeters: 4_000, isLowConfidence: false },
        { vehicleId: 'DECIDER', routeDirectionId: 'rd', distanceAlongRouteMeters: 2_000, isLowConfidence: false },
      ],
      { isLoop: false, totalDistanceMeters: 20_000 },
    );

    const withOwnSpeed = computePairHeadways(
      ordered,
      new Map<string, number | null>([['LEAD', PACE_KMPH], ['DECIDER', PACE_KMPH]]),
      new Map<string, number>([['LEAD', 1], ['DECIDER', 1]]),
      { totalDistanceMeters: 20_000 },
      'rd',
      600,
    );
    expect(withOwnSpeed.find((p) => p.followerVehicleId === 'DECIDER')!.hFwdSeconds).not.toBeNull();

    // The same chain with the decider's own speed withheld - what suppressing
    // it "for consistency" produces. The pair goes silent, and a silent pair
    // generates no candidate at all.
    const withSpeedWithheld = computePairHeadways(
      ordered,
      new Map<string, number | null>([['LEAD', PACE_KMPH], ['DECIDER', null]]),
      new Map<string, number>([['LEAD', 1], ['DECIDER', 1]]),
      { totalDistanceMeters: 20_000 },
      'rd',
      600,
    );
    expect(withSpeedWithheld.find((p) => p.followerVehicleId === 'DECIDER')!.hFwdSeconds).toBeNull();
  });
});
