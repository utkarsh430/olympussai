// The multi-stop wait term: the objective's benefit side summed over the
// stops a hold's correction is actually experienced at, rather than at the
// one control point the hold is issued from.
//
// These assertions are about the SHAPE of the generalisation, not about a
// tuned value. The one-stop term is the N=1 special case and must survive
// byte-identically; the horizon may never be zero or negative, because a
// zero horizon would delete the benefit side entirely and leave a pure cost;
// and the closed form has to stay the true minimum of the function it claims
// to minimise once that function has been scaled.
//
// Measurements behind the term itself are in config/env.ts's
// MULTI_STOP_WAIT_TERM_ENABLED docblock and in HANDOFF.md section 7.
import { describe, it, expect } from 'vitest';
import {
  computePassengerCost,
  optimalHoldSeconds,
  scoreHold,
  waitHorizonStops,
} from '../src/mpc/objective.js';
import { stateStore } from '../src/state/store.js';
import { createDeployedControlLawsController } from '../src/rehearsal/deployedControlLaws.js';
import type { RoutePolicyRow } from '../src/state/store.js';
import type { ControllerContext } from '../src/simulation/types.js';

const TARGET = 600;

function inputs(overrides: Partial<Parameters<typeof computePassengerCost>[0]> = {}) {
  return {
    hFwdSeconds: 200,
    hBwdSeconds: 1000,
    targetHeadwaySeconds: TARGET,
    holdSeconds: 120,
    loadPassengers: null,
    ...overrides,
  };
}

