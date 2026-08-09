// stateStore.upsertVehicleState's ordering guard, and the estimate ->
// runtime-row projection that feeds it.
//
// The guard mirrors PgStateEstimationRepository.saveVehicleState's
// `where vehicle_states.observed_at <= excluded.observed_at` conflict
// clause. If the two ever disagree, this cache and that table hold
// different answers to "where is this bus", and a restart silently swaps
// one for the other - which is exactly the class of bug that is invisible
// until an incident review asks why the recorded position and the
// displayed position differ.
import { describe, it, expect, beforeEach } from 'vitest';
import { stateStore, type VehicleStateRow } from '../src/state/store.js';
import { vehicleStateRowFromEstimate } from '../src/state/fromEstimate.js';
import type { VehicleStateEstimate } from '../src/state-estimation/types.js';

function row(overrides: Partial<VehicleStateRow> = {}): VehicleStateRow {
  return {
    vehicleId: 'veh-1',
    tripId: null,
    routeDirectionId: 'rd-1',
    position: { lat: 12.9716, lon: 77.5946 },
    distanceAlongRouteMeters: 100,
    speedKmph: 20,
    headingDegrees: 90,
    stopState: 'off_route',
    currentStopId: null,
    confidence: 0.9,
    isLowConfidence: false,
    observedAt: '2026-08-05T08:00:00.000Z',
    occupancyCount: null,
    occupancyLoadBand: null,
    ...overrides,
  };
}

function estimate(overrides: Partial<VehicleStateEstimate> = {}): VehicleStateEstimate {
  return {
    vehicleId: 'veh-1',
    tripId: null,
    routeDirectionId: 'rd-1',
    rawPosition: { lat: 12.9716, lon: 77.5946 },
    distanceAlongRouteMeters: 250,
    speedKmph: 30,
    headingDegrees: 91,
    stopState: 'off_route',
    currentStopId: null,
    stopEnteredAt: null,
    confidence: 0.8,
    isLowConfidence: false,
    kalmanState: null,
    observedAt: '2026-08-05T08:01:00.000Z',
    ...overrides,
  };
}

describe('stateStore.upsertVehicleState', () => {
  beforeEach(() => {
    stateStore._resetForTests();
  });

  it('applies a newer fix', () => {
    stateStore.upsertVehicleState(row({ distanceAlongRouteMeters: 100 }));
    stateStore.upsertVehicleState(
      row({ distanceAlongRouteMeters: 400, observedAt: '2026-08-05T08:05:00.000Z' }),
    );
    expect(stateStore.getVehicleState('veh-1')?.distanceAlongRouteMeters).toBe(400);
  });

  it('drops an OUT-OF-ORDER fix rather than rewinding the vehicle', () => {
    stateStore.upsertVehicleState(
      row({ distanceAlongRouteMeters: 400, observedAt: '2026-08-05T08:05:00.000Z' }),
    );
    // A redelivered/late fix from five minutes earlier.
    stateStore.upsertVehicleState(
      row({ distanceAlongRouteMeters: 100, observedAt: '2026-08-05T08:00:00.000Z' }),
    );
    expect(stateStore.getVehicleState('veh-1')?.distanceAlongRouteMeters).toBe(400);
    expect(stateStore.getVehicleState('veh-1')?.observedAt).toBe('2026-08-05T08:05:00.000Z');
  });

  it('APPLIES a same-timestamp redelivery, matching the SQL guard (`<=`, not `<`)', () => {
    stateStore.upsertVehicleState(row({ distanceAlongRouteMeters: 100 }));
    stateStore.upsertVehicleState(row({ distanceAlongRouteMeters: 150 }));
    expect(stateStore.getVehicleState('veh-1')?.distanceAlongRouteMeters).toBe(150);
  });

  it('guards per vehicle, not globally: a late fix for one bus cannot block a fresh fix for another', () => {
    stateStore.upsertVehicleState(row({ vehicleId: 'a', observedAt: '2026-08-05T08:05:00.000Z' }));
    stateStore.upsertVehicleState(row({ vehicleId: 'b', observedAt: '2026-08-05T08:00:00.000Z' }));
    expect(stateStore.getVehicleState('b')?.observedAt).toBe('2026-08-05T08:00:00.000Z');
  });

  it('does not wipe other vehicles the way loadVehicleStates (wholesale replace) would', () => {
    stateStore.loadVehicleStates([row({ vehicleId: 'a' }), row({ vehicleId: 'b' })]);
    stateStore.upsertVehicleState(row({ vehicleId: 'c' }));
    expect(stateStore.listVehicleStates()).toHaveLength(3);
  });
});

describe('vehicleStateRowFromEstimate', () => {
  it('carries occupancy FORWARD from the prior row instead of nulling it', () => {
    // Occupancy never comes from a GPS fix, so a position update that
    // reset it would erase the only occupancy sample the MPC weighting
    // has - and it would do so on every single poll cycle.
    const prior = row({ occupancyCount: 42, occupancyLoadBand: 'full' });
    const projected = vehicleStateRowFromEstimate(estimate(), prior);
    expect(projected.occupancyCount).toBe(42);
    expect(projected.occupancyLoadBand).toBe('full');
  });

  it('leaves occupancy null when there is no prior', () => {
    const projected = vehicleStateRowFromEstimate(estimate());
    expect(projected.occupancyCount).toBeNull();
    expect(projected.occupancyLoadBand).toBeNull();
  });

  it('projects position/heading/confidence off the estimate so the store round-trips losslessly', () => {
    const projected = vehicleStateRowFromEstimate(
      estimate({ rawPosition: { lat: 26.85, lon: 80.95 }, headingDegrees: 275, isLowConfidence: true }),
    );
    expect(projected.position).toEqual({ lat: 26.85, lon: 80.95 });
    expect(projected.headingDegrees).toBe(275);
    expect(projected.isLowConfidence).toBe(true);
  });
});
