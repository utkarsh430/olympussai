// Two defects in how a hold is PRICED, and neither is about the horizon.
//
// 1. THE ORIGIN'S NEUTRAL BACKWARD GAP. `computePassengerCost` substitutes
//    `h_bwd = H*` when nothing is observed behind. Mid-route that is neutral.
//    At an origin it is self-cancelling: the unclamped terminal hold is
//    `d = H* - h_fwd`, so `d + h_fwd - h_bwd` is EXACTLY zero, the hold swaps
//    the two gaps instead of evening them, and 47-49% of terminal candidates
//    score 0.0 - which `>= 0` accepts, so every guard keyed on that
//    comparison declines the one action nobody aboard pays for.
//
// 2. LAMBDA. `arrivalRatePaxPerSecond` proxies it as `1/H*`, measured 7-11x
//    below the rate these corridors see. Nothing fits one yet, so the tests
//    here are about the SEAM: a measured rate is usable when it exists and a
//    null prices exactly as today.
//
// Both are pinned as SHAPE, not as tuned values. The derivations are in
// `mpc/objective.ts`'s header; the measurements in
// docs/MULTI_STOP_WAIT_TERM.md sections 3 and 5 and docs/ORIGIN_BACKWARD_NEUTRAL.md.
import { describe, it, expect } from 'vitest';
import {
  W_WAIT,
  arrivalRatePaxPerSecond,
  computePassengerCost,
  effectiveArrivalRatePaxPerSecond,
  explainHold,
  neutralBackwardHeadwaySeconds,
  optimalHoldSeconds,
  scoreHold,
} from '../src/mpc/objective.js';
import { computeTerminalDispatchCandidates } from '../src/mpc/terminalDispatch.js';
import { loadEnv } from '../src/config/env.js';
import type { HeadwayStateRow, RoutePolicyRow, VehicleStateRow } from '../src/state/store.js';

const TARGET = 600;

function inputs(overrides: Partial<Parameters<typeof computePassengerCost>[0]> = {}) {
  return {
    hFwdSeconds: 200,
    hBwdSeconds: null,
    targetHeadwaySeconds: TARGET,
    holdSeconds: 120,
    loadPassengers: null,
    ...overrides,
  };
}

describe('neutralBackwardHeadwaySeconds', () => {
  it('is one target headway behind the VEHICLE under the mid-route anchor', () => {
    expect(neutralBackwardHeadwaySeconds(200, TARGET, 'vehicle')).toBe(TARGET);
    // It does not depend on h_fwd at all - that is what makes it neutral there.
    expect(neutralBackwardHeadwaySeconds(590, TARGET, 'vehicle')).toBe(TARGET);
  });

  it('is one target headway behind the ON-TARGET DEPARTURE under the origin anchor', () => {
    // 2H* - h_fwd, i.e. H* + (H* - h_fwd): the next departure falls on target
    // after this bus's own on-target departure.
    expect(neutralBackwardHeadwaySeconds(200, TARGET, 'target_departure')).toBe(1000);
    expect(neutralBackwardHeadwaySeconds(TARGET, TARGET, 'target_departure')).toBe(TARGET);
  });

  it('clamps at zero rather than reporting a negative gap', () => {
    // A leader that pulled out more than two target headways ago leaves no
    // slack behind to spend; a negative gap is not a quantity.
    expect(neutralBackwardHeadwaySeconds(3 * TARGET, TARGET, 'target_departure')).toBe(0);
  });
});

