// Regression scenario: a driver ignores hold instructions (blueprint
// 11.1 "Operations" row: "driver non-compliance"; also explicitly listed
// among the required reliability simulation tests). Exercises that the
// engine correctly tracks intended-vs-applied hold and compliance rate
// (`KpiSummary.complianceRate`) rather than assuming every issued command
// is obeyed - a documented, known gap the real command path also has to
// handle (acknowledgement, not assumed receipt).
import { SAMPLE_ROUTE_DIRECTION, SAMPLE_DISPATCHES } from '../fixtures/sampleRouteDirection.js';
import type { ScenarioConfig } from '../types.js';

export function nonComplianceScenario(): ScenarioConfig {
  return {
    name: 'non-compliance',
    routeDirection: SAMPLE_ROUTE_DIRECTION,
    dispatches: SAMPLE_DISPATCHES,
    seed: 1004,
    disturbances: [
      // veh-4 ignores 70% of hold instructions issued to it.
      { type: 'non_compliance', vehicleId: 'veh-4', complianceProbability: 0.3 },
    ],
  };
}
