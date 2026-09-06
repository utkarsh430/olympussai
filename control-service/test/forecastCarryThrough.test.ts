// The carry-through: does the forecast the sweep computes actually reach a
// control law?
//
// `test/forecastActionGate.test.ts` pins the PREDICATE, which is a pure
// function and would pass just as happily if nothing ever handed it a
// forecast. That is exactly the state this change found the system in:
// `headway/riskForecast.ts` had been projecting every pair's forward headway
// since the predictive detection tier shipped, `headway_states.
// forecast_h_fwd_seconds` was being written on every row, and the value
// reached DETECTION and stopped there - `HeadwayStateRow` had no field for
// it, so `scheduler/headwayCompute.ts` dropped it when projecting a compute
// result onto the store's row shape and `db/rehydrate.ts` did not select the
// column at all. The controller could not read its own forecast.
//
// A defect of that shape does not fail a unit test of either end. It needs a
// test of the JOIN, which is what these are: one over the publish path the
// MPC actually reads from, and one over each mid-route law that consumes it.
import { beforeEach, describe, expect, it } from 'vitest';

import { runHeadwayComputeSweep } from '../src/scheduler/headwayCompute.js';
import { stateStore } from '../src/state/store.js';
import type { HeadwayStateRow, RoutePolicyRow, VehicleStateRow } from '../src/state/store.js';
import type { HeadwayComputeResult } from '../src/headway/service.js';
import { loadEnv } from '../src/config/env.js';
import { computeTwoWayCandidates } from '../src/mpc/twoWayHold.js';
import { computeSelfEqualizingCandidates } from '../src/mpc/selfEqualizing.js';
import { computeCostOptimalCandidates } from '../src/mpc/costOptimalHold.js';

const ROUTE_DIRECTION_ID = 'rd-forecast';
const TARGET = 600;

describe('the sweep publishes the forecast into the MPC read model', () => {
  beforeEach(() => {
    stateStore._resetForTests();
  });

  it('carries forecast_h_fwd_seconds onto the row the control laws read', async () => {
    const result: HeadwayComputeResult = {
      routeDirectionId: ROUTE_DIRECTION_ID,
      computedAt: '2026-09-06T00:00:00.000Z',
      pairs: [
        {
          id: 'hs-1',
          routeDirectionId: ROUTE_DIRECTION_ID,
          leaderVehicleId: 'veh-leader',
          followerVehicleId: 'veh-follower',
          hFwdSeconds: 540,
          hBwdSeconds: 600,
          targetHeadwaySeconds: TARGET,
          deviationSeconds: -60,
          gapMeters: 4_000,
          confidence: 1,
          // The whole point: the sweep computed a forecast for this pair.
          forecastHFwdSeconds: 300,
          computedAt: '2026-09-06T00:00:00.000Z',
        } as HeadwayComputeResult['pairs'][number],
      ],
      aggregate: {
        routeDirectionId: ROUTE_DIRECTION_ID,
        targetHeadwaySeconds: TARGET,
      } as HeadwayComputeResult['aggregate'],
      incidents: [],
    };

    await runHeadwayComputeSweep(loadEnv(), {
      listEligible: async () => [ROUTE_DIRECTION_ID],
      compute: async () => result,
    });

    const published = stateStore.getHeadwayStates(ROUTE_DIRECTION_ID);
    expect(published).toHaveLength(1);
    // Before this change the assertion below read `undefined`: the projection
    // in `toHeadwayStateRows` named every other field and dropped this one.
    expect(published[0]!.forecastHFwdSeconds).toBe(300);
  });

  it('publishes a null forecast as null rather than dropping the pair', async () => {
    // The forecaster refuses far more often than it speaks. A pair it declined
    // to forecast is still a pair the laws must see - just one the gate may
    // never admit early.
    const result: HeadwayComputeResult = {
      routeDirectionId: ROUTE_DIRECTION_ID,
      computedAt: '2026-09-06T00:00:00.000Z',
      pairs: [
        {
          id: 'hs-2',
          routeDirectionId: ROUTE_DIRECTION_ID,
          leaderVehicleId: 'veh-leader',
          followerVehicleId: 'veh-follower',
          hFwdSeconds: 540,
          hBwdSeconds: 600,
          targetHeadwaySeconds: TARGET,
          deviationSeconds: -60,
          gapMeters: 4_000,
          confidence: 1,
          forecastHFwdSeconds: null,
          computedAt: '2026-09-06T00:00:00.000Z',
        } as HeadwayComputeResult['pairs'][number],
      ],
      aggregate: {
        routeDirectionId: ROUTE_DIRECTION_ID,
        targetHeadwaySeconds: TARGET,
      } as HeadwayComputeResult['aggregate'],
      incidents: [],
    };

    await runHeadwayComputeSweep(loadEnv(), {
      listEligible: async () => [ROUTE_DIRECTION_ID],
      compute: async () => result,
    });

    const published = stateStore.getHeadwayStates(ROUTE_DIRECTION_ID);
    expect(published).toHaveLength(1);
    expect(published[0]!.forecastHFwdSeconds).toBeNull();
  });
});