describe('the exact-zero pathology, and that the origin anchor removes it', () => {
  // The unclamped terminal hold. Everything below is this one number.
  const hFwd = 200;
  const d = TARGET - hFwd; // 400

  it('prices an unclamped terminal hold at EXACTLY zero under the vehicle anchor', () => {
    const cost = computePassengerCost(
      inputs({ hFwdSeconds: hFwd, holdSeconds: d, hBwdSeconds: null }),
    );
    expect(cost.waitPassengerSeconds).toBe(0);
    // And that is the whole defect: `>= 0` is true of zero.
    expect(cost.netPassengerSeconds).toBe(0);
    expect(cost.netPassengerSeconds >= 0).toBe(true);
  });

  it('prices the same hold as a benefit under the origin anchor, and by -w_h x lambda x d^2', () => {
    const cost = computePassengerCost(
      inputs({
        hFwdSeconds: hFwd,
        holdSeconds: d,
        hBwdSeconds: null,
        backwardNeutral: 'target_departure',
      }),
    );
    const lambda = arrivalRatePaxPerSecond(TARGET);
    expect(cost.waitPassengerSeconds).toBeCloseTo(-W_WAIT * lambda * d * d, 9);
    expect(cost.netPassengerSeconds).toBeLessThan(0);
  });

  it('agrees with the second moment it claims to be differencing', () => {
    // The gaps go (h_fwd, 2H* - h_fwd) -> (h_fwd + d, 2H* - h_fwd - d).
    // Check the objective against that arithmetic rather than against itself.
    const hBwd = 2 * TARGET - hFwd;
    const lambda = arrivalRatePaxPerSecond(TARGET);
    const secondMoment = (a: number, b: number) => (W_WAIT * lambda * (a * a + b * b)) / 2;
    const delta = secondMoment(hFwd + d, hBwd - d) - secondMoment(hFwd, hBwd);
    expect(
      computePassengerCost(
        inputs({ hFwdSeconds: hFwd, holdSeconds: d, backwardNeutral: 'target_departure' }),
      ).waitPassengerSeconds,
    ).toBeCloseTo(delta, 9);
  });

  it('still prices an overshoot as harm - the anchor is not a licence to hold', () => {
    // The bracket d - 2(H* - h_fwd) turns positive once the hold pushes the
    // forward gap past what the backward one becomes.
    const cost = computePassengerCost(
      inputs({ hFwdSeconds: hFwd, holdSeconds: 3 * d, backwardNeutral: 'target_departure' }),
    );
    expect(cost.waitPassengerSeconds).toBeGreaterThan(0);
  });

  it('is a benefit for every clamped hold short of the on-target one', () => {
    for (const held of [1, 40, 120, 300, d - 1, d]) {
      expect(
        computePassengerCost(
          inputs({ hFwdSeconds: hFwd, holdSeconds: held, backwardNeutral: 'target_departure' }),
        ).waitPassengerSeconds,
      ).toBeLessThan(0);
    }
  });
});

describe('the anchor is a strict generalisation', () => {
  it('defaults to the vehicle anchor, so an absent field is today’s number', () => {
    expect(computePassengerCost(inputs())).toEqual(
      computePassengerCost(inputs({ backwardNeutral: 'vehicle' })),
    );
  });

  it('is not consulted at all when a backward headway was OBSERVED', () => {
    const observed = inputs({ hBwdSeconds: 1000 });
    expect(computePassengerCost(observed)).toEqual(
      computePassengerCost({ ...observed, backwardNeutral: 'target_departure' }),
    );
    expect(computePassengerCost(observed).backwardEstimated).toBe(false);
  });

  it('moves the wait term and nothing else', () => {
    const base = inputs({ loadPassengers: 20, scheduleDeviationSeconds: 60 });
    const vehicle = computePassengerCost(base);
    const origin = computePassengerCost({ ...base, backwardNeutral: 'target_departure' });
    expect(origin.onboardPassengerSeconds).toBe(vehicle.onboardPassengerSeconds);
    expect(origin.operatorPassengerSeconds).toBe(vehicle.operatorPassengerSeconds);
    expect(origin.latenessPassengerSeconds).toBe(vehicle.latenessPassengerSeconds);
    expect(origin.waitPassengerSeconds).not.toBe(vehicle.waitPassengerSeconds);
  });

  it('composes with the multi-stop horizon rather than replacing it', () => {
    const one = computePassengerCost(
      inputs({ hFwdSeconds: 200, holdSeconds: 400, backwardNeutral: 'target_departure' }),
    );
    const twelve = computePassengerCost(
      inputs({
        hFwdSeconds: 200,
        holdSeconds: 400,
        backwardNeutral: 'target_departure',
        downstreamStopCount: 12,
      }),
    );
    expect(twelve.waitPassengerSeconds).toBeCloseTo(one.waitPassengerSeconds * 12, 9);
    // Twelve times a negative number is more negative - which is exactly what
    // the horizon could not do while the number was zero.
    expect(twelve.waitPassengerSeconds).toBeLessThan(one.waitPassengerSeconds);
  });
});

describe('optimalHoldSeconds under the origin anchor', () => {
  it('reproduces terminal dispatch’s own rule, H* - h_fwd, for an empty bus', () => {
    expect(
      optimalHoldSeconds({
        hFwdSeconds: 200,
        hBwdSeconds: null,
        targetHeadwaySeconds: TARGET,
        loadPassengers: null,
        backwardNeutral: 'target_departure',
      }),
    ).toBeCloseTo(TARGET - 200, 9);
  });

  it('is half of it under the vehicle anchor - the same statement as the bracket vanishing', () => {
    expect(
      optimalHoldSeconds({
        hFwdSeconds: 200,
        hBwdSeconds: null,
        targetHeadwaySeconds: TARGET,
        loadPassengers: null,
      }),
    ).toBeCloseTo((TARGET - 200) / 2, 9);
  });
});

