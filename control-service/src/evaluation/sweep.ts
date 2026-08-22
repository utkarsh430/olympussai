// Finding better gains, and refusing to recommend them when the evidence
// does not support it.
//
// ─── TWO STAGES, BECAUSE A FULL GRID IS MOSTLY WASTE ─────────────────────
//
// A grid over four parameters at forty seeds on ten corridors and five
// scenarios is millions of runs, and almost all of them evaluate points
// nobody would consider. So: a coarse grid at few seeds to find the region,
// then coordinate descent at many seeds to find the point and to measure it
// well enough to act on. The cheap stage decides WHERE to look; only the
// expensive stage produces a number anyone is asked to believe.
//
// ─── WHAT DISQUALIFIES A WINNER ──────────────────────────────────────────
//
// Lowest headline metric is necessary and nowhere near sufficient:
//
//   * the improvement's confidence interval must exclude zero, and it must
//     win on more seeds than it loses (`statistics.ts#isImprovement`);
//   * no guardrail metric may be significantly worse - a spacing gain bought
//     by leaving more passengers at the kerb is not a gain;
//   * the laws being tuned must actually have RUN. A sweep over `kf`/`kb`
//     on a corridor where two-way holding never generated a candidate
//     produces a flat surface, and the flatness means "unmeasured", not
//     "insensitive". This is the failure the whole harness was built after.
import { runExperiment } from './runner.js';
import { buildReport, type ArmSummary } from './report.js';
import { GUARDRAIL_METRICS, HEADLINE_METRIC } from './metrics.js';
import { isImprovement } from './statistics.js';
import type { CorridorInputs } from '../rehearsal/corridor.js';
import type { ArmSpec, ExperimentSpec, PolicyOverride } from './spec.js';
import type { ControlLaw } from '../rehearsal/deployedControlLaws.js';

export interface SweepGrid {
  kf?: number[];
  kb?: number[];
  selfEqualizingK?: number[];
  maxHoldSeconds?: number[];
  bunchedThresholdRatio?: number[];
}

/**
 * The default coarse grid.
 *
 * Centred on what the seeder actually writes (`seed/harvest.ts#DEFAULT_GAINS`:
 * kf 0.4, kb 0.2, k 0.35) and the raised hold cap of 600s, so the deployed
 * setting is a point ON the grid rather than somewhere between two of them -
 * otherwise "the best grid point beats today" cannot be distinguished from
 * "the grid never tried today".
 */
export const DEFAULT_COARSE_GRID: Required<Pick<SweepGrid, 'kf' | 'kb' | 'selfEqualizingK' | 'maxHoldSeconds'>> = {
  kf: [0.2, 0.4, 0.6, 0.8],
  kb: [0, 0.2, 0.4],
  selfEqualizingK: [0.2, 0.35, 0.5, 0.7],
  maxHoldSeconds: [90, 180, 300, 600],
};

export interface SweepOptions {
  grid?: SweepGrid;
  /** Seeds for the coarse stage. Few, deliberately - this stage ranks, it does not conclude. */
  coarseSeeds?: number;
  /** Seeds for the refinement stage, which does conclude. */
  refineSeeds?: number;
  /** How many coarse points to carry into refinement. */
  refineTop?: number;
  onProgress?: (message: string) => void;
}

export interface SweepPoint {
  overrides: PolicyOverride;
  summary: ArmSummary;
  headline: number | null;
  /** Improvement over no control on the headline metric, and passing every guardrail. */
  recommendable: boolean;
  disqualifiedBecause: string[];
}

export interface SweepResult {
  routeDirectionId: string;
  /** The corridor's current settings, evaluated on the same footing as every candidate. */
  baselinePoint: SweepPoint;
  best: SweepPoint | null;
  evaluated: SweepPoint[];
  /** Laws that never generated a candidate anywhere in this sweep, with the parameters they would have been tuning. */
  silentLaws: Array<{ law: ControlLaw; tunes: string[] }>;
}

const LAW_PARAMETERS: Record<ControlLaw, string[]> = {
  terminal_dispatch: ['maxHoldSeconds', 'ks'],
  two_way: ['kf', 'kb'],
  self_equalizing: ['selfEqualizingK'],
  cost_optimal: [],
  boarding_limit: ['bunchedThresholdRatio'],
};

function cartesian(grid: SweepGrid): PolicyOverride[] {
  const keys = Object.keys(grid) as Array<keyof SweepGrid>;
  let points: PolicyOverride[] = [{}];
  for (const key of keys) {
    const values = grid[key];
    if (!values || values.length === 0) continue;
    points = points.flatMap((point) => values.map((value) => ({ ...point, [key]: value })));
  }
  return points;
}

function overrideLabel(overrides: PolicyOverride): string {
  const entries = Object.entries(overrides);
  if (entries.length === 0) return 'as-configured';
  return entries.map(([key, value]) => `${key}=${value}`).join(' ');
}

