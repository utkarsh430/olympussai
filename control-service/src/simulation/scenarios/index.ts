// The regression scenario library required by the AC: "Regression
// scenarios (demand burst, missed trip, GPS dropout, non-compliance)
// auto-run as a release gate." `ALL_SCENARIOS` is what
// `regressionRunner.ts` (and, transitively, `test/simulation/regression.test.ts`)
// iterates - add a new scenario builder here to add it to the gate.
import { demandBurstScenario } from './demandBurst.js';
import { missedTripScenario } from './missedTrip.js';
import { gpsDropoutScenario } from './gpsDropout.js';
import { nonComplianceScenario } from './nonCompliance.js';
import type { ScenarioConfig } from '../types.js';

export { demandBurstScenario, missedTripScenario, gpsDropoutScenario, nonComplianceScenario };

export const ALL_SCENARIOS: Array<() => ScenarioConfig> = [
  demandBurstScenario,
  missedTripScenario,
  gpsDropoutScenario,
  nonComplianceScenario,
];
