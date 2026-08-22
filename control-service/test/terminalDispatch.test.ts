// Algorithm A, and the arithmetic that made it incapable of ever firing.
//
// Terminal dispatch regulation read `h_fwd` for years. A bus dwelling at the
// origin has a speed near zero, `computePairHeadways` floors it at
// MIN_SPEED_KMPH = 1, and h_fwd = gap / speed then reports hours for any real
// gap - so `H* - h_fwd` was always negative and the law returned nothing, on
// every corridor, every cycle. The tests below pin the replacement: an
// ELAPSED departure headway, measured from `stop_visits.departed_at`.
import { describe, it, expect } from 'vitest';
import {
  computeTerminalDispatchCandidates,
  departureHeadwaySeconds,
  isAtTerminal,
} from '../src/mpc/terminalDispatch.js';
import type { HeadwayStateRow, RoutePolicyRow, VehicleStateRow } from '../src/state/store.js';

const NOW = new Date('2026-08-22T10:00:00.000Z');
const TERMINAL = 'stop-origin';

function policy(overrides: Partial<RoutePolicyRow> = {}): RoutePolicyRow {
  return {
    id: 'p1',
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

function terminalVehicle(overrides: Partial<VehicleStateRow> = {}): VehicleStateRow {
  return {
    vehicleId: 'veh-terminal',
    tripId: null,
    routeDirectionId: 'rd-1',
    position: null,
    distanceAlongRouteMeters: 0,
    // The speed that broke the old formula: a bus at the origin is stationary.
    speedKmph: 0,
    headingDegrees: null,
    stopState: 'dwelling_at_stop',
    currentStopId: TERMINAL,
    confidence: 1,
    isLowConfidence: false,
    observedAt: NOW.toISOString(),
    occupancyCount: null,
    occupancyLoadBand: null,
    ...overrides,
  };
}

/**
 * A headway row whose h_fwd is what a STATIONARY bus actually produces:
 * a 7.7 km gap floored at 1 km/h is 27,601 seconds. Every test below uses it,
 * so any candidate that appears has demonstrably not been computed from it.
 */
function headwayState(overrides: Partial<HeadwayStateRow> = {}): HeadwayStateRow {
  return {
    id: 'h1',
    routeDirectionId: 'rd-1',
    leaderVehicleId: 'veh-leader',
    followerVehicleId: 'veh-terminal',
    hFwdSeconds: 27_601,
    hBwdSeconds: null,
    targetHeadwaySeconds: 600,
    deviationSeconds: 27_001,
    computedAt: NOW.toISOString(),
    ...overrides,
  };
}

function run(elapsed: number | null, overrides: { policy?: RoutePolicyRow; headway?: HeadwayStateRow } = {}) {
  return computeTerminalDispatchCandidates(
    [overrides.headway ?? headwayState()],
    new Map([['veh-terminal', terminalVehicle()]]),
    TERMINAL,
    overrides.policy ?? policy(),
    NOW,
    new Map(),
    true,
    elapsed,
  );
}

describe('departureHeadwaySeconds', () => {
  it('measures elapsed seconds since the recorded departure', () => {
    expect(departureHeadwaySeconds(new Date(NOW.getTime() - 240_000), NOW)).toBe(240);
  });

  it('declines when nothing has been observed to depart', () => {
    expect(departureHeadwaySeconds(null, NOW)).toBeNull();
  });

  // A departure stamped in the future is a clock or ingestion fault. Reading
  // it as a small elapsed time would produce a near-maximum hold on a bus
  // that may have just been released.
  it('declines a departure recorded in the future rather than treating it as a tiny gap', () => {
    expect(departureHeadwaySeconds(new Date(NOW.getTime() + 60_000), NOW)).toBeNull();
  });
});

describe('terminal dispatch regulation', () => {
  // THE REGRESSION. Every fixture here carries h_fwd = 27,601s against a 600s
  // target. Under the old formula that alone guaranteed no candidate; a hold
  // appearing proves the law is reading the departure gap instead.
  it('holds a bus whose departure gap is short, despite a stationary h_fwd of hours', () => {
    const candidates = run(200);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      actionType: 'terminal_dispatch_hold',
      vehicleId: 'veh-terminal',
      holdSeconds: 400, // 600 target - 200 elapsed
    });
  });

  it('reports the deviation as the departure gap against target, not the h_fwd', () => {
    expect(candidateDeviation(run(200))).toBe(-400);
  });

  // The objective ranks candidates in passenger-seconds, and it is fed the
  // departure gap rather than the h_fwd for the same reason the hold is.
  //
  //   waitPassengerSeconds = w_h * lambda * hold * (hold + h_fwd - h_bwd)
  //
  // An unclamped terminal hold is exactly `H* - elapsed`, and with no bus
  // behind the backward term falls back to H*, so the bracket is
  // (H* - elapsed) + elapsed - H* = 0. Zero is the right answer and it is the
  // reason the literature puts this lever first: a hold at the origin that
  // lands exactly on target costs nobody anything.
  //
  // Fed the stationary h_fwd instead, the same candidate would have scored
  // (1/600) * 540 * (540 + 27601 - 600) ~= 24,787 passenger-seconds - an
  // enormous fabricated cost, on the one action that is genuinely free.
  it('scores the objective on the departure gap, so an on-target terminal hold is free', () => {
    const candidate = run(60)[0];
    expect(candidate?.holdSeconds).toBe(540);
    expect(candidate?.objectiveCost).toBe(0);
  });

  // ...and the term is live rather than trivially zero: clamp the hold so it
  // can no longer reach target, and the score moves.
  it('prices a clamped terminal hold, which no longer lands exactly on target', () => {
    const clamped = run(60, { policy: policy({ maxHoldSeconds: 90 }) })[0];
    expect(clamped?.holdSeconds).toBe(90);
    expect(clamped?.objectiveCost).toBeLessThan(0);
    expect(Number.isFinite(clamped?.objectiveCost ?? NaN)).toBe(true);
  });

  it('releases a bus that has already reached the target gap', () => {
    expect(run(600)).toHaveLength(0);
    expect(run(900)).toHaveLength(0);
  });

  // Absence is not zero. An unmeasured departure means "we do not know how
  // long this bus has been waiting"; guessing zero would propose the maximum
  // hold to a bus that may have been released seconds ago.
  it('declines entirely when no departure has been measured', () => {
    expect(run(null)).toHaveLength(0);
  });

  it('clamps to the policy maximum hold', () => {
    const candidates = run(10, { policy: policy({ maxHoldSeconds: 90 }) });
    expect(candidates[0]?.holdSeconds).toBe(90);
  });

  it('ignores a bus that is not dwelling at the terminal', () => {
    const candidates = computeTerminalDispatchCandidates(
      [headwayState()],
      new Map([['veh-terminal', terminalVehicle({ stopState: 'in_transit', currentStopId: null })]]),
      TERMINAL,
      policy(),
      NOW,
      new Map(),
      true,
      200,
    );
    expect(candidates).toHaveLength(0);
  });

  it('does nothing at all when the corridor has no terminal stop', () => {
    const candidates = computeTerminalDispatchCandidates(
      [headwayState()],
      new Map([['veh-terminal', terminalVehicle()]]),
      undefined,
      policy(),
      NOW,
      new Map(),
      true,
      200,
    );
    expect(candidates).toHaveLength(0);
  });
});

describe('isAtTerminal', () => {
  it('requires both the dwelling state and the terminal stop', () => {
    expect(isAtTerminal(terminalVehicle(), TERMINAL)).toBe(true);
    expect(isAtTerminal(terminalVehicle({ currentStopId: 'stop-other' }), TERMINAL)).toBe(false);
    expect(isAtTerminal(terminalVehicle({ stopState: 'approaching_stop' }), TERMINAL)).toBe(false);
    expect(isAtTerminal(undefined, TERMINAL)).toBe(false);
    expect(isAtTerminal(terminalVehicle(), undefined)).toBe(false);
  });
});

function candidateDeviation(candidates: ReturnType<typeof run>): number | undefined {
  return candidates[0]?.headwayDeviationSeconds;
}