describe('effectiveArrivalRatePaxPerSecond', () => {
  it('uses the 1/H* proxy when no measured rate exists, and says so', () => {
    expect(effectiveArrivalRatePaxPerSecond(TARGET, null)).toEqual({
      lambdaPaxPerSecond: 1 / TARGET,
      isProxy: true,
    });
    expect(effectiveArrivalRatePaxPerSecond(TARGET, undefined).isProxy).toBe(true);
  });

  it('uses a measured rate when one exists', () => {
    expect(effectiveArrivalRatePaxPerSecond(TARGET, 0.02)).toEqual({
      lambdaPaxPerSecond: 0.02,
      isProxy: false,
    });
  });

  it('treats a non-positive or non-finite rate as a FAILED FIT, not as an empty corridor', () => {
    // lambda = 0 would multiply the whole benefit side away and silence the
    // controller on the strength of a bad regression.
    for (const bad of [0, -0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(effectiveArrivalRatePaxPerSecond(TARGET, bad)).toEqual({
        lambdaPaxPerSecond: 1 / TARGET,
        isProxy: true,
      });
    }
  });
});

describe('the measured-lambda seam', () => {
  it('prices exactly as today when none is supplied', () => {
    const withoutField = computePassengerCost(inputs({ hBwdSeconds: 1000 }));
    expect(
      computePassengerCost(inputs({ hBwdSeconds: 1000, measuredArrivalRatePaxPerSecond: null })),
    ).toEqual(withoutField);
    expect(withoutField.lambdaIsProxy).toBe(true);
  });

  it('scales only the wait term, by the ratio of the two rates', () => {
    const base = inputs({ hBwdSeconds: 1000, loadPassengers: 20, scheduleDeviationSeconds: 30 });
    const proxy = computePassengerCost(base);
    const measured = computePassengerCost({ ...base, measuredArrivalRatePaxPerSecond: 0.02 });
    expect(measured.waitPassengerSeconds).toBeCloseTo(
      proxy.waitPassengerSeconds * (0.02 / arrivalRatePaxPerSecond(TARGET)),
      9,
    );
    expect(measured.onboardPassengerSeconds).toBe(proxy.onboardPassengerSeconds);
    expect(measured.latenessPassengerSeconds).toBe(proxy.latenessPassengerSeconds);
    expect(measured.lambdaIsProxy).toBe(false);
  });

  it('cannot flip a sign on its own either - it is a positive multiplier too', () => {
    // The same property the horizon has. Only the terms the wait term is
    // netted against can move a candidate across zero.
    const harmful = inputs({ hFwdSeconds: 1000, hBwdSeconds: 200 });
    expect(computePassengerCost(harmful).waitPassengerSeconds).toBeGreaterThan(0);
    expect(
      computePassengerCost({ ...harmful, measuredArrivalRatePaxPerSecond: 0.02 })
        .waitPassengerSeconds,
    ).toBeGreaterThan(0);
  });

  it('reaches the objective through scoreHold, which is how a law would supply one', () => {
    const headway = { hFwdSeconds: 200, hBwdSeconds: 1000, targetHeadwaySeconds: TARGET };
    const proxy = scoreHold(headway, 'bus-1', 120, 120, null);
    const measured = scoreHold(headway, 'bus-1', 120, 120, null, null, null, 'vehicle', 0.02);
    expect(measured.passengerCost.lambdaIsProxy).toBe(false);
    expect(measured.objectiveCost).toBeCloseTo(
      proxy.objectiveCost * (0.02 / arrivalRatePaxPerSecond(TARGET)),
      9,
    );
  });
});

describe('explainHold', () => {
  const held = 400;
  const originInputs = inputs({
    hFwdSeconds: 200,
    holdSeconds: held,
    backwardNeutral: 'target_departure' as const,
  });

  it('says what was actually assumed at an origin, not that a gap was seen behind', () => {
    const sentence = explainHold('veh-1', held, originInputs, computePassengerCost(originInputs));
    expect(sentence).toContain('nothing has departed behind it');
    expect(sentence).not.toContain('its backward gap is assumed to be on target');
    // And it now reads as a saving, which is the point of the change.
    expect(sentence).toContain('a net saving of');
  });

  it('is word-for-word unchanged mid-route', () => {
    const midRoute = inputs({ hFwdSeconds: 200, holdSeconds: held });
    expect(explainHold('veh-1', held, midRoute, computePassengerCost(midRoute))).toContain(
      'nothing is visible behind it, so its backward gap is assumed to be on target',
    );
  });
});

// ─── THE SWITCH, AT THE ONE LAW THAT ASKS FOR THE OTHER ANCHOR ───────────
//
// `computePassengerCost` is total over whatever anchor it is handed, so
// "default off" is a claim about `mpc/terminalDispatch.ts` and about the env
// default. Both are pinned here, or off would quietly stop meaning
// byte-identical.
describe('terminal dispatch honours ORIGIN_BACKWARD_NEUTRAL_ENABLED', () => {
  const NOW = new Date('2026-08-22T10:00:00.000Z');
  const TERMINAL = 'stop-origin';
  const H = 600;
  const ELAPSED = 200; // so the unclamped hold is exactly H* - h_fwd = 400

  const policy = (): RoutePolicyRow => ({
    id: 'p1',
    routeDirectionId: 'rd-1',
    operatingPeriod: 'all',
    dayType: 'all',
    targetHeadwaySeconds: H,
    bunchedThresholdRatio: 0.25,
    warningThresholdRatio: 0.5,
    kf: 0.4,
    kb: 0.2,
    selfEqualizingK: 0.35,
    maxHoldSeconds: 600,
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

  const vehicle = (): VehicleStateRow => ({
    vehicleId: 'veh-terminal',
    tripId: null,
    routeDirectionId: 'rd-1',
    position: null,
    distanceAlongRouteMeters: 0,
    speedKmph: 0,
    headingDegrees: null,
    stopState: 'dwelling_at_stop',
    currentStopId: TERMINAL,
    confidence: 1,
    isLowConfidence: false,
    observedAt: NOW.toISOString(),
    occupancyCount: null,
    occupancyLoadBand: null,
  });

  const headway = (hBwdSeconds: number | null = null): HeadwayStateRow => ({
    id: 'h1',
    routeDirectionId: 'rd-1',
    leaderVehicleId: 'veh-leader',
    followerVehicleId: 'veh-terminal',
    hFwdSeconds: 27_601,
    hBwdSeconds,
    targetHeadwaySeconds: H,
    deviationSeconds: 27_001,
    /** Nothing here exercises the forecast gate; a pair with no forecast is the deployed state on every corridor. */
    forecastHFwdSeconds: null,
    computedAt: NOW.toISOString(),
  });

  const run = (originBackwardNeutral?: boolean, hBwdSeconds: number | null = null) =>
    computeTerminalDispatchCandidates(
      [headway(hBwdSeconds)],
      new Map([['veh-terminal', vehicle()]]),
      TERMINAL,
      policy(),
      NOW,
      new Map(),
      true,
      ELAPSED,
      false,
      new Map(),
      ...(originBackwardNeutral === undefined ? [] : ([originBackwardNeutral] as const)),
    );

  it('ships off', () => {
    expect(loadEnv().ORIGIN_BACKWARD_NEUTRAL_ENABLED).toBe(false);
  });

  it('prices the hold at exactly 0.0 with the switch off - today’s number', () => {
    const [candidate] = run(false);
    expect(candidate!.holdSeconds).toBe(H - ELAPSED);
    expect(candidate!.objectiveCost).toBe(0);
  });

  it('defaults to the env switch, which is off, so an unpassed argument is today’s number', () => {
    expect(run()[0]!.objectiveCost).toBe(0);
  });

  it('prices it as a benefit with the switch on', () => {
    const [candidate] = run(true);
    const d = H - ELAPSED;
    expect(candidate!.objectiveCost).toBeCloseTo(-W_WAIT * (1 / H) * d * d, 9);
    expect(candidate!.objectiveCost).toBeLessThan(0);
  });

  it('leaves the hold itself alone - this is a pricing change, not a control change', () => {
    expect(run(true)[0]!.holdSeconds).toBe(run(false)[0]!.holdSeconds);
  });

  it('changes nothing when a bus behind IS observed', () => {
    expect(run(true, 900)[0]!.objectiveCost).toBe(run(false, 900)[0]!.objectiveCost);
  });

  it('unblocks the self-harm check, which is the guard that declines a zero', () => {
    const checked = (originBackwardNeutral: boolean) =>
      computeTerminalDispatchCandidates(
        [headway()],
        new Map([['veh-terminal', vehicle()]]),
        TERMINAL,
        policy(),
        NOW,
        new Map(),
        true,
        ELAPSED,
        true, // selfHarmCheckEnabled
        new Map(),
        originBackwardNeutral,
      );
    expect(checked(false)).toHaveLength(0); // >= 0 is true of zero
    expect(checked(true)).toHaveLength(1);
  });
});
