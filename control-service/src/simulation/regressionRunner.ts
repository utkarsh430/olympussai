// Runs the regression scenario library (`scenarios/index.ts`) against a
// set of controllers and checks a fixed set of guardrail assertions on
// each result - the mechanism behind the AC "Regression scenarios ...
// auto-run as a release gate." The gate itself is
// `test/simulation/regression.test.ts`, which calls `runRegressionSuite`
// and fails (non-zero exit) if any guardrail is violated; that test file
// runs on every PR touching `control-service/**` via
// `.github/workflows/ci-control-service.yml`'s `pnpm test` step, so a
// guardrail violation blocks merge exactly like any other failing test -
// no separate gating mechanism was introduced.
import { simulate } from './engine.js';
import { ALL_SCENARIOS } from './scenarios/index.js';
import type { Controller, ScenarioConfig, SimulationResult } from './types.js';

export interface RegressionCase {
  scenarioName: string;
  controllerName: string;
  result: SimulationResult;
  violations: string[];
}

/**
 * Guardrails that must hold for every (scenario, controller) pair,
 * independent of which controller is under test:
 *   - no NaN/Infinity anywhere in the KPI summary or per-visit records
 *     (a modeling bug, e.g. division by a zero-sample headway list,
 *     must fail loudly rather than silently produce garbage KPIs).
 *   - every applied hold stays within [0, maxHoldSeconds] - the safety
 *     bound a real controller must also respect.
 *   - no hold is ever applied to a visit whose state was stale
 *     (`gps_dropout`) - a controller that acts on missing/unreliable
 *     state is unsafe by construction, so this is checked directly
 *     against the visit records rather than trusted from the
 *     controller's own logic.
 *   - counts (boardings, denied boardings, etc.) are never negative.
 */
function checkUniversalGuardrails(result: SimulationResult, maxHoldSeconds: number): string[] {
  const violations: string[] = [];
  const kpiValues = Object.values(result.kpis).filter((v): v is number => typeof v === 'number');
  for (const value of kpiValues) {
    if (!Number.isFinite(value)) {
      violations.push(`non-finite KPI value: ${value}`);
    }
  }
  for (const visit of result.visits) {
    if (visit.appliedHoldSeconds < 0 || visit.appliedHoldSeconds > maxHoldSeconds) {
      violations.push(
        `applied hold ${visit.appliedHoldSeconds}s out of bounds [0, ${maxHoldSeconds}] for ${visit.vehicleId}@${visit.stopId}`,
      );
    }
    if (visit.isStateStale && visit.appliedHoldSeconds > 0) {
      violations.push(
        `hold applied to ${visit.vehicleId}@${visit.stopId} while its state was stale (gps_dropout)`,
      );
    }
    if (visit.boardings < 0 || visit.alightings < 0 || visit.deniedBoardings < 0) {
      violations.push(`negative passenger count at ${visit.vehicleId}@${visit.stopId}`);
    }
  }
  return violations;
}

export function runRegressionSuite(controllers: Controller[]): RegressionCase[] {
  const cases: RegressionCase[] = [];
  for (const buildScenario of ALL_SCENARIOS) {
    const config: ScenarioConfig = buildScenario();
    for (const controller of controllers) {
      const result = simulate(config, controller);
      const violations = checkUniversalGuardrails(result, config.routeDirection.maxHoldSeconds);
      cases.push({ scenarioName: config.name, controllerName: controller.name, result, violations });
    }
  }
  return cases;
}
