// One evaluation run: every corridor x scenario x seed x arm, plus the
// no-control baseline each of them is measured against.
//
// ─── PAIRING IS THE WHOLE METHOD ─────────────────────────────────────────
//
// Every arm and the baseline run the SAME seed on the SAME corridor under the
// SAME disturbance. The difference between two arms is then the controller
// and nothing else - no difference in the day, the demand draw, or the link
// times. `algo_new.md` section 8.3 rules out the alternative in as many
// words: do not use a naive before/after, because the thing that varies
// between two unpaired runs is mostly weather.
//
// This is also why the baseline is not an arm in the spec. It is computed
// once per (corridor, scenario, seed) cell and shared by every arm in that
// cell, which is both cheaper and structurally impossible to forget.
import { simulate, noControlController } from '../simulation/index.js';
import {
  buildRehearsalScenario,
  reportedKpis,
  summarizeHolds,
  isReported,
  REHEARSAL_EPOCH_MS,
} from '../rehearsal/run.js';
import { createDeployedControlLawsController } from '../rehearsal/deployedControlLaws.js';
import type { RehearsalDecisionRecord } from '../rehearsal/deployedControlLaws.js';
import type { CorridorInputs } from '../rehearsal/corridor.js';
import type { RoutePolicyRow } from '../state/store.js';
import type { Disturbance, KpiSummary } from '../simulation/types.js';
import type { ModelledInputs, RehearsalDisturbance } from '../rehearsal/run.js';
import type { ArmSpec, ExperimentSpec } from './spec.js';
import type { CorridorCalibration } from './calibrate.js';
import { assessControllability } from '../lib/controllability.js';
import type { Controllability } from '../lib/controllability.js';
import { resolveInputs, seedsFor } from './spec.js';

export interface RunCell {
  routeDirectionId: string;
  scenario: RehearsalDisturbance;
  seed: number;
  armName: string;
  baseline: KpiSummary;
  controlled: KpiSummary;
  appliedHoldSeconds: number;
  refusedHoldSeconds: number;
  decisions: readonly RehearsalDecisionRecord[];
}

export interface ExperimentRun {
  spec: ExperimentSpec;
  corridorProvenance: 'measured' | 'synthetic';
  /** Per corridor, what was fitted from observation and what stayed invented. Empty when the run was not calibrated. */
  calibration: Map<string, CorridorCalibration>;
  cells: RunCell[];
  /** Corridors that produced no headway sample at all, so nothing about them is measurable. Named rather than dropped. */
  emptyCorridors: string[];
  /**
   * Where each corridor sits on the controllability curve, so a reader can
   * tell what a verdict is about.
   *
   * This harness reported none of it, and the most dangerous thing it can
   * print is a damning verdict about the control laws that is really a
   * statement about the corridor. MEASURED on its own synthetic fixture: an
   * uncontrolled excess wait of 24-30 s against a 900 s headway, with the
   * controller reading 48-98% WORSE - which is exactly what holding does to a
   * corridor that was never bunched, and reads as a controller failure if
   * nobody says which regime it came from. See `lib/controllability.ts`.
   */
  controllability: Map<string, Controllability>;
  durationMs: number;
}

/** The corridor with one arm's parameter overrides applied. Overrides are on the POLICY, which is what the control laws read. */
function withOverrides(corridor: CorridorInputs, arm: ArmSpec): CorridorInputs {
  const policy: RoutePolicyRow = { ...corridor.policy, ...arm.policyOverrides };
  return { ...corridor, policy };
}

/** Every simulated vehicle at the same compliance probability - the fleet-wide condition the robustness sweep needs. */
export function fleetWideNonCompliance(
  corridor: CorridorInputs,
  inputs: ModelledInputs,
  complianceProbability: number,
): Disturbance[] {
  const { dispatches } = buildRehearsalScenario(corridor, inputs);
  return dispatches
    .filter((dispatch) => isReported(dispatch.vehicleId))
    .map((dispatch) => ({
      type: 'non_compliance' as const,
      vehicleId: dispatch.vehicleId,
      complianceProbability,
    }));
}

export interface RunOneResult {
  baseline: KpiSummary;
  controlled: KpiSummary;
  appliedHoldSeconds: number;
  refusedHoldSeconds: number;
  decisions: readonly RehearsalDecisionRecord[];
}

/**
 * One (corridor, scenario, seed, arm) cell.
 *
 * Composed from `rehearsal/run.ts`'s exported scenario builder rather than by
 * calling `runRehearsal`, because that function also renders 60 map frames
 * per arm for a UI - the dominant cost of a batch, read by nobody in one.
 * Everything that decides the numbers is the same function.
 */
