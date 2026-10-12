import type { CrewRepository } from '../crew/types';
import type { FleetSnapshotView, ServiceRepositories } from '../repositories/types';
import type { ScheduleSummary, SchedulerRollupResponse } from '../schedule/api';
import { operatingDateOf } from '../sim/seed';
import { compareText } from '../stats/order';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';
import { operatedBy, routeTableOf } from './routeInputs';
import { scheduleSummaryFor } from './scheduleView';

/*
 * The Headquarters roll-up, built a few depots at a time: every operating
 * depot with a route is planned in name order, at most a batch per request
 * and within a time budget, and the rows built so far are answered with how
 * many are still to come. One build runs at a time per snapshot.
 */

/** Depots planned in one request, and the time one request may spend planning. */
export const ROLLUP_DEPOTS_PER_REQUEST = 24;
export const ROLLUP_BUDGET_MS = 1_500;

interface RollupHold {
  readonly operatingDate: string;
  readonly order: readonly string[];
  readonly rows: Map<string, ScheduleSummary>;
  inFlight: Promise<void> | null;
}

const holds = new WeakMap<SnapshotAnalysis, RollupHold>();

function holdFor(view: FleetSnapshotView, analysis: SnapshotAnalysis): RollupHold {
  const held = holds.get(analysis);
  if (held) return held;
  const table = routeTableOf(view);
  const order = analysis.depots
    .filter((d) => d.kind === 'depot' && table.some((row) => operatedBy(row, d.id)))
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id))
    .map((d) => d.id);
  const made: RollupHold = { operatingDate: operatingDateOf(view.feedNow, view.fetchedAt), order, rows: new Map(), inFlight: null };
  holds.set(analysis, made);
  return made;
}

const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function planBatch(view: FleetSnapshotView, hold: RollupHold, crewRepository: CrewRepository, services: ServiceRepositories, clock: () => number): Promise<void> {
  const started = clock();
  let planned = 0;
  for (const depotId of hold.order) {
    if (hold.rows.has(depotId)) continue;
    if (planned >= ROLLUP_DEPOTS_PER_REQUEST || clock() - started > ROLLUP_BUDGET_MS) break;
    const summary = await scheduleSummaryFor(view, depotId, crewRepository, services);
    if (summary !== null) hold.rows.set(depotId, summary);
    planned += 1;
    await yieldToLoop();
  }
}

/** The roll-up as far as it is built, planning one more batch first. `clock` is monotonic milliseconds. */
export async function buildSchedulerRollup(
  view: FleetSnapshotView,
  crewRepository: CrewRepository,
  services: ServiceRepositories,
  clock: () => number = () => 0,
): Promise<SchedulerRollupResponse> {
  const analysis = analyseSnapshot(view);
  const hold = holdFor(view, analysis);
  if (hold.inFlight === null) {
    const run = planBatch(view, hold, crewRepository, services, clock).finally(() => {
      if (hold.inFlight === run) hold.inFlight = null;
    });
    hold.inFlight = run;
  }
  await hold.inFlight;
  const depots = [...hold.rows.values()].sort((a, b) => compareText(a.depotName, b.depotName) || compareText(a.depotId, b.depotId));
  return {
    ...feedEnvelope(view),
    operatingDate: hold.operatingDate,
    depots,
    planned: depots.length,
    pending: Math.max(0, hold.order.length - depots.length),
    total: hold.order.length,
    summary: {
      busesFreed: depots.reduce((sum, d) => sum + d.busesFreed, 0),
      crewSlotsFreed: depots.reduce((sum, d) => sum + (d.crewSlotsToday.driver - d.crewSlotsUsed.driver) + (d.crewSlotsToday.conductor - d.crewSlotsUsed.conductor), 0),
      uncoveredBusHours: depots.reduce((sum, d) => sum + d.uncoveredBusHours, 0),
      depotsWithUncovered: depots.filter((d) => d.uncoveredBusHours > 0).length,
    },
  };
}
