// On-boot rehydration into the in-memory store
// (docs/CONTROL_SERVICE_DEPLOYMENT.md "CI/CD pipeline" step 5): populates
// vehicle_states / headway_states / active route_policies, and marks the
// store 'failed' (not silently 'complete') if any query errors.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { getNetworkCounts, refreshNetworkCounts, rehydrateState, _resetNetworkCountsForTests } from '../src/db/rehydrate.js';
import { stateStore } from '../src/state/store.js';

function fakePool(handler: (sql: string) => { rows: unknown[] }): Pool {
  return { query: vi.fn((sql: string) => Promise.resolve(handler(sql))) } as unknown as Pool;
}

describe('rehydrateState', () => {
  beforeEach(() => {
    stateStore._resetForTests();
  });

  it('loads vehicle states, headway states and active policies into the store', async () => {
    const pool = fakePool((sql) => {
      if (sql.includes('from vehicle_states')) {
        return {
          rows: [
            {
              vehicle_id: 'veh-1',
              trip_id: null,
              route_direction_id: 'rd-1',
              distance_along_route_meters: '120.5',
              speed_kmph: '30',
              stop_state: 'off_route',
              current_stop_id: null,
              occupancy_count: 12,
              occupancy_load_band: 'moderate',
              confidence: '0.9',
              observed_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (sql.includes('from headway_states')) {
        return {
          rows: [
            {
              id: 'h-1',
              route_direction_id: 'rd-1',
              leader_vehicle_id: 'veh-1',
              follower_vehicle_id: 'veh-2',
              h_fwd_seconds: '300',
              h_bwd_seconds: null,
              target_headway_seconds: '600',
              deviation_seconds: '-300',
              computed_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (sql.includes('from route_policies')) {
        return {
          rows: [
            {
              id: 'policy-1',
              route_direction_id: 'rd-1',
              operating_period: 'all',
              day_type: 'all',
              target_headway_seconds: '600',
              bunched_threshold_ratio: '0.25',
              warning_threshold_ratio: '0.5',
              kf: null,
              kb: null,
              self_equalizing_k: '0.5',
              max_hold_seconds: 90,
              cooldown_seconds: 60,
              prediction_horizon_control_points: 3,
              occupancy_stale_seconds: 120,
              occupancy_capacity: 60,
            },
          ],
        };
      }
      if (sql.includes('from route_direction_stops')) {
        return {
          rows: [{ route_direction_id: 'rd-1', stop_id: 'stop-origin' }],
        };
      }
      return { rows: [] };
    });

    await rehydrateState(pool);

    expect(stateStore.status).toBe('complete');
    expect(stateStore.getVehicleState('veh-1')).toMatchObject({
      routeDirectionId: 'rd-1',
      speedKmph: 30,
      occupancyCount: 12,
      occupancyLoadBand: 'moderate',
    });
    expect(stateStore.getHeadwayStates('rd-1')).toHaveLength(1);
    expect(stateStore.getActivePolicy('rd-1')).toMatchObject({
      targetHeadwaySeconds: 600,
      predictionHorizonControlPoints: 3,
      occupancyStaleSeconds: 120,
      occupancyCapacity: 60,
    });
    expect(stateStore.getTerminalStopId('rd-1')).toBe('stop-origin');
  });

  it('marks the store failed (not complete) when a query errors', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('connection refused')) } as unknown as Pool;

    await expect(rehydrateState(pool)).rejects.toThrow('connection refused');
    expect(stateStore.status).toBe('failed');
    expect(stateStore.isReady).toBe(false);
  });
});

// Regression proof for the incident this module's refreshNetworkCounts()
// docstring describes: a live instance whose network went from 47 to 759
// route-directions-with-shape kept reporting 47 from getNetworkCounts()
// (and therefore from /readyz - see health.test.ts) until the process was
// restarted, because networkCounts was set exactly once, at boot, by
// rehydrateState() alone. This file fails to even IMPORT against the
// pre-fix code, because refreshNetworkCounts did not exist - proving there
// was no way to update the published counts without a full rehydrate.
function networkCountsPool(routeDirectionsWithShape: number, vehicles: number): Pool {
  return {
    query: vi.fn((sql: string) => {
      if (sql.includes('route_directions_with_shape')) {
        return Promise.resolve({
          rows: [{ route_directions_with_shape: String(routeDirectionsWithShape), vehicles: String(vehicles) }],
        });
      }
      return Promise.resolve({ rows: [] });
    }),
  } as unknown as Pool;
}

describe('refreshNetworkCounts', () => {
  beforeEach(() => {
    _resetNetworkCountsForTests();
  });

  it('updates getNetworkCounts() on its own, with no rehydrateState() call in between', async () => {
    await rehydrateState(networkCountsPool(47, 1200));
    expect(getNetworkCounts()).toMatchObject({ routeDirectionsWithShape: 47 });

    // The reseed that changes the network happens out of process (an
    // operator re-running the seeder); nothing here calls rehydrateState()
    // again - exactly the "no restart" scenario the live instance needed.
    const returned = await refreshNetworkCounts(networkCountsPool(759, 9261));

    expect(getNetworkCounts()).toMatchObject({ routeDirectionsWithShape: 759, vehicles: 9261 });
    expect(returned).toMatchObject({ routeDirectionsWithShape: 759, vehicles: 9261 });
  });

  it('is what rehydrateState() itself now delegates to (same counts, one code path)', async () => {
    await rehydrateState(networkCountsPool(5, 5));
    expect(getNetworkCounts()).toMatchObject({ routeDirectionsWithShape: 5, vehicles: 5 });
  });
});
