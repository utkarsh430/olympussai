// The passenger-and-operator cost every candidate hold is ranked by.
//
// These assertions are about the SHAPE of the objective, not about tuning:
// that it is quadratic in headway, that it prices both headways a hold
// moves, that its minimum is the even-headway split corrected for who is on
// board, and that a missing input degrades to a neutral assumption rather
// than to a guess. Reference architecture sections 2.1, 2.2 and 2.4.
import { describe, it, expect } from 'vitest';
import {
  W_ONBOARD,
  W_WAIT,
  arrivalRatePaxPerSecond,
  computePassengerCost,
  explainHold,
  liveOnboardCount,
  optimalHoldSeconds,
  scoreHold,
} from '../src/mpc/objective.js';
import type { RoutePolicyRow, VehicleStateRow } from '../src/state/store.js';

const TARGET = 600;

function inputs(overrides: Partial<Parameters<typeof computePassengerCost>[0]> = {}) {
  return {
    hFwdSeconds: 200,
    hBwdSeconds: 1000,
    targetHeadwaySeconds: TARGET,
    holdSeconds: 0,
    loadPassengers: null,
    ...overrides,
  };
}

function policy(overrides: Partial<RoutePolicyRow> = {}): RoutePolicyRow {
  return {
    id: 'policy-1',
    routeDirectionId: 'rd-1',
    operatingPeriod: 'all',
    dayType: 'all',
    targetHeadwaySeconds: TARGET,
    bunchedThresholdRatio: 0.25,
    warningThresholdRatio: 0.5,
    kf: 0.4,
    kb: 0.2,
    selfEqualizingK: 0.35,
    maxHoldSeconds: 600,
    cooldownSeconds: 60,
    minimumActionSeconds: 0,
    predictionHorizonControlPoints: 3,
    occupancyStaleSeconds: 120,
    occupancyCapacity: 52,
    ks: null,
    maxLatenessSeconds: null,
    speedBandMinKmph: null,
    speedBandMaxKmph: null,
    ...overrides,
  };
}

function vehicle(overrides: Partial<VehicleStateRow> = {}): VehicleStateRow {
  return {
    vehicleId: 'veh-1',
    tripId: null,
    routeDirectionId: 'rd-1',
    position: null,
    distanceAlongRouteMeters: null,
    speedKmph: null,
    headingDegrees: null,
    stopState: 'off_route',
    currentStopId: null,
    confidence: 1,
    isLowConfidence: false,
    observedAt: new Date().toISOString(),
    occupancyCount: null,
    occupancyLoadBand: null,
    ...overrides,
  };
}

