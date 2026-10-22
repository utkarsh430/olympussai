import { DEFAULT_PRICE_PER_LITRE } from '../../fuel/types';
import { formatCount } from '../../format';
import { DEFAULT_REBALANCE_PARAMS, DEFAULT_SPARE_RATIO } from '../../optimise/config';
import { runScenario } from '../../optimise/scenario';
import type { DepotBalance, Scenario, ScenarioOutcome } from '../../optimise/types';

/**
 * The Scenario Studio's levers and what they change. Every outcome is the fleet
 * distribution optimiser re-run on the same depot balances the Between Depots page uses:
 * levers become fleet adjustments, demand surges, a spare ratio and a transfer limit, so
 * a scenario obeys the optimiser's constraints (donors keep their spare target, no move
 * beyond the limit). Cost figures use the planning diesel price and economy.
 */

export interface Levers {
  /** Change in passenger demand, percent, applied to the peak requirement. */
  readonly demandPct: number;
  /** Buses taken out of service (breakdowns, accidents). */
  readonly unavailable: number;
  /** Extra buses added to the fleet (hired or new). */
  readonly addedBuses: number;
  /** Drivers short, percent: a bus without a driver cannot run. */
  readonly driverShortagePct: number;
  /** More of the fleet held in the workshop, percent of fleet. */
  readonly maintenanceBacklogPct: number;
  /** Diesel price, rupees per litre. */
  readonly dieselPrice: number;
  readonly transfers: boolean;
  readonly maxTransferKm: number;
  readonly spareRatio: number;
  /** One depot the fleet levers apply to, or null for the whole network by fleet share. */
  readonly depotId: string | null;
}

export const BASE_LEVERS: Levers = {
  demandPct: 0,
  unavailable: 0,
  addedBuses: 0,
  driverShortagePct: 0,
  maintenanceBacklogPct: 0,
  dieselPrice: DEFAULT_PRICE_PER_LITRE,
  transfers: true,
  maxTransferKm: DEFAULT_REBALANCE_PARAMS.maxTransferKm,
  spareRatio: DEFAULT_SPARE_RATIO,
  depotId: null,
};

/** Planning economy for repositioning runs, km per litre. */
const REPOSITION_KM_PER_LITRE = 4.6;
/** Hours of the morning peak a short bus leaves uncovered. */
export const PEAK_HOURS = 4;

export interface StudioMetrics {
  readonly available: number;
  readonly required: number;
  readonly depotsShort: number;
  /** Shortage before any transfer. */
  readonly shortageBefore: number;
  /** Shortage left after the transfers (or the same, when transfers are off). */
  readonly shortage: number;
  readonly coverage: number;
  readonly uncoveredBusHours: number;
  readonly transfers: number;
  readonly busesMoved: number;
  readonly emptyBusKm: number;
  readonly repositioningCost: number;
  readonly dailyFuelCost: number | null;
  readonly utilisation: number;
}

export interface StudioResult {
  readonly baseline: StudioMetrics;
  readonly scenario: StudioMetrics;
  readonly outcome: ScenarioOutcome;
  readonly baseOutcome: ScenarioOutcome;
  readonly constraints: readonly string[];
  readonly summary: readonly string[];
  readonly actions: readonly string[];
}

/** Spreads `n` buses over depots by fleet share, largest remainders first, so they sum to `n`. */
export function spreadByFleet(balances: readonly DepotBalance[], n: number): Map<string, number> {
  const ops = balances.filter((b) => b.kind === 'depot' && b.fleet > 0);
  const total = ops.reduce((s, b) => s + b.fleet, 0);
  const out = new Map<string, number>();
  if (total === 0 || n === 0) return out;
  const raw = ops.map((b) => ({ id: b.depotId, exact: (Math.abs(n) * b.fleet) / total }));
  const whole = raw.map((r) => ({ ...r, w: Math.floor(r.exact) }));
  let left = Math.abs(n) - whole.reduce((s, r) => s + r.w, 0);
  for (const r of [...whole].sort((a, b) => b.exact - b.w - (a.exact - a.w) || a.id.localeCompare(b.id))) {
    if (left <= 0) break;
    r.w += 1;
    left -= 1;
  }
  for (const r of whole) if (r.w > 0) out.set(r.id, Math.sign(n) * r.w);
  return out;
}

function scenarioOf(base: readonly DepotBalance[], levers: Levers): Scenario {
  const operating = base.filter((b) => b.kind === 'depot');
  const totalFleet = operating.reduce((s, b) => s + b.fleet, 0);
  const target = levers.depotId ? operating.filter((b) => b.depotId === levers.depotId) : operating;
  const targetFleet = target.reduce((s, b) => s + b.fleet, 0);
  const lost =
    levers.unavailable +
    Math.round(((levers.driverShortagePct + levers.maintenanceBacklogPct) / 100) * (levers.depotId ? targetFleet : totalFleet));
  const net = levers.addedBuses - lost;
  const adjustments = new Map<string, number>();
  if (levers.depotId) {
    if (net !== 0) adjustments.set(levers.depotId, net);
  } else {
    for (const [id, n] of spreadByFleet(base, net)) adjustments.set(id, n);
  }
  return {
    spareRatio: levers.spareRatio,
    maxTransferKm: levers.maxTransferKm,
    fleetAdjustments: [...adjustments.entries()].map(([depotId, deltaBuses]) => ({ depotId, deltaBuses })),
    demandSurges:
      levers.demandPct === 0
        ? []
        : target.map((b) => ({ depotId: b.depotId, percent: levers.demandPct })),
  };
}