export function runCell(
  corridor: CorridorInputs,
  arm: ArmSpec,
  inputs: ModelledInputs,
  /**
   * Replaces the disturbances the scenario builder derived from
   * `inputs.disturbance`. Used by the robustness sweeps, which need a
   * FLEET-WIDE condition (every driver at 50% compliance) where the scenario
   * library models a single disturbed vehicle. Both are worth running and
   * they answer different questions: one asks whether the controller survives
   * one bad actor, the other whether it survives a service where nobody much
   * follows instructions - which is the regime the CTA deployment in
   * `algo_new.md` section 4.1 actually achieved its results in.
   */
  overrideDisturbances?: Disturbance[],
  /** Fitted per-stop demand and per-link travel time, when this corridor has been calibrated. */
  calibration?: CorridorCalibration,
): RunOneResult {
  const tuned = withOverrides(corridor, arm);
  const built = buildRehearsalScenario(tuned, inputs, calibration?.overrides ?? {});
  const scenario = overrideDisturbances
    ? { ...built.scenario, disturbances: overrideDisturbances }
    : built.scenario;

  const uncontrolled = simulate(scenario, noControlController);
  const controller = createDeployedControlLawsController({
    policy: tuned.policy,
    epochMs: REHEARSAL_EPOCH_MS,
    modelledCapacity: inputs.vehicleCapacity,
    costOptimalSelectable: arm.costOptimalSelectable,
    weighOccupancy: arm.weighOccupancy,
  });
  const controlled = simulate(scenario, controller);

  const holds = summarizeHolds(controlled.visits.filter((v) => isReported(v.vehicleId)));

  return {
    baseline: reportedKpis(uncontrolled.visits, tuned),
    controlled: reportedKpis(controlled.visits, tuned),
    appliedHoldSeconds: holds.applied,
    refusedHoldSeconds: holds.refused,
    decisions: controller.decisions.filter((d) => isReported(d.vehicleId)),
  };
}

export function runExperiment(
  spec: ExperimentSpec,
  corridors: readonly CorridorInputs[],
  corridorProvenance: 'measured' | 'synthetic',
  onProgress?: (done: number, total: number) => void,
  calibration: ReadonlyMap<string, CorridorCalibration> = new Map(),
): ExperimentRun {
  const startedAt = Date.now();
  const seeds = seedsFor(spec);
  const scenarios = spec.scenarios as RehearsalDisturbance[];
  const cells: RunCell[] = [];
  const emptyCorridors = new Set<string>();
  const controllability = new Map<string, Controllability>();
  // The corridor's shape does not depend on the seed or the scenario, so one
  // resolution of the inputs answers for all of them.
  const baseInputs = resolveInputs(spec, seeds[0] ?? 0, scenarios[0] ?? 'none');

  const total = corridors.length * scenarios.length * seeds.length * spec.arms.length;
  let done = 0;

  for (const corridor of corridors) {
    // The corridor's own shape, not any one run's - it depends on geometry,
    // cruise speed, variability and headway, all of which are fixed here.
    controllability.set(
      corridor.routeDirectionId,
      assessControllability({
        cumulativeDistanceMeters: corridor.stops.map((stop) => stop.cumulativeDistanceMeters),
        cruiseSpeedKmph: baseInputs.cruiseSpeedKmph,
        travelTimeVariation: baseInputs.travelTimeVariation,
        targetHeadwaySeconds: corridor.policy.targetHeadwaySeconds,
      }),
    );
    let sawSample = false;
    for (const scenario of scenarios) {
      for (const seed of seeds) {
        const inputs = resolveInputs(spec, seed, scenario);
        for (const arm of spec.arms) {
          const result = runCell(
            corridor,
            arm,
            inputs,
            undefined,
            calibration.get(corridor.routeDirectionId),
          );
          if (result.baseline.headwaySampleCount > 0) sawSample = true;
          cells.push({
            routeDirectionId: corridor.routeDirectionId,
            scenario,
            seed,
            armName: arm.name,
            ...result,
          });
          done++;
          if (onProgress && done % 200 === 0) onProgress(done, total);
        }
      }
    }
    // A corridor whose runs produced no headway sample has no measurable
    // dispersion, so every KPI on it is null. Reported by name: silently
    // dropping it would shrink an experiment's denominator without saying so.
    if (!sawSample) emptyCorridors.add(corridor.routeDirectionId);
  }

  if (onProgress) onProgress(done, total);

  return {
    spec,
    corridorProvenance,
    calibration: new Map(calibration),
    cells,
    emptyCorridors: [...emptyCorridors],
    controllability,
    durationMs: Date.now() - startedAt,
  };
}
