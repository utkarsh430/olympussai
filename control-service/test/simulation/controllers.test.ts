import { describe, it, expect } from 'vitest';
import { simulate } from '../../src/simulation/engine.js';
import { noControlController, createSelfEqualizingController } from '../../src/simulation/controllers.js';
import { SAMPLE_ROUTE_DIRECTION, SAMPLE_DISPATCHES } from '../../src/simulation/fixtures/sampleRouteDirection.js';
import type { ScenarioConfig } from '../../src/simulation/types.js';

const selfEqualizing = createSelfEqualizingController({ gain: 0.6 });

function configWithDisturbance(): ScenarioConfig {
  return {
    name: 'controllers-test',
    routeDirection: SAMPLE_ROUTE_DIRECTION,
    dispatches: SAMPLE_DISPATCHES,
    // Demand burst pushes a vehicle's dwell up, opening a gap - exactly
    // the kind of deviation a self-equalizing controller should correct.
    disturbances: [{ type: 'demand_burst', stopId: 'stop-3', startSeconds: 0, endSeconds: 900, multiplier: 10 }],
    seed: 7,
  };
}

describe('pluggable controller interface: no-control vs controlled comparison', () => {
  it('noControlController never issues a hold', () => {
    const result = simulate(configWithDisturbance(), noControlController);
    expect(result.visits.every((v) => v.appliedHoldSeconds === 0)).toBe(true);
    expect(result.visits.every((v) => v.intendedHoldSeconds === 0)).toBe(true);
  });

  it('the same scenario run under two controllers produces comparable, independently attributable results', () => {
    const noControlResult = simulate(configWithDisturbance(), noControlController);
    const controlledResult = simulate(configWithDisturbance(), selfEqualizing);

    expect(noControlResult.controllerName).toBe('no-control');
    expect(controlledResult.controllerName).toBe('self-equalizing');
    // Same scenario (same seed/inputs) means any difference is attributable to the controller alone.
    expect(controlledResult.visits.some((v) => v.appliedHoldSeconds > 0)).toBe(true);
  });

  it('self-equalizing controller reduces headway coefficient of variation relative to no control', () => {
    const noControlResult = simulate(configWithDisturbance(), noControlController);
    const controlledResult = simulate(configWithDisturbance(), selfEqualizing);

    expect(noControlResult.kpis.headwayCv).not.toBeNull();
    expect(controlledResult.kpis.headwayCv).not.toBeNull();
    expect(controlledResult.kpis.headwayCv!).toBeLessThanOrEqual(noControlResult.kpis.headwayCv!);
  });

  it('never issues a hold when the vehicle state is stale (gps dropout guardrail)', () => {
    const config: ScenarioConfig = {
      name: 'gps-dropout-guardrail',
      routeDirection: SAMPLE_ROUTE_DIRECTION,
      dispatches: SAMPLE_DISPATCHES,
      disturbances: [
        { type: 'demand_burst', stopId: 'stop-3', startSeconds: 0, endSeconds: 900, multiplier: 10 },
        { type: 'gps_dropout', vehicleId: 'veh-2', startSeconds: 0, endSeconds: 3600 },
      ],
      seed: 7,
    };
    const result = simulate(config, selfEqualizing);
    const staleVisits = result.visits.filter((v) => v.isStateStale);
    expect(staleVisits.length).toBeGreaterThan(0);
    expect(staleVisits.every((v) => v.appliedHoldSeconds === 0)).toBe(true);
  });

  it('clamps holds to the route-direction max hold', () => {
    const aggressive = createSelfEqualizingController({ gain: 50 });
    const result = simulate(configWithDisturbance(), aggressive);
    for (const v of result.visits) {
      expect(v.appliedHoldSeconds).toBeLessThanOrEqual(SAMPLE_ROUTE_DIRECTION.maxHoldSeconds);
      expect(v.intendedHoldSeconds).toBeLessThanOrEqual(SAMPLE_ROUTE_DIRECTION.maxHoldSeconds);
    }
  });
});
