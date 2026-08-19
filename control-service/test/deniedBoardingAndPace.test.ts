// Two things the controller could never see, and one it could never do.
//
// DENIED BOARDING is the bunching amplifier: a full bus skips the dwell it
// should have spent loading, pulls away early, and closes on the bus ahead.
// Nothing in this system detected it, so the loop that makes bunching
// accelerate was invisible. Every assertion about it REFUSING to fire matters
// as much as the ones about it firing - this is an inference from two noisy
// inputs, and a denied-boarding count made of assumptions is worse than none.
//
// PACE GUIDANCE is the only lever that improves punctuality and spacing at
// the same time, because it spends slack a bus already holds instead of
// adding delay. The safety assertions are the load-bearing ones: it must
// never advise going faster, and never advise easing off into the bus behind.
import { describe, it, expect } from 'vitest';
import {
  computeLoadBalance,
  detectDeniedBoarding,
  NEAR_CAPACITY_FRACTION,
} from '../src/headway/deniedBoarding.js';
import { computePaceAdvisories, computePaceAdvisory } from '../src/mpc/paceGuidance.js';
import type { DwellModel } from '../src/calibration/dwell.js';
import type { HeadwayStateRow, RoutePolicyRow } from '../src/state/store.js';

const DWELL_MODEL: DwellModel = {
  stopId: 'stop-A',
  routeDirectionId: 'rd-1',
  beta0Seconds: 10,
  betaHeadway: 0.05,
  rSquared: 0.85,
  sampleCount: 40,
};

function deniedInput(overrides = {}) {
  return {
    stopId: 'stop-A',
    routeDirectionId: 'rd-1',
    vehicleId: 'UP25FT4823',
    precedingHeadwaySeconds: 1200, // model expects 10 + 0.05*1200 = 70s dwell
    observedDwellSeconds: 20, // well under 60% of 70
    occupancyCount: 52,
    capacity: 52,
    ...overrides,
  };
}

describe('detectDeniedBoarding', () => {
  it('flags a full bus that dwelled far less than the gap it arrived on implies', () => {
    const detection = detectDeniedBoarding(deniedInput(), DWELL_MODEL);
    expect(detection).not.toBeNull();
    expect(detection!.expectedDwellSeconds).toBe(70);
    expect(detection!.occupancyFraction).toBe(1);
    expect(detection!.confidence).toBeGreaterThan(0.5);
  });

  // A full bus that still loaded everyone is not a denied boarding.
  it('does not flag a full bus that dwelled as long as expected', () => {
    expect(detectDeniedBoarding(deniedInput({ observedDwellSeconds: 70 }), DWELL_MODEL)).toBeNull();
  });

  // A short dwell at a quiet stop is just a quick stop.
  it('does not flag a short dwell on a bus with room on it', () => {
    expect(detectDeniedBoarding(deniedInput({ occupancyCount: 20 }), DWELL_MODEL)).toBeNull();
  });

  it('does not flag a bus sitting just below the near-capacity threshold', () => {
    const justUnder = Math.floor(52 * NEAR_CAPACITY_FRACTION) - 1;
    expect(detectDeniedBoarding(deniedInput({ occupancyCount: justUnder }), DWELL_MODEL)).toBeNull();
  });

  // ─── THE REFUSALS ──────────────────────────────────────────────────────
  //
  // Each of these is the state on every corridor today. A detector that
  // guessed here would produce a denied-boarding TREND made entirely of
  // assumptions, which is exactly the number that gets quoted at a review
  // and cannot be substantiated.

  it('says nothing without an occupancy reading', () => {
    expect(detectDeniedBoarding(deniedInput({ occupancyCount: null }), DWELL_MODEL)).toBeNull();
  });

  it('says nothing without a capacity to measure fullness against', () => {
    expect(detectDeniedBoarding(deniedInput({ capacity: null }), DWELL_MODEL)).toBeNull();
  });

  it('says nothing without a fitted dwell model for the stop', () => {
    expect(detectDeniedBoarding(deniedInput(), null)).toBeNull();
  });

  it('scores a crush-loaded bus that barely stopped above a marginal case', () => {
    const marginal = detectDeniedBoarding(
      deniedInput({ occupancyCount: 47, observedDwellSeconds: 41 }),
      DWELL_MODEL,
    );
    const severe = detectDeniedBoarding(
      deniedInput({ occupancyCount: 52, observedDwellSeconds: 2 }),
      DWELL_MODEL,
    );
    expect(severe!.confidence).toBeGreaterThan(marginal!.confidence);
  });
});