describe('computePassengerCost', () => {
  it('scores a hold of zero at zero cost, so doing nothing is the neutral baseline', () => {
    const cost = computePassengerCost(inputs({ holdSeconds: 0 }));
    expect(cost.netPassengerSeconds).toBe(0);
  });

  // The whole point of section 2.1: the cost is the SECOND moment of
  // headway, so cost does not scale linearly with the hold. Doubling a hold
  // does not double its wait effect - it is quadratic in d.
  it('is quadratic in the hold, not linear', () => {
    const lambda = arrivalRatePaxPerSecond(TARGET);
    const single = computePassengerCost(inputs({ holdSeconds: 100 })).waitPassengerSeconds;
    const double = computePassengerCost(inputs({ holdSeconds: 200 })).waitPassengerSeconds;

    // w_h * lambda * d * (d + h_fwd - h_bwd) with h_fwd - h_bwd = -800:
    expect(single).toBeCloseTo(W_WAIT * lambda * 100 * (100 - 800), 9);
    expect(double).toBeCloseTo(W_WAIT * lambda * 200 * (200 - 800), 9);
    expect(double).not.toBeCloseTo(2 * single, 6);
  });

  // A hold moves TWO headways in opposite directions. A controller blind to
  // the second one cannot tell "closing a 200s gap that has a 1000s gap
  // behind it" from "closing a 200s gap that has a 200s gap behind it",
  // although one is worth doing and the other exports the problem.
  it('prices the gap behind as well as the gap ahead', () => {
    const bigGapBehind = computePassengerCost(inputs({ holdSeconds: 200, hBwdSeconds: 1000 }));
    const noGapBehind = computePassengerCost(inputs({ holdSeconds: 200, hBwdSeconds: 200 }));

    expect(bigGapBehind.netPassengerSeconds).toBeLessThan(0); // worth doing
    expect(noGapBehind.netPassengerSeconds).toBeGreaterThan(0); // makes things worse
  });

  it('charges the passengers on board for every second they are held', () => {
    const empty = computePassengerCost(inputs({ holdSeconds: 120, loadPassengers: 0 }));
    const full = computePassengerCost(inputs({ holdSeconds: 120, loadPassengers: 45 }));

    expect(empty.onboardPassengerSeconds).toBe(0);
    expect(full.onboardPassengerSeconds).toBe(W_ONBOARD * 45 * 120);
    expect(full.netPassengerSeconds).toBeGreaterThan(empty.netPassengerSeconds);
    expect(full.loadEstimated).toBe(false);
  });

  // Occupancy is unpopulated fleet-wide today. The in-vehicle term must
  // then be ZERO and flagged, not a fabricated mid-load constant: ranking
  // is comparative, and a constant invented identically for every candidate
  // cannot break a tie, only shift the wait/onboard balance on a number
  // nobody measured.
  it('drops the in-vehicle term to zero, flagged, when no onboard count exists', () => {
    const cost = computePassengerCost(inputs({ holdSeconds: 120, loadPassengers: null }));
    expect(cost.onboardPassengerSeconds).toBe(0);
    expect(cost.loadEstimated).toBe(true);
  });

  it('assumes an unobserved bus behind sits exactly on target, and says so', () => {
    const cost = computePassengerCost(inputs({ holdSeconds: 60, hBwdSeconds: null }));
    const explicit = computePassengerCost(inputs({ holdSeconds: 60, hBwdSeconds: TARGET }));

    expect(cost.backwardEstimated).toBe(true);
    expect(cost.netPassengerSeconds).toBeCloseTo(explicit.netPassengerSeconds, 9);
  });
});

describe('optimalHoldSeconds', () => {
  // The Tier 0 "split the difference" rule is not asserted alongside the
  // quadratic objective - it FALLS OUT of it. With nobody on board, the
  // cost-minimising hold is exactly the even-headway split.
  it('reduces to the even-headway split when the bus is empty', () => {
    const d = optimalHoldSeconds({
      hFwdSeconds: 200,
      hBwdSeconds: 1000,
      targetHeadwaySeconds: TARGET,
      loadPassengers: 0,
    });
    expect(d).toBeCloseTo((1000 - 200) / 2, 9);
  });

  it('holds a loaded bus for less than an empty one at the same headways', () => {
    const base = { hFwdSeconds: 200, hBwdSeconds: 1000, targetHeadwaySeconds: TARGET };
    const empty = optimalHoldSeconds({ ...base, loadPassengers: 0 });
    const loaded = optimalHoldSeconds({ ...base, loadPassengers: 30 });

    expect(loaded).toBeLessThan(empty);
    expect(loaded).toBeGreaterThanOrEqual(0);
  });

  it('never returns a negative hold', () => {
    const d = optimalHoldSeconds({
      hFwdSeconds: 1000,
      hBwdSeconds: 200,
      targetHeadwaySeconds: TARGET,
      loadPassengers: 40,
    });
    expect(d).toBe(0);
  });

  // The closed form must actually minimise the cost it claims to minimise.
  it('is the true minimum of computePassengerCost', () => {
    const base = { hFwdSeconds: 150, hBwdSeconds: 900, targetHeadwaySeconds: TARGET, loadPassengers: 5 };
    const best = optimalHoldSeconds(base);
    const atBest = computePassengerCost({ ...base, holdSeconds: best }).netPassengerSeconds;

    for (const d of [0, 50, 100, 200, 300, 400, 600]) {
      expect(computePassengerCost({ ...base, holdSeconds: d }).netPassengerSeconds).toBeGreaterThanOrEqual(
        atBest - 1e-9,
      );
    }
  });
});