describe('waitHorizonStops', () => {
  it('is 1 when the corridor cannot say how many stops are left, so the term stays the one-stop one', () => {
    expect(waitHorizonStops(null)).toBe(1);
    expect(waitHorizonStops(undefined)).toBe(1);
  });

  it('never returns less than 1, because a zero horizon would delete the benefit side and leave a pure cost', () => {
    expect(waitHorizonStops(0)).toBe(1);
    expect(waitHorizonStops(-4)).toBe(1);
    expect(waitHorizonStops(Number.NaN)).toBe(1);
    expect(waitHorizonStops(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('is the number of stops still to be served, whole stops only', () => {
    expect(waitHorizonStops(12)).toBe(12);
    expect(waitHorizonStops(12.9)).toBe(12);
  });
});

describe('computePassengerCost with a horizon', () => {
  it('reduces to today’s one-stop term at N=1, and when no horizon is supplied', () => {
    const oneStop = computePassengerCost(inputs());
    expect(computePassengerCost(inputs({ downstreamStopCount: 1 }))).toEqual(oneStop);
    expect(computePassengerCost(inputs({ downstreamStopCount: null })).waitPassengerSeconds).toBe(
      oneStop.waitPassengerSeconds,
    );
  });

  it('scales the wait term by the stops remaining, and nothing else', () => {
    const one = computePassengerCost(inputs({ loadPassengers: 30 }));
    const many = computePassengerCost(inputs({ loadPassengers: 30, downstreamStopCount: 12 }));
    expect(many.waitPassengerSeconds).toBeCloseTo(one.waitPassengerSeconds * 12, 9);
    expect(many.onboardPassengerSeconds).toBe(one.onboardPassengerSeconds);
    expect(many.operatorPassengerSeconds).toBe(one.operatorPassengerSeconds);
    expect(many.latenessPassengerSeconds).toBe(one.latenessPassengerSeconds);
  });

  it('reports the horizon it used, so a rationale cannot claim one the arithmetic did not', () => {
    expect(computePassengerCost(inputs({ downstreamStopCount: 12 })).waitHorizonStops).toBe(12);
    expect(computePassengerCost(inputs()).waitHorizonStops).toBe(1);
  });

  it('cannot change the sign of the benefit on its own - it is a positive multiplier', () => {
    // h_fwd - h_bwd + d > 0 here, so the hold is priced as harm at one stop
    // and stays harm over twelve. A horizon widens a benefit and widens a
    // cost; only the terms it is netted against can flip a sign.
    const harmful = inputs({ hFwdSeconds: 1000, hBwdSeconds: 200 });
    expect(computePassengerCost(harmful).waitPassengerSeconds).toBeGreaterThan(0);
    expect(
      computePassengerCost({ ...harmful, downstreamStopCount: 12 }).waitPassengerSeconds,
    ).toBeGreaterThan(0);
  });
});

describe('optimalHoldSeconds with a horizon', () => {
  const base = { hFwdSeconds: 200, hBwdSeconds: 1000, targetHeadwaySeconds: TARGET };

  it('is unchanged for an empty bus - the even-headway split has no lambda in it', () => {
    expect(optimalHoldSeconds({ ...base, loadPassengers: null, downstreamStopCount: 12 })).toBeCloseTo(
      optimalHoldSeconds({ ...base, loadPassengers: null }),
      9,
    );
  });

  it('divides the load penalty by the horizon, so a loaded bus is no longer priced out of every hold', () => {
    const oneStop = optimalHoldSeconds({ ...base, loadPassengers: 3 });
    const twelve = optimalHoldSeconds({ ...base, loadPassengers: 3, downstreamStopCount: 12 });
    expect(oneStop).toBe(0); // 3 passengers x H*/2 already exceeds the split
    expect(twelve).toBeGreaterThan(0);
  });

  it('is still the true minimum of the function it minimises', () => {
    const args = { ...base, loadPassengers: 8, downstreamStopCount: 12 };
    const best = optimalHoldSeconds(args);
    const at = (d: number) => computePassengerCost({ ...args, holdSeconds: d }).netPassengerSeconds;
    for (const delta of [-40, -10, -1, 1, 10, 40]) {
      if (best + delta < 0) continue;
      expect(at(best)).toBeLessThanOrEqual(at(best + delta) + 1e-9);
    }
  });
});

describe('scoreHold', () => {
  const headway = { hFwdSeconds: 200, hBwdSeconds: 1000, targetHeadwaySeconds: TARGET };

  it('carries the horizon into the score a candidate is ranked on', () => {
    const one = scoreHold(headway, 'bus-1', 120, 120, null);
    const twelve = scoreHold(headway, 'bus-1', 120, 120, null, null, 12);
    expect(twelve.objectiveCost).toBeCloseTo(one.objectiveCost * 12, 9);
    expect(twelve.passengerCost.waitHorizonStops).toBe(12);
  });
});

describe('stateStore stop sequences', () => {
  it('says how many stops a vehicle still has to serve, counting the one it is at', () => {
    stateStore.loadStopSequences([
      { routeDirectionId: 'rd-1', stopId: 's1', sequence: 0 },
      { routeDirectionId: 'rd-1', stopId: 's2', sequence: 1 },
      { routeDirectionId: 'rd-1', stopId: 's3', sequence: 2 },
    ]);
    expect(stateStore.getDownstreamStopCount('rd-1', 's1')).toBe(3);
    expect(stateStore.getDownstreamStopCount('rd-1', 's3')).toBe(1);
  });

  it('returns null for an unknown corridor or stop rather than guessing a horizon', () => {
    stateStore.loadStopSequences([{ routeDirectionId: 'rd-1', stopId: 's1', sequence: 0 }]);
    expect(stateStore.getDownstreamStopCount('rd-nope', 's1')).toBeNull();
    expect(stateStore.getDownstreamStopCount('rd-1', 's-nope')).toBeNull();
  });

  it('orders by sequence, not by insertion, so a query without an order by cannot mislead it', () => {
    stateStore.loadStopSequences([
      { routeDirectionId: 'rd-2', stopId: 'last', sequence: 2 },
      { routeDirectionId: 'rd-2', stopId: 'first', sequence: 0 },
      { routeDirectionId: 'rd-2', stopId: 'mid', sequence: 1 },
    ]);
    expect(stateStore.getDownstreamStopCount('rd-2', 'first')).toBe(3);
    expect(stateStore.getDownstreamStopCount('rd-2', 'mid')).toBe(2);
    expect(stateStore.getDownstreamStopCount('rd-2', 'last')).toBe(1);
  });
});

// ─── THE SWITCH IS WHAT SUPPLIES THE HORIZON ─────────────────────────────
//
// `waitHorizonStops` is total over whatever it is handed, so "default off"
// is a claim about the two places that build a count - `mpc/solver.ts` and
// `rehearsal/deployedControlLaws.ts`. It has to be pinned somewhere that a
// refactor of either would break, or off would quietly stop meaning
// byte-identical.
describe('the rehearsal adapter honours MULTI_STOP_WAIT_TERM_ENABLED', () => {
  const EPOCH_MS = Date.UTC(2026, 0, 1);

  const policy = (): RoutePolicyRow => ({
    id: 'policy-1',
    routeDirectionId: 'rd-1',
    operatingPeriod: 'all',
    dayType: 'all',
    targetHeadwaySeconds: 900,
    bunchedThresholdRatio: 0.25,
    warningThresholdRatio: 0.5,
    kf: 0.6,
    kb: 0.3,
    selfEqualizingK: 0.5,
    maxHoldSeconds: 90,
    cooldownSeconds: 60,
    minimumActionSeconds: 0,
    predictionHorizonControlPoints: 3,
    occupancyStaleSeconds: null,
    occupancyCapacity: null,
    ks: null,
    maxLatenessSeconds: null,
    speedBandMinKmph: null,
    speedBandMaxKmph: null,
  });

  // Ten stops a kilometre apart; the deciding bus is at stop-5 (index 4), so
  // six stops are left to serve including the one it is standing at.
  const corridorStops = Array.from({ length: 10 }, (_, i) => ({
    stopId: `stop-${i + 1}`,
    cumulativeDistanceMeters: i * 1000,
  }));

  const context = (): ControllerContext => ({
    routeDirectionId: 'rd-1',
    stopId: 'stop-5',
    vehicleId: 'SIM-02',
    now: 3600,
    leaderHeadwaySeconds: 120,
    targetHeadwaySeconds: 900,
    maxHoldSeconds: 90,
    isStateStale: false,
    onboardCount: 30,
    kinematics: {
      follower: { vehicleId: 'SIM-02', distanceAlongRouteMeters: 4000, speedKmph: 60 },
      leader: { vehicleId: 'SIM-01', distanceAlongRouteMeters: 6000, speedKmph: 6 },
      trailer: { vehicleId: 'SIM-03', distanceAlongRouteMeters: 2000, speedKmph: 6 },
      corridor: [
        { vehicleId: 'SIM-01', distanceAlongRouteMeters: 6000, speedKmph: 6 },
        { vehicleId: 'SIM-02', distanceAlongRouteMeters: 4000, speedKmph: 60 },
        { vehicleId: 'SIM-03', distanceAlongRouteMeters: 2000, speedKmph: 6 },
      ],
      totalDistanceMeters: 9000,
    },
  });

  const horizonOf = (multiStopWaitTerm: boolean) => {
    const controller = createDeployedControlLawsController({
      policy: policy(),
      epochMs: EPOCH_MS,
      modelledCapacity: 52,
      corridorStops,
      multiStopWaitTerm,
    });
    controller.decide(context());
    const hold = controller.decisions[0]!.candidates.find((c) => c.actionType === 'two_way_hold');
    return hold?.passengerCost.waitHorizonStops;
  };

  it('prices on one stop when the switch is off, whatever geometry it was handed', () => {
    expect(horizonOf(false)).toBe(1);
  });

  it('counts the stops the vehicle has left, including the one it is standing at, when on', () => {
    expect(horizonOf(true)).toBe(6);
  });

  it('scales only the wait term between the two, so the switch cannot move a cost', () => {
    const off = createDeployedControlLawsController({
      policy: policy(), epochMs: EPOCH_MS, modelledCapacity: 52, corridorStops,
      multiStopWaitTerm: false,
    });
    const on = createDeployedControlLawsController({
      policy: policy(), epochMs: EPOCH_MS, modelledCapacity: 52, corridorStops,
      multiStopWaitTerm: true,
    });
    off.decide(context());
    on.decide(context());
    const pick = (c: typeof off) =>
      c.decisions[0]!.candidates.find((x) => x.actionType === 'two_way_hold')!.passengerCost;
    expect(pick(on).waitPassengerSeconds).toBeCloseTo(pick(off).waitPassengerSeconds * 6, 9);
    expect(pick(on).onboardPassengerSeconds).toBe(pick(off).onboardPassengerSeconds);
    expect(pick(on).latenessPassengerSeconds).toBe(pick(off).latenessPassengerSeconds);
  });
});
