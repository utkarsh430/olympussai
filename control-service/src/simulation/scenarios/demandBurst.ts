// Regression scenario: a sudden demand spike at one stop (blueprint 11.1
// "Operations" / release-tests rows; "demand bursts" is explicitly listed
// among the required simulation tests in the blueprint's reliability
// section too).
import { SAMPLE_ROUTE_DIRECTION, SAMPLE_DISPATCHES } from '../fixtures/sampleRouteDirection.js';
import type { ScenarioConfig } from '../types.js';

export function demandBurstScenario(): ScenarioConfig {
  return {
    name: 'demand-burst',
    routeDirection: SAMPLE_ROUTE_DIRECTION,
    dispatches: SAMPLE_DISPATCHES,
    seed: 1001,
    disturbances: [
      // 8x the normal boarding rate at stop-3 for a 20-minute window
      // spanning the second and third dispatches.
      { type: 'demand_burst', stopId: 'stop-3', startSeconds: 500, endSeconds: 1700, multiplier: 8 },
    ],
  };
}
