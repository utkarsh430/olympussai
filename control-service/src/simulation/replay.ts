// Historical replay mode (blueprint 11.1 "Replay mode": "Reconstruct an
// actual day and compare 'no control' versus proposed control using the
// same disturbances"). `runHistoricalReplay` feeds a stored day's exact
// recorded inputs through the full mesoscopic engine and reports whether
// the reproduced KPIs match the independently-derived recorded KPIs
// within a documented tolerance (AC: "Simulator reproduces a stored
// historical day's KPIs within a documented tolerance"); `compareControlToNoControl`
// runs the same recorded day through two controllers to produce the
// no-control-vs-controlled comparison the blueprint also requires.
//
// See docs/CONTROL_SERVICE_SIMULATOR.md "Reproduction tolerance" for the
// documented tolerance value and rationale.
import { simulate } from './engine.js';
import { noControlController } from './controllers.js';
import type { Controller, HistoricalDayFixture, KpiSummary, SimulationResult } from './types.js';

/**
 * Default relative tolerance (2%) applied to the primary bunching KPIs
 * (mean headway, headway CV) and passenger KPIs, plus an absolute floor
 * so near-zero baselines don't produce a spuriously tight/loose
 * percentage. See docs/CONTROL_SERVICE_SIMULATOR.md for the rationale:
 * this fixture's capacity/separation are deliberately generous so the
 * engine's clamps never bind, meaning the two independent code paths
 * (full engine vs. `referenceKpi.ts`'s direct walk) should agree almost
 * exactly; 2% leaves headroom for legitimate floating-point summation
 * order differences without masking a real regression.
 */
export const DEFAULT_REPLAY_TOLERANCE_RATIO = 0.02;

const KPI_KEYS_CHECKED: Array<keyof KpiSummary> = [
  'meanHeadwaySeconds',
  'headwayCv',
  'bunchingIncidents',
  'excessWaitSeconds',
  'deniedBoardings',
  'strandedPassengers',
  'onTimeDispatchRate',
  'totalBoardings',
];

export interface KpiDelta {
  key: keyof KpiSummary;
  simulated: number | null;
  recorded: number | null;
  withinTolerance: boolean;
}

export interface ReplayComparison {
  simulated: SimulationResult;
  recordedKpis: KpiSummary;
  toleranceRatio: number;
  withinTolerance: boolean;
  deltas: KpiDelta[];
}

function withinTolerance(
  simulated: number | null,
  recorded: number | null,
  toleranceRatio: number,
): boolean {
  if (simulated === null && recorded === null) return true;
  if (simulated === null || recorded === null) return false;
  const absoluteFloor = 1; // avoid dividing by ~0 for near-zero recorded baselines
  const denominator = Math.max(Math.abs(recorded), absoluteFloor);
  return Math.abs(simulated - recorded) / denominator <= toleranceRatio;
}

/** Replays `fixture.recordedInputs` through the full engine and checks reproduction against `fixture.recordedKpis`. */
export function runHistoricalReplay(
  fixture: HistoricalDayFixture,
  controller: Controller = noControlController,
  toleranceRatio: number = DEFAULT_REPLAY_TOLERANCE_RATIO,
): ReplayComparison {
  const simulated = simulate(
    {
      name: `replay:${fixture.routeDirection.routeDirectionId}`,
      routeDirection: fixture.routeDirection,
      dispatches: fixture.dispatches,
      disturbances: [],
      seed: 1, // irrelevant in replay mode: recordedInputs fully determines travel/dwell, no sampling occurs
      recordedInputs: fixture.recordedInputs,
    },
    controller,
  );

  const deltas: KpiDelta[] = KPI_KEYS_CHECKED.map((key) => {
    const simulatedValue = simulated.kpis[key];
    const recordedValue = fixture.recordedKpis[key];
    return {
      key,
      simulated: simulatedValue,
      recorded: recordedValue,
      withinTolerance: withinTolerance(simulatedValue, recordedValue, toleranceRatio),
    };
  });

  return {
    simulated,
    recordedKpis: fixture.recordedKpis,
    toleranceRatio,
    withinTolerance: deltas.every((d) => d.withinTolerance),
    deltas,
  };
}

export interface NoControlVsControlledComparison {
  noControl: SimulationResult;
  controlled: SimulationResult;
}

/**
 * Runs the SAME recorded day (or any scenario, live or replayed) once
 * with `noControlController` and once with the supplied controller -
 * the "no-control vs controlled comparison" required by both the AC and
 * blueprint 11.1's "Replay mode" row. Both runs share the same
 * `recordedInputs`/seed, so any KPI difference is attributable to the
 * controller alone.
 */
export function compareControlToNoControl(
  fixture: HistoricalDayFixture,
  controller: Controller,
): NoControlVsControlledComparison {
  const base = {
    routeDirection: fixture.routeDirection,
    dispatches: fixture.dispatches,
    disturbances: [] as const,
    seed: 1,
    recordedInputs: fixture.recordedInputs,
  };
  const noControl = simulate(
    { ...base, name: `replay:${fixture.routeDirection.routeDirectionId}:no-control`, disturbances: [] },
    noControlController,
  );
  const controlled = simulate(
    { ...base, name: `replay:${fixture.routeDirection.routeDirectionId}:controlled`, disturbances: [] },
    controller,
  );
  return { noControl, controlled };
}