describe('liveOnboardCount', () => {
  it('returns null rather than a substitute when no count was reported', () => {
    expect(liveOnboardCount(vehicle({ occupancyCount: null }), policy(), new Date())).toBeNull();
  });

  it('returns null when the count is older than the policy freshness bound', () => {
    const now = new Date('2026-08-19T10:00:00.000Z');
    const stale = vehicle({
      occupancyCount: 30,
      observedAt: new Date(now.getTime() - 300_000).toISOString(),
    });
    expect(liveOnboardCount(stale, policy({ occupancyStaleSeconds: 120 }), now)).toBeNull();
  });

  it('returns the measured count when it is fresh', () => {
    const now = new Date('2026-08-19T10:00:00.000Z');
    const fresh = vehicle({
      occupancyCount: 30,
      observedAt: new Date(now.getTime() - 30_000).toISOString(),
    });
    expect(liveOnboardCount(fresh, policy({ occupancyStaleSeconds: 120 }), now)).toBe(30);
  });
});

describe('scoreHold', () => {
  // The defect this module was written to remove: `objectiveCost` used to
  // be |rawHold - holdSeconds|, so a pair whose hold got clamped hard - the
  // most bunched one - scored WORST and sorted last. The clamp residual is
  // still reported, it just no longer decides anything.
  it('ranks on passenger cost while still reporting how hard the cap bit', () => {
    const headway = { hFwdSeconds: 100, hBwdSeconds: 1200, targetHeadwaySeconds: TARGET };
    const score = scoreHold(headway, 'veh-1', 90, 550, null);

    expect(score.clampResidualSeconds).toBe(460);
    expect(score.objectiveCost).toBe(score.passengerCost.netPassengerSeconds);
    expect(score.objectiveCost).toBeLessThan(0); // a hold worth making
    expect(score.objectiveCost).not.toBe(score.clampResidualSeconds);
  });

  it('substitutes the target headway when h_fwd is missing, rather than treating it as zero', () => {
    const score = scoreHold({ hFwdSeconds: null, hBwdSeconds: null, targetHeadwaySeconds: TARGET }, 'v', 60, 60, null);
    // Both headways on target: the hold only opens a gap it should not.
    expect(score.objectiveCost).toBeGreaterThan(0);
  });
});

describe('explainHold', () => {
  it('names the headways and the load a hold was decided from, in one sentence', () => {
    const i = inputs({ holdSeconds: 90, loadPassengers: 22 });
    const sentence = explainHold('UP25FT4823', 90, i, computePassengerCost(i));

    expect(sentence).toContain('UP25FT4823');
    expect(sentence).toContain('200s'); // the gap ahead
    expect(sentence).toContain('1000s'); // the gap behind
    expect(sentence).toContain('22 passengers');
    expect(sentence.split('. ').length).toBeLessThanOrEqual(2);
  });

  it('says plainly when there was no onboard count and no bus behind', () => {
    const i = inputs({ holdSeconds: 60, hBwdSeconds: null, loadPassengers: null });
    const sentence = explainHold('veh-1', 60, i, computePassengerCost(i));

    expect(sentence).toContain('nothing is visible behind it');
    expect(sentence).toContain('no onboard count is available');
  });

  // Reference architecture Part J: deterministic replay. The same recorded
  // state must produce the same words, or an incident review cannot diff.
  it('is deterministic for identical inputs', () => {
    const i = inputs({ holdSeconds: 45, loadPassengers: 12 });
    expect(explainHold('v', 45, i, computePassengerCost(i))).toBe(
      explainHold('v', 45, i, computePassengerCost(i)),
    );
  });
});