describe('computeLoadBalance', () => {
  it('reports the spread between the fullest and emptiest bus', () => {
    const balance = computeLoadBalance([10, 20, 50], 50);
    expect(balance!.vehicleCount).toBe(3);
    expect(balance!.spreadFraction).toBeCloseTo(0.8, 6);
    expect(balance!.p90Fraction).toBe(1);
  });

  it('reports a zero spread only when the buses really are equally loaded', () => {
    expect(computeLoadBalance([25, 25, 25], 50)!.spreadFraction).toBe(0);
  });

  // One bus has no distribution, and a zero spread would read as perfect
  // balance rather than as nothing to compare.
  it('says nothing for a single bus, or with no capacity', () => {
    expect(computeLoadBalance([30], 50)).toBeNull();
    expect(computeLoadBalance([30, 40], null)).toBeNull();
  });

  it('ignores buses with no occupancy reading rather than counting them empty', () => {
    expect(computeLoadBalance([null, 25, 25], 50)!.vehicleCount).toBe(2);
  });
});

function headway(overrides: Partial<HeadwayStateRow> = {}): HeadwayStateRow {
  return {
    id: 'h-1',
    routeDirectionId: 'rd-1',
    leaderVehicleId: 'lead',
    followerVehicleId: 'UP25FT4823',
    hFwdSeconds: 300,
    hBwdSeconds: 900,
    targetHeadwaySeconds: 600,
    deviationSeconds: -300,
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

function policy(overrides: Partial<RoutePolicyRow> = {}): RoutePolicyRow {
  return {
    id: 'p-1',
    routeDirectionId: 'rd-1',
    operatingPeriod: 'all',
    dayType: 'all',
    targetHeadwaySeconds: 600,
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
    ...overrides,
  };
}

describe('computePaceAdvisory', () => {
  // The case this lever exists for: both priorities move the same way.
  it('advises easing off a bus that is early and closing on its leader', () => {
    const advisory = computePaceAdvisory(headway(), 40, -240, policy());
    expect(advisory).not.toBeNull();
    expect(advisory!.action).toBe('reduce_pace');
    expect(advisory!.targetSpeedKmph).toBeLessThan(40);
    expect(advisory!.rationale).toContain('ahead of schedule');
  });

  // Without a timetable - the state today - a big gap behind is the fallback
  // evidence that easing off is safe.
  it('still advises with no schedule when the gap behind is large enough', () => {
    const advisory = computePaceAdvisory(headway({ hBwdSeconds: 1200 }), 40, null, policy());
    expect(advisory).not.toBeNull();
    expect(advisory!.scheduleSlackSeconds).toBeNull();
    expect(advisory!.rationale).toContain('behind is');
  });

  // ─── THE SAFETY REFUSALS ───────────────────────────────────────────────

  // A controller that tells a late bus to hurry has made road safety its
  // adjustment variable. The gap is closed from the bus behind instead.
  it('never advises a late bus to do anything', () => {
    const late = computePaceAdvisory(headway({ hBwdSeconds: 300 }), 40, 400, policy());
    expect(late).toBeNull();
  });

  // Easing off into the bus behind is exporting the problem downstream -
  // the exact failure two-way control exists to prevent.
  it('does not advise easing off when the bus behind is already close', () => {
    expect(computePaceAdvisory(headway({ hBwdSeconds: 200 }), 40, null, policy())).toBeNull();
  });

  it('does nothing for a bus already at or beyond its target gap', () => {
    expect(computePaceAdvisory(headway({ hFwdSeconds: 800 }), 40, -240, policy())).toBeNull();
  });

  it('never advises below the corridor safe-speed floor', () => {
    const advisory = computePaceAdvisory(headway({ hFwdSeconds: 60 }), 40, -3000, policy({ speedBandMinKmph: 35 }));
    if (advisory) expect(advisory.targetSpeedKmph).toBeGreaterThanOrEqual(35);
  });

  it('never advises a reduction below its own relative floor, however large the correction wanted', () => {
    const advisory = computePaceAdvisory(headway({ hFwdSeconds: 30 }), 40, -9000, policy());
    expect(advisory!.targetSpeedKmph).toBeGreaterThanOrEqual(40 * 0.7 - 1);
  });

  // An instruction inside the noise of ordinary driving will be ignored, and
  // issuing it spends dispatcher and driver goodwill for nothing.
  it('stays silent when the reduction would be too small to be worth saying', () => {
    expect(computePaceAdvisory(headway({ hFwdSeconds: 595 }), 40, -10, policy())).toBeNull();
  });

  it('says nothing without a current speed to advise a reduction from', () => {
    expect(computePaceAdvisory(headway(), null, -240, policy())).toBeNull();
    expect(computePaceAdvisory(headway(), 0, -240, policy())).toBeNull();
  });
});

describe('computePaceAdvisories', () => {
  it('ranks the vehicle needing the largest reduction first', () => {
    const states = [
      headway({ id: 'h-small', followerVehicleId: 'mild', hFwdSeconds: 500, hBwdSeconds: 1200 }),
      headway({ id: 'h-big', followerVehicleId: 'severe', hFwdSeconds: 150, hBwdSeconds: 1200 }),
    ];
    const speeds = new Map([
      ['mild', 40],
      ['severe', 40],
    ]);
    const deviations = new Map([
      ['mild', -300],
      ['severe', -300],
    ]);

    const advisories = computePaceAdvisories(states, speeds, deviations, policy());
    expect(advisories[0]!.vehicleId).toBe('severe');
  });
});
