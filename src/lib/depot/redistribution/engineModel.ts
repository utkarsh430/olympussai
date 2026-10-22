import { bandOfSelection, TIME_BANDS, type TimeBandKey } from './bands';
import type { EngineState } from './engineState';
import type { HeatScale } from './heatScale';
import { networkMetrics } from './metrics';
import { buildPlan, projectedAvailability, unresolvedIn } from './plan';
import { routesOf } from './scenario';
import type {
  AvailabilityGrid,
  NetworkMetrics,
  Recommendation,
  RedistributionPlan,
  Scenario,
  ScenarioRoute,
  Selection,
  UnresolvedShortage,
} from './types';
import { hourWindow } from './wording';

/*
 * Everything the page shows, derived once from the scenario and the state: the selection's
 * routes, the figures before, the plan, the figures after the kept transfers, the figures
 * after every transfer (the potential), and the heat map's scale. One derivation, so every
 * section's numbers agree.
 */

export interface EngineModel {
  readonly scenario: Scenario;
  readonly selection: Selection;
  readonly band: TimeBandKey;
  readonly bandLabel: string;
  readonly routes: readonly ScenarioRoute[];
  readonly routeIndex: ReadonlyMap<string, ScenarioRoute>;
  readonly depotNames: ReadonlyMap<string, string>;
  readonly before: NetworkMetrics;
  readonly plan: RedistributionPlan;
  readonly includedIds: ReadonlySet<string>;
  readonly included: readonly Recommendation[];
  readonly projected: AvailabilityGrid;
  readonly after: NetworkMetrics;
  readonly unresolvedAfter: readonly UnresolvedShortage[];
  /** The figures after every feasible transfer, kept or not. */
  readonly potential: NetworkMetrics;
  readonly scale: HeatScale;
}

export function bandLabelOf(selection: Pick<Selection, 'fromHour' | 'toHour'>): string {
  const key = bandOfSelection(selection);
  const band = TIME_BANDS.find((b) => b.key === key);
  return band ? band.label : `Custom ${hourWindow(selection.fromHour, selection.toHour)}`;
}

function scaleOf(routes: readonly ScenarioRoute[]): HeatScale {
  let maxDemand = 0;
  let maxBuses = 0;
  for (const r of routes) {
    for (let h = 0; h < r.demand.length; h += 1) {
      maxDemand = Math.max(maxDemand, r.demand[h] ?? 0);
      maxBuses = Math.max(maxBuses, r.required[h] ?? 0, r.available[h] ?? 0);
    }
  }
  return { maxDemand, maxBuses };
}

export function buildEngineModel(scenario: Scenario, state: EngineState): EngineModel {
  const selection: Selection = { depotId: state.depotId, fromHour: state.fromHour, toHour: state.toHour };
  const routes = routesOf(scenario, state.depotId);
  const plan = buildPlan(scenario, selection);
  const allIds = new Set(plan.recommendations.map((r) => r.id));
  const includedIds = new Set(plan.recommendations.filter((r) => !state.excludedIds.has(r.id)).map((r) => r.id));
  const projected = projectedAvailability(scenario, plan.recommendations, includedIds);
  const full = state.excludedIds.size === 0 ? projected : projectedAvailability(scenario, plan.recommendations, allIds);
  const after = networkMetrics(routes, projected, selection);
  return {
    scenario,
    selection,
    band: bandOfSelection(selection),
    bandLabel: bandLabelOf(selection),
    routes,
    routeIndex: new Map(scenario.routes.map((r) => [r.id, r] as const)),
    depotNames: new Map(scenario.depots.map((d) => [d.id, d.name] as const)),
    before: networkMetrics(routes, null, selection),
    plan,
    includedIds,
    included: plan.recommendations.filter((r) => includedIds.has(r.id)),
    projected,
    after,
    unresolvedAfter: unresolvedIn(scenario, routes, projected, selection),
    potential: state.excludedIds.size === 0 ? after : networkMetrics(routes, full, selection),
    scale: scaleOf(routes),
  };
}
