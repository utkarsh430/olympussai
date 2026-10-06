import {
  DEFAULT_REBALANCE_PARAMS,
  DEFAULT_SPARE_RATIO,
  MAX_FLEET_ADJUSTMENT,
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

/** Ratios are held in basis points and surges in hundredths of a percent, so all maths is integer. */
const BASIS_POINTS = 10_000;
const HUNDREDTHS_OF_PERCENT = 100;
const FULL_SCALE = 10_000;

/**
 * Spare buses for a peak: the exact ceiling of peak * ratio. The ratio is
 * rounded to whole basis points first, so float noise such as
 * 100 * 0.07 = 7.000000000000001 cannot add a bus.
 */
function spareFor(peak: number, ratio: number): number {
  const numerator = peak * Math.round(ratio * BASIS_POINTS);
  return Math.floor((numerator + BASIS_POINTS - 1) / BASIS_POINTS);
}

/**
 * Peak after a surge given in hundredths of a percent, rounded to a whole bus
 * with an exact half rounding up. Integer arithmetic keeps true halves exact.
 */
function surgedPeak(peak: number, surgeHundredths: number): number {
  const scaled = peak * (FULL_SCALE + surgeHundredths);
  return Math.max(0, Math.floor((2 * scaled + FULL_SCALE) / (2 * FULL_SCALE)));
}

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

/** A user-entered fleet delta as a whole number within the allowed magnitude; never throws. */
function cleanFleetDelta(depotId: string, raw: number, notes: string[]): number {
  const label = `Fleet adjustment for ${depotId}`;
  if (!Number.isFinite(raw)) {
    notes.push(`${label} ${String(raw)} is not a number; using 0`);
    return 0;
  }
  const whole = Math.trunc(raw) || 0;
  if (whole !== raw) notes.push(`${label} ${raw} is not a whole number; using ${whole}`);
  return clamp(label, whole, -MAX_FLEET_ADJUSTMENT, MAX_FLEET_ADJUSTMENT, 0, notes);
}

/** Largest single surge term kept before summing, so sums of hostile values stay finite. */
const SURGE_TERM_LIMIT_PERCENT = 1_000_000;

/** One surge in whole hundredths of a percent; non-finite counts as 0 with a note. */
function cleanSurgeTerm(depotId: string, raw: number, notes: string[]): number {
  if (!Number.isFinite(raw)) {
    notes.push(`Demand surge for ${depotId} ${String(raw)} is not a number; using 0`);
    return 0;
  }
  const bounded = Math.min(SURGE_TERM_LIMIT_PERCENT, Math.max(-SURGE_TERM_LIMIT_PERCENT, raw));
  return Math.round(bounded * HUNDREDTHS_OF_PERCENT);
}

function recompute(b: DepotBalance, available: number, peak: number, ratio: number): DepotBalance {
  const spareTarget = spareFor(peak, ratio);
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

  const depotIds = new Set(base.filter((b) => b.kind === 'depot').map((b) => b.depotId));

  // Several adjustments on one depot are summed; the availability floor applies to the sum.
  const fleetDelta = new Map<string, number>();
  for (const adj of scenario.fleetAdjustments ?? []) {
    if (!depotIds.has(adj.depotId)) {
      notes.push(`Fleet adjustment for ${adj.depotId} ignored: not an operating depot`);
      continue;
    }
    fleetDelta.set(
      adj.depotId,
      (fleetDelta.get(adj.depotId) ?? 0) + cleanFleetDelta(adj.depotId, adj.deltaBuses, notes),
    );
  }

  // Several surges on one depot are summed in hundredths of a percent, then the sum is clamped.
  const surgeHundredths = new Map<string, number>();
  for (const surge of scenario.demandSurges ?? []) {
    if (!depotIds.has(surge.depotId)) {
      notes.push(`Demand surge for ${surge.depotId} ignored: not an operating depot`);
      continue;
    }
    surgeHundredths.set(
      surge.depotId,
      (surgeHundredths.get(surge.depotId) ?? 0) +
        cleanSurgeTerm(surge.depotId, surge.percent, notes),
    );
  }
  for (const [depotId, total] of [...surgeHundredths]) {
    const min = MIN_SURGE_PERCENT * HUNDREDTHS_OF_PERCENT;
    const max = MAX_SURGE_PERCENT * HUNDREDTHS_OF_PERCENT;
    const bounded = Math.min(max, Math.max(min, total));
    if (bounded !== total) {
      notes.push(
        `Demand surge for ${depotId} totals ${total / HUNDREDTHS_OF_PERCENT}%, outside ` +
          `${MIN_SURGE_PERCENT} to ${MAX_SURGE_PERCENT}; using ${bounded / HUNDREDTHS_OF_PERCENT}`,
      );
      surgeHundredths.set(depotId, bounded);
    }
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
    const peak = surgedPeak(b.peakRequirement, surgeHundredths.get(b.depotId) ?? 0);
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