function metricsOf(outcome: ScenarioOutcome, levers: Levers, dailyLitres: number | null): StudioMetrics {
  const ops = outcome.balances.filter((b) => b.kind === 'depot');
  const available = ops.reduce((s, b) => s + b.available, 0);
  const required = ops.reduce((s, b) => s + b.required, 0);
  const before = outcome.plan.before.totalDeficit;
  const after = levers.transfers ? outcome.plan.after.totalDeficit : before;
  const moved = levers.transfers ? outcome.plan.transfers.reduce((s, t) => s + t.buses, 0) : 0;
  const busKm = levers.transfers ? outcome.plan.totalBusKm : 0;
  const peakNeed = ops.reduce((s, b) => s + b.peakRequirement, 0);
  return {
    available,
    required,
    depotsShort: levers.transfers ? outcome.plan.after.depotsInDeficit : outcome.plan.before.depotsInDeficit,
    shortageBefore: before,
    shortage: after,
    coverage: peakNeed > 0 ? Math.max(0, 1 - after / peakNeed) : 1,
    uncoveredBusHours: after * PEAK_HOURS,
    transfers: levers.transfers ? outcome.plan.transfers.length : 0,
    busesMoved: moved,
    emptyBusKm: Math.round(busKm),
    repositioningCost: Math.round((busKm / REPOSITION_KM_PER_LITRE) * levers.dieselPrice),
    dailyFuelCost: dailyLitres === null ? null : Math.round(dailyLitres * levers.dieselPrice),
    utilisation: available > 0 ? Math.min(1.5, peakNeed / available) : 0,
  };
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const signed = (n: number): string => `${n > 0 ? '+' : ''}${formatCount(n)}`;

/**
 * Baseline and scenario on the same balances. `dailyLitres` is the fleet's average daily
 * fuel from the fuel audit (null while it runs); it scales with demand for the scenario.
 */
export function runStudio(base: readonly DepotBalance[], levers: Levers, dailyLitres: number | null): StudioResult {
  const baseOutcome = runScenario(base, { spareRatio: BASE_LEVERS.spareRatio, maxTransferKm: BASE_LEVERS.maxTransferKm });
  const outcome = runScenario(base, scenarioOf(base, levers));
  const baseline = metricsOf(baseOutcome, BASE_LEVERS, dailyLitres);
  const litres = dailyLitres === null ? null : dailyLitres * (1 + levers.demandPct / 100);
  const scenario = metricsOf(outcome, levers, litres);

  const constraints = [
    ...outcome.clamped,
    ...(levers.transfers
      ? outcome.plan.uncovered.slice(0, 4).map((u) => {
          const name = outcome.balances.find((b) => b.depotId === u.depotId)?.depotName ?? u.depotId;
          const why = { no_surplus_in_range: 'no surplus within the transfer limit', insufficient_surplus: 'not enough surplus in range', no_position: 'no known position', excluded: 'excluded' }[u.reason];
          return `${name}: ${formatCount(u.buses)} short with ${why}`;
        })
      : ['Inter-depot transfers are off: every deficit stays where it is.']),
  ];

  const dShort = scenario.shortage - baseline.shortage;
  const summary = [
    `Peak shortage after redistribution moves from ${formatCount(baseline.shortage)} to ${formatCount(scenario.shortage)} buses (${signed(dShort)}); ${formatCount(scenario.depotsShort)} depots stay short against ${formatCount(baseline.depotsShort)}.`,
    `Peak demand coverage ${pct(baseline.coverage)} → ${pct(scenario.coverage)}; uncovered peak bus-hours ${formatCount(baseline.uncoveredBusHours)} → ${formatCount(scenario.uncoveredBusHours)}.`,
    levers.transfers
      ? `${formatCount(scenario.transfers)} transfers move ${formatCount(scenario.busesMoved)} buses with ${formatCount(scenario.emptyBusKm)} empty bus-km (₹${formatCount(scenario.repositioningCost)} of diesel).`
      : 'No buses are repositioned.',
  ];
  if (scenario.dailyFuelCost !== null && baseline.dailyFuelCost !== null && scenario.dailyFuelCost !== baseline.dailyFuelCost) {
    summary.push(`Daily fleet diesel ₹${formatCount(baseline.dailyFuelCost)} → ₹${formatCount(scenario.dailyFuelCost)} (${signed(scenario.dailyFuelCost - baseline.dailyFuelCost)}).`);
  }

  const actions: string[] = [];
  if (dShort > 0 && levers.transfers) actions.push(`Approve the ${formatCount(scenario.transfers)} transfers the evening before; they cover ${formatCount(scenario.shortageBefore - scenario.shortage)} of ${formatCount(scenario.shortageBefore)} buses.`);
  if (scenario.shortage > 0) actions.push(`For the ${formatCount(scenario.shortage)} buses still short, thin the lowest-demand peak trips (see Hourly Demand) or hire for the peak.`);
  if (levers.maxTransferKm < BASE_LEVERS.maxTransferKm && outcome.plan.uncovered.some((u) => u.reason === 'no_surplus_in_range')) {
    actions.push('Raising the transfer limit would reach more surplus.');
  }
  if (levers.maintenanceBacklogPct > 0) actions.push('Add a night shift in the workshop to bring backlog buses back before the peak.');
  if (levers.driverShortagePct > 0) actions.push('Call reserve driver slots and defer leave for the peak.');
  if (actions.length === 0) actions.push('The network absorbs this scenario with the current plan.');

  return { baseline, scenario, outcome, baseOutcome, constraints, summary, actions };
}
