import {
  DEFAULT_REBALANCE_PARAMS,
  DEFAULT_SPARE_RATIO,
  MAX_SPARE_RATIO,
  MAX_SURGE_PERCENT,
  MAX_TRANSFER_KM,
  MIN_SPARE_RATIO,
  MIN_SURGE_PERCENT,
  MIN_TRANSFER_KM,
} from './config';
import { planTransfers } from './rebalance';
import type {
  DepotBalance,
  RebalanceParams,
  Scenario,
  ScenarioDelta,
  ScenarioOutcome,
  TransferPlan,
} from './types';

const PERCENT = 100;

/** Clamps a finite value into [min, max]; non-finite input falls back to `fallback`. */
function clamp(
  label: string,
  value: number,
  min: number,
  max: number,
  fallback: number,
  notes: string[],
): number {
  if (!Number.isFinite(value)) {
    notes.push(`${label} ${String(value)} is not a number; using ${fallback}`);
    return fallback;
  }
  const clamped = Math.min(max, Math.max(min, value));
  if (clamped !== value)
    notes.push(`${label} ${value} was outside ${min} to ${max}; using ${clamped}`);
  return clamped;
}

function recompute(b: DepotBalance, available: number, peak: number, ratio: number): DepotBalance {
  const spareTarget = Math.ceil(peak * ratio);
  const required = peak + spareTarget;
  return {
    ...b,
    available,
    peakRequirement: peak,
    spareTarget,
    required,
    balance: available - required,
  };
}

/**
 * Applies a scenario to base balances: fleet adjustments, then demand
 * surges, then the spare ratio, then recomputes required and balance. Only
 * `depot` rows change and only they are planned; other kinds pass through.
 */
export function runScenario(base: readonly DepotBalance[], scenario: Scenario): ScenarioOutcome {
  const notes: string[] = [];
  const ratio =
    scenario.spareRatio === undefined
      ? DEFAULT_SPARE_RATIO
      : clamp(
          'Spare ratio',
          scenario.spareRatio,
          MIN_SPARE_RATIO,
          MAX_SPARE_RATIO,
          DEFAULT_SPARE_RATIO,
          notes,
        );
  const maxTransferKm =
    scenario.maxTransferKm === undefined
      ? DEFAULT_REBALANCE_PARAMS.maxTransferKm
      : clamp(
          'Maximum transfer distance',
          scenario.maxTransferKm,
          MIN_TRANSFER_KM,
          MAX_TRANSFER_KM,
          DEFAULT_REBALANCE_PARAMS.maxTransferKm,
          notes,
        );

  const isDepot = (id: string): boolean => base.some((b) => b.depotId === id && b.kind === 'depot');
  const fleetDelta = new Map<string, number>();
  for (const adj of scenario.fleetAdjustments ?? []) {
    if (!isDepot(adj.depotId)) {
      notes.push(`Fleet adjustment for ${adj.depotId} ignored: not an operating depot`);
      continue;
    }
    fleetDelta.set(
      adj.depotId,
      (fleetDelta.get(adj.depotId) ?? 0) + Math.trunc(adj.deltaBuses || 0),
    );
  }
  const surgeFactor = new Map<string, number>();
  for (const surge of scenario.demandSurges ?? []) {
    if (!isDepot(surge.depotId)) {
      notes.push(`Demand surge for ${surge.depotId} ignored: not an operating depot`);
      continue;
    }
    const percent = clamp(
      `Demand surge for ${surge.depotId}`,
      surge.percent,
      MIN_SURGE_PERCENT,
      MAX_SURGE_PERCENT,
      0,
      notes,
    );
    surgeFactor.set(surge.depotId, (surgeFactor.get(surge.depotId) ?? 1) * (1 + percent / PERCENT));
  }

  const balances = base.map((b): DepotBalance => {
    if (b.kind !== 'depot') return { ...b };
    const requested = fleetDelta.get(b.depotId) ?? 0;
    const delta = Math.max(requested, -b.available);
    if (delta !== requested) {
      notes.push(
        `Fleet adjustment for ${b.depotId} limited to ${delta}: available cannot go below 0`,
      );
    }
    const peak = Math.max(0, Math.round(b.peakRequirement * (surgeFactor.get(b.depotId) ?? 1)));
    return recompute({ ...b, fleet: b.fleet + delta }, b.available + delta, peak, ratio);
  });

  const params: RebalanceParams = {
    ...DEFAULT_REBALANCE_PARAMS,
    maxTransferKm,
    lockedDepotIds: scenario.lockedDepotIds ?? DEFAULT_REBALANCE_PARAMS.lockedDepotIds,
    excludedDepotIds: scenario.excludedDepotIds ?? DEFAULT_REBALANCE_PARAMS.excludedDepotIds,
  };
  const plan = planTransfers(
    balances.filter((b) => b.kind === 'depot'),
    params,
  );
  return { balances, plan, clamped: notes };
}

function busesMoved(plan: TransferPlan): number {
  return plan.transfers.reduce((sum, t) => sum + t.buses, 0);
}

function uncoveredBuses(plan: TransferPlan): number {
  return plan.uncovered.reduce((sum, u) => sum + u.buses, 0);
}

/** Candidate minus baseline for each headline figure. */
export function compareOutcomes(
  baseline: ScenarioOutcome,
  candidate: ScenarioOutcome,
): ScenarioDelta {
  const a = baseline.plan;
  const b = candidate.plan;
  return {
    transfers: b.transfers.length - a.transfers.length,
    busesMoved: busesMoved(b) - busesMoved(a),
    totalBusKm: b.totalBusKm - a.totalBusKm,
    coveredDeficit: b.coveredDeficit - a.coveredDeficit,
    uncoveredDeficit: uncoveredBuses(b) - uncoveredBuses(a),
    depotsInDeficitAfter: b.after.depotsInDeficit - a.after.depotsInDeficit,
  };
}
