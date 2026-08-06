// Regression scenario: a vehicle's position feed goes stale for a window
// (blueprint section on reliability: "Simulation tests for ... GPS
// dropout"). Exercises the guardrail that no controller in this module
// issues a hold when `context.isStateStale` is true - see
// `controllers.ts` and the assertion in
// `test/simulation/regression.test.ts`.
import { SAMPLE_ROUTE_DIRECTION, SAMPLE_DISPATCHES } from '../fixtures/sampleRouteDirection.js';
import type { ScenarioConfig } from '../types.js';

export function gpsDropoutScenario(): ScenarioConfig {
  return {
    name: 'gps-dropout',
    routeDirection: SAMPLE_ROUTE_DIRECTION,
    dispatches: SAMPLE_DISPATCHES,
    seed: 1003,
    disturbances: [
      // veh-3 goes dark for the whole run, including both its control-point visits.
      { type: 'gps_dropout', vehicleId: 'veh-3', startSeconds: 0, endSeconds: 3600 },
    ],
  };
}
