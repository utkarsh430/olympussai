// Regression scenario: one scheduled trip never dispatches (blueprint
// 11.1 "Operations" row: "Terminal dispatch, missed trip, breakdown,
// driver non-compliance, no-overtake segments"). Downstream effect is
// modeled implicitly: the next vehicle inherits a larger accumulated wait
// window at every stop (see engine.ts's `lastDepartureAtStop` bookkeeping)
// and a bigger leader-headway gap, exactly as a real missed trip would
// produce.
import { SAMPLE_ROUTE_DIRECTION, SAMPLE_DISPATCHES } from '../fixtures/sampleRouteDirection.js';
import type { ScenarioConfig } from '../types.js';

export function missedTripScenario(): ScenarioConfig {
  return {
    name: 'missed-trip',
    routeDirection: SAMPLE_ROUTE_DIRECTION,
    dispatches: SAMPLE_DISPATCHES,
    seed: 1002,
    disturbances: [{ type: 'missed_trip', vehicleId: 'veh-2' }],
  };
}
