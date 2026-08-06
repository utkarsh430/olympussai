import { describe, it, expect } from 'vitest';
import { simulate } from '../../src/simulation/engine.js';
import { noControlController } from '../../src/simulation/controllers.js';
import { SAMPLE_ROUTE_DIRECTION, SAMPLE_DISPATCHES } from '../../src/simulation/fixtures/sampleRouteDirection.js';
import type { ScenarioConfig } from '../../src/simulation/types.js';

function baseConfig(overrides: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return {
    name: 'engine-test',
    routeDirection: SAMPLE_ROUTE_DIRECTION,
    dispatches: SAMPLE_DISPATCHES,
    disturbances: [],
    seed: 42,
    ...overrides,
  };
}

describe('simulation engine', () => {
  it('is deterministic for a given seed', () => {
    const a = simulate(baseConfig(), noControlController);
    const b = simulate(baseConfig(), noControlController);
    expect(a).toEqual(b);
  });

  it('produces one visit per (vehicle, stop) pair', () => {
    const result = simulate(baseConfig(), noControlController);
    expect(result.visits).toHaveLength(SAMPLE_DISPATCHES.length * SAMPLE_ROUTE_DIRECTION.stops.length);
  });

  it('enforces monotonically increasing time per vehicle (arrival <= departure, departure <= next arrival)', () => {
    const result = simulate(baseConfig(), noControlController);
    const byVehicle = new Map<string, typeof result.visits>();
    for (const v of result.visits) {
      const bucket = byVehicle.get(v.vehicleId) ?? [];
      bucket.push(v);
      byVehicle.set(v.vehicleId, bucket);
    }
    for (const visits of byVehicle.values()) {
      const sorted = [...visits].sort((a, b) => a.stopIndex - b.stopIndex);
      for (let i = 0; i < sorted.length; i++) {
        const visit = sorted[i]!;
        expect(visit.departureSeconds).toBeGreaterThanOrEqual(visit.arrivalSeconds);
        const next = sorted[i + 1];
        if (next) expect(next.arrivalSeconds).toBeGreaterThanOrEqual(visit.departureSeconds);
      }
    }
  });

  it('enforces the no-overtake minimum separation between vehicles at the same stop', () => {
    const result = simulate(baseConfig(), noControlController);
    const byStop = new Map<string, number[]>();
    for (const v of result.visits) {
      const bucket = byStop.get(v.stopId) ?? [];
      bucket.push(v.arrivalSeconds);
      byStop.set(v.stopId, bucket);
    }
    for (const arrivals of byStop.values()) {
      const sorted = [...arrivals].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(
          SAMPLE_ROUTE_DIRECTION.minSeparationSeconds,
        );
      }
    }
  });

  it('never boards more passengers than remaining capacity allows', () => {
    const result = simulate(baseConfig(), noControlController);
    for (const v of result.visits) {
      expect(v.onboardAfter).toBeLessThanOrEqual(SAMPLE_ROUTE_DIRECTION.vehicleCapacity);
    }
  });

  it('rejects a route-direction whose stops/links lengths disagree', () => {
    const bad = baseConfig({
      routeDirection: { ...SAMPLE_ROUTE_DIRECTION, links: SAMPLE_ROUTE_DIRECTION.links.slice(0, 2) },
    });
    expect(() => simulate(bad, noControlController)).toThrow(/stops.length/);
  });

  it('skips a missed-trip vehicle entirely', () => {
    const result = simulate(
      baseConfig({ disturbances: [{ type: 'missed_trip', vehicleId: 'veh-2' }] }),
      noControlController,
    );
    expect(result.visits.some((v) => v.vehicleId === 'veh-2')).toBe(false);
    expect(result.visits).toHaveLength((SAMPLE_DISPATCHES.length - 1) * SAMPLE_ROUTE_DIRECTION.stops.length);
  });
});
