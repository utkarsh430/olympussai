// Public surface of the simulator. Deliberately NOT re-exported from
// `../index.ts` (the process entrypoint - importing it starts the HTTP
// server and kicks off live-DB rehydration as a side effect, see that
// file's header comment). Import from `control-service/src/simulation/index.js`
// directly, exactly as the tests under `test/simulation/` do, to keep the
// simulator fully decoupled from the live process per the AC "never touch
// the live command path."
export * from './types.js';
export { Rng } from './rng.js';
export { simulate } from './engine.js';
export { noControlController, createSelfEqualizingController } from './controllers.js';
export { summarizeKpis, computeHeadwaySamples } from './kpi.js';
export { computeReferenceKpisFromRecordedInputs } from './referenceKpi.js';
export {
  runHistoricalReplay,
  compareControlToNoControl,
  DEFAULT_REPLAY_TOLERANCE_RATIO,
} from './replay.js';
export type { ReplayComparison, KpiDelta, NoControlVsControlledComparison } from './replay.js';
export { runRegressionSuite } from './regressionRunner.js';
export type { RegressionCase } from './regressionRunner.js';
export { ALL_SCENARIOS, demandBurstScenario, missedTripScenario, gpsDropoutScenario, nonComplianceScenario } from './scenarios/index.js';
export { SAMPLE_ROUTE_DIRECTION, SAMPLE_DISPATCHES } from './fixtures/sampleRouteDirection.js';
export { HISTORICAL_DAY_FIXTURE, HISTORICAL_ROUTE_DIRECTION } from './fixtures/historicalDay.js';