/** One grid point, evaluated on one corridor as its own single-arm experiment. */
function evaluatePoint(
  spec: ExperimentSpec,
  corridor: CorridorInputs,
  overrides: PolicyOverride,
  seeds: number,
): SweepPoint {
  const arm: ArmSpec = { name: overrideLabel(overrides), policyOverrides: overrides };
  const pointSpec: ExperimentSpec = {
    ...spec,
    seeds: { ...spec.seeds, count: seeds },
    arms: [arm],
  };
  const run = runExperiment(pointSpec, [corridor], 'measured');
  const report = buildReport(run);

  // One corridor, one arm; scenarios are pooled by averaging their headline
  // differences, because a gain set has to hold across the disturbances a
  // corridor actually meets rather than win on the quiet day.
  const summaries = report.summaries;
  const headlines = summaries
    .map((s) => s.metrics[HEADLINE_METRIC].meanDifference)
    .filter((v): v is number => v !== null);
  const headline = headlines.length > 0 ? headlines.reduce((a, b) => a + b, 0) / headlines.length : null;

  const disqualifiedBecause: string[] = [];
  const merged = summaries[0];
  if (!merged) {
    disqualifiedBecause.push('no runs produced a summary');
  } else {
    const improved = summaries.some((s) => isImprovement(s.metrics[HEADLINE_METRIC], true));
    if (!improved) {
      disqualifiedBecause.push(
        `no significant improvement in ${HEADLINE_METRIC} on any scenario (interval spans zero)`,
      );
    }
    for (const guardrail of GUARDRAIL_METRICS) {
      const worsened = summaries.find((s) => {
        const d = s.metrics[guardrail];
        return d.significant && d.meanDifference !== null && d.meanDifference > 0;
      });
      if (worsened) {
        disqualifiedBecause.push(
          `${guardrail} significantly worse on ${worsened.scenario} (+${worsened.metrics[guardrail].meanDifference?.toFixed(1)})`,
        );
      }
    }
  }

  return {
    overrides,
    summary: merged ?? ({} as ArmSummary),
    headline,
    recommendable: disqualifiedBecause.length === 0,
    disqualifiedBecause,
  };
}

export function sweepCorridor(
  spec: ExperimentSpec,
  corridor: CorridorInputs,
  options: SweepOptions = {},
): SweepResult {
  const grid = options.grid ?? DEFAULT_COARSE_GRID;
  const coarseSeeds = options.coarseSeeds ?? 8;
  const refineSeeds = options.refineSeeds ?? 40;
  const refineTop = options.refineTop ?? 5;
  const log = options.onProgress ?? (() => {});

  const baselinePoint = evaluatePoint(spec, corridor, {}, refineSeeds);

  const coarsePoints = cartesian(grid);
  log(`${corridor.routeDirectionId}: coarse stage, ${coarsePoints.length} points x ${coarseSeeds} seeds`);
  const coarse = coarsePoints.map((overrides) => evaluatePoint(spec, corridor, overrides, coarseSeeds));

  const ranked = [...coarse]
    .filter((point) => point.headline !== null)
    .sort((a, b) => (a.headline ?? 0) - (b.headline ?? 0))
    .slice(0, refineTop);

  log(`${corridor.routeDirectionId}: refining ${ranked.length} points x ${refineSeeds} seeds`);
  const refined = ranked.map((point) => evaluatePoint(spec, corridor, point.overrides, refineSeeds));

  const recommendable = refined
    .filter((point) => point.recommendable && point.headline !== null)
    .sort((a, b) => (a.headline ?? 0) - (b.headline ?? 0));

  // Which laws were being tuned but never ran. Read off the baseline point,
  // whose coverage is the corridor's own, so a silent law is reported once
  // rather than once per grid point.
  const silent: SweepResult['silentLaws'] = [];
  const coverage = baselinePoint.summary?.coverage;
  if (coverage) {
    for (const law of coverage.laws) {
      if (law.generatedAt > 0) continue;
      const tunes = (LAW_PARAMETERS[law.law] ?? []).filter((parameter) => parameter in grid);
      if (tunes.length > 0) silent.push({ law: law.law, tunes });
    }
  }

  return {
    routeDirectionId: corridor.routeDirectionId,
    baselinePoint,
    best: recommendable[0] ?? null,
    evaluated: refined,
    silentLaws: silent,
  };
}

/**
 * The SQL a recommendation implies, printed rather than run.
 *
 * `route_policies` is versioned by `effective_from`/`effective_to`, so a new
 * setting closes the current row and inserts a successor rather than updating
 * in place - the history of what the controller was doing when a KPI was
 * recorded is the only way a past pilot result stays interpretable.
 *
 * Printed by default because applying it changes what the live controller
 * does on a real corridor, on the strength of a demand model nobody has
 * calibrated. That is a decision for a person.
 */
export function renderApplySql(result: SweepResult): string {
  if (!result.best) {
    return `-- ${result.routeDirectionId}: no recommendable setting. ${
      result.evaluated[0]?.disqualifiedBecause.join('; ') ?? 'no points evaluated'
    }\n`;
  }
  const overrides = result.best.overrides;
  const columns: Record<string, string> = {
    kf: 'kf',
    kb: 'kb',
    selfEqualizingK: 'self_equalizing_k',
    maxHoldSeconds: 'max_hold_seconds',
    bunchedThresholdRatio: 'bunched_threshold_ratio',
    warningThresholdRatio: 'warning_threshold_ratio',
    ks: 'ks',
  };
  return [
    `-- ${result.routeDirectionId}: ${overrideLabel(overrides)}`,
    `-- headline change ${result.best.headline?.toFixed(2) ?? '-'}s excess wait vs no control`,
    `-- REVIEW BEFORE RUNNING. Tuned against a modelled demand profile, not measured boardings.`,
    'begin;',
    `update route_policies set effective_to = now()`,
    ` where route_direction_id = '${result.routeDirectionId}' and effective_to is null;`,
    `insert into route_policies (route_direction_id, operating_period, day_type, effective_from, ${Object.keys(
      overrides,
    )
      .map((key) => columns[key] ?? key)
      .join(', ')})`,
    `select route_direction_id, operating_period, day_type, now(), ${Object.values(overrides)
      .map((value) => (value === null ? 'null' : String(value)))
      .join(', ')}`,
    `  from route_policies where route_direction_id = '${result.routeDirectionId}'`,
    ` order by effective_to desc nulls last limit 1;`,
    `-- ^ carries every other column forward; adjust if your migration adds required columns.`,
    'commit;',
    '',
  ].join('\n');
}