// ─── AND THAT EACH LAW ACTUALLY CONSULTS IT ──────────────────────────────

const policy: RoutePolicyRow = {
  id: 'rp-1',
  routeDirectionId: ROUTE_DIRECTION_ID,
  operatingPeriod: 'all',
  dayType: 'all',
  targetHeadwaySeconds: TARGET,
  bunchedThresholdRatio: 0.25,
  warningThresholdRatio: 0.5,
  kf: 0.4,
  kb: 0.2,
  selfEqualizingK: 0.35,
  maxHoldSeconds: 240,
  cooldownSeconds: 0,
  minimumActionSeconds: 0,
  predictionHorizonControlPoints: 3,
  occupancyStaleSeconds: null,
  occupancyCapacity: null,
  ks: null,
  maxLatenessSeconds: null,
  speedBandMinKmph: null,
  speedBandMaxKmph: null,
};

/**
 * A pair at 0.9 of target headway - well OUTSIDE the 0.6 action bar - whose
 * forecast projects it to 0.4 of target at the horizon. The ordinary bar
 * declines it and the gate admits it, so any law that changes its mind
 * between the two runs below is reading the forecast.
 */
function deterioratingPair(overrides: Partial<HeadwayStateRow> = {}): HeadwayStateRow {
  return {
    id: 'hs-d',
    routeDirectionId: ROUTE_DIRECTION_ID,
    leaderVehicleId: 'veh-leader',
    followerVehicleId: 'veh-follower',
    hFwdSeconds: 0.9 * TARGET,
    hBwdSeconds: TARGET,
    targetHeadwaySeconds: TARGET,
    deviationSeconds: -60,
    forecastHFwdSeconds: 0.4 * TARGET,
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

const follower: VehicleStateRow = {
  vehicleId: 'veh-follower',
  tripId: null,
  routeDirectionId: ROUTE_DIRECTION_ID,
  position: null,
  distanceAlongRouteMeters: 5_000,
  speedKmph: 0,
  headingDegrees: null,
  // The only state a hold can be executed from - see mpc/eligibility.ts.
  stopState: 'dwelling_at_stop',
  currentStopId: 'stop-5',
  confidence: 1,
  isLowConfidence: false,
  observedAt: new Date().toISOString(),
  occupancyCount: null,
  occupancyLoadBand: null,
};

const vehicleStates = new Map<string, VehicleStateRow>([[follower.vehicleId, follower]]);

describe.each([
  ['two_way', (rows: HeadwayStateRow[], gate: boolean) =>
    computeTwoWayCandidates(rows, new Set(), policy, vehicleStates, new Date(), new Map(), new Set(), false, false, new Map(), gate)],
  ['cost_optimal', (rows: HeadwayStateRow[], gate: boolean) =>
    computeCostOptimalCandidates(rows, new Set(), policy, vehicleStates, new Date(), new Map(), new Set(), false, new Map(), gate)],
])('%s reads the forecast off the row', (_law, run) => {
  it('declines a pair outside the action bar with the gate off', () => {
    expect(run([deterioratingPair()], false)).toHaveLength(0);
  });

  it('acts on the same pair with the gate on', () => {
    expect(run([deterioratingPair()], true).length).toBeGreaterThan(0);
  });

  it('still declines it with the gate on when the row carries no forecast', () => {
    // The property that makes the whole mechanism safe, asserted at the law
    // rather than at the predicate: an absent forecast is not permission.
    expect(run([deterioratingPair({ forecastHFwdSeconds: null })], true)).toHaveLength(0);
  });

  it('still declines it with the gate on when the forecast says the gap is opening', () => {
    expect(run([deterioratingPair({ forecastHFwdSeconds: 1.2 * TARGET })], true)).toHaveLength(0);
  });
});

describe('self_equalizing reads the forecast off the row', () => {
  // Self-equalizing is the FALLBACK: it declines any pair two-way already
  // covers, so it only ever sees a pair with no backward headway.
  const run = (rows: HeadwayStateRow[], gate: boolean) =>
    computeSelfEqualizingCandidates(rows, new Set(), policy, vehicleStates, new Date(), new Map(), new Set(), false, false, new Map(), gate);
  const pair = (o: Partial<HeadwayStateRow> = {}) => deterioratingPair({ hBwdSeconds: null, ...o });

  it('declines a pair outside the action bar with the gate off', () => {
    expect(run([pair()], false)).toHaveLength(0);
  });

  it('acts on the same pair with the gate on', () => {
    expect(run([pair()], true).length).toBeGreaterThan(0);
  });

  it('still declines it with the gate on when the row carries no forecast', () => {
    expect(run([pair({ forecastHFwdSeconds: null })], true)).toHaveLength(0);
  });
});
