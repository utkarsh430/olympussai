// Release-gate regression suite (AC: "Regression scenarios (demand
// burst, missed trip, GPS dropout, non-compliance) auto-run as a release
// gate"). This file is picked up by `vitest.config.ts`'s
// `test/**/*.test.ts` include, so `pnpm test` runs it - and
// `.github/workflows/ci-control-service.yml` runs `pnpm test` on every
// PR touching `control-service/**`. A guardrail violation here fails
// this test, which fails that CI job, which is the release gate; no
// separate scheduler or workflow was needed.
import { describe, it, expect } from 'vitest';
import { runRegressionSuite } from '../../src/simulation/regressionRunner.js';
import { noControlController, createSelfEqualizingController } from '../../src/simulation/controllers.js';
import { ALL_SCENARIOS } from '../../src/simulation/scenarios/index.js';

const REQUIRED_SCENARIO_NAMES = ['demand-burst', 'missed-trip', 'gps-dropout', 'non-compliance'];

describe('regression scenario library (release gate)', () => {
  it('includes all four required scenario categories', () => {
    const names = ALL_SCENARIOS.map((build) => build().name);
    for (const required of REQUIRED_SCENARIO_NAMES) {
      expect(names).toContain(required);
    }
  });

  it('every scenario passes universal guardrails under no-control and under the self-equalizing controller', () => {
    const controllers = [noControlController, createSelfEqualizingController({ gain: 0.5 })];
    const cases = runRegressionSuite(controllers);

    expect(cases.length).toBe(ALL_SCENARIOS.length * controllers.length);

    const failures = cases.filter((c) => c.violations.length > 0);
    if (failures.length > 0) {
      const report = failures
        .map((f) => `${f.scenarioName} / ${f.controllerName}:\n  - ${f.violations.join('\n  - ')}`)
        .join('\n');
      throw new Error(`regression guardrail violations:\n${report}`);
    }
  });

  it('the non-compliance scenario reports a compliance rate below 100% (driver ignores some holds)', () => {
    const cases = runRegressionSuite([createSelfEqualizingController({ gain: 0.6 })]);
    const nonCompliance = cases.find((c) => c.scenarioName === 'non-compliance');
    expect(nonCompliance).toBeDefined();
    expect(nonCompliance!.result.kpis.complianceRate).not.toBeNull();
    expect(nonCompliance!.result.kpis.complianceRate!).toBeLessThan(1);
  });

  it('the missed-trip scenario runs one fewer vehicle without crashing and reports it via visit count', () => {
    const cases = runRegressionSuite([noControlController]);
    const missedTrip = cases.find((c) => c.scenarioName === 'missed-trip');
    expect(missedTrip).toBeDefined();
    expect(missedTrip!.result.visits.some((v) => v.vehicleId === 'veh-2')).toBe(false);
  });

  it('the demand-burst scenario increases boardings at the affected stop without denying capacity guardrails', () => {
    const cases = runRegressionSuite([noControlController]);
    const demandBurst = cases.find((c) => c.scenarioName === 'demand-burst');
    expect(demandBurst).toBeDefined();
    expect(demandBurst!.result.kpis.totalBoardings).toBeGreaterThan(0);
    expect(demandBurst!.violations).toHaveLength(0);
  });
});
