import type { CrewRepository } from '../crew/types';
import type { IncidentRollupResponse, IncidentRollupRow } from '../incident/api';
import type { FleetSnapshotView, ServiceRepositories } from '../repositories/types';
import { operatingDateOf } from '../sim/seed';
import { compareText } from '../stats/order';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';
import { buildIncidentsResponse } from './incidentView';

/*
 * Headquarters' incidents: every operating depot's suspected breakdowns with
 * their plans, built a batch of depots per request and held per snapshot.
 */

export const INCIDENT_ROLLUP_DEPOTS_PER_REQUEST = 24;
export const INCIDENT_ROLLUP_BUDGET_MS = 1_500;

interface Hold {
  readonly operatingDate: string;
  readonly order: readonly string[];
  readonly rows: Map<string, readonly IncidentRollupRow[]>;
  inFlight: Promise<void> | null;
}

const holds = new WeakMap<SnapshotAnalysis, Hold>();

function holdFor(view: FleetSnapshotView, analysis: SnapshotAnalysis): Hold {
  const held = holds.get(analysis);
  if (held) return held;
  const order = analysis.depots.filter((d) => d.kind === 'depot').sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id)).map((d) => d.id);
  const made: Hold = { operatingDate: operatingDateOf(view.feedNow, view.fetchedAt), order, rows: new Map(), inFlight: null };
  holds.set(analysis, made);
  return made;
}

const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function planBatch(view: FleetSnapshotView, hold: Hold, crew: CrewRepository, services: ServiceRepositories, clock: () => number): Promise<void> {
  const started = clock();
  let planned = 0;
  for (const depotId of hold.order) {
    if (hold.rows.has(depotId)) continue;
    if (planned >= INCIDENT_ROLLUP_DEPOTS_PER_REQUEST || clock() - started > INCIDENT_ROLLUP_BUDGET_MS) break;
    const response = await buildIncidentsResponse(view, depotId, crew, services);
    hold.rows.set(
      depotId,
      (response?.incidents ?? []).map((v) => ({
        depotId,
        depotName: response?.depotName ?? depotId,
        registrationNumber: v.incident.registrationNumber,
        routeName: v.incident.routeName,
        origin: v.incident.origin,
        confidence: v.incident.confidence,
        signals: v.incident.signals,
        passengersAboard: v.plan.passengersAboard.value,
        recommendedKind: v.plan.recommended?.kind ?? null,
        recommendedDepotName: v.plan.recommended?.depotName ?? null,
        arrivalMinutes: v.plan.recommended?.arrivalMinutes ?? v.plan.baseline.arrivalMinutes,
        planState: 'ready',
      })),
    );
    planned += 1;
    await yieldToLoop();
  }
}

export async function buildIncidentRollup(view: FleetSnapshotView, crewRepository: CrewRepository, services: ServiceRepositories, clock: () => number = () => 0): Promise<IncidentRollupResponse> {
  const analysis = analyseSnapshot(view);
  const hold = holdFor(view, analysis);
  if (hold.inFlight === null) {
    const run = planBatch(view, hold, crewRepository, services, clock).finally(() => {
      if (hold.inFlight === run) hold.inFlight = null;
    });
    hold.inFlight = run;
  }
  await hold.inFlight;
  const rows = [...hold.rows.values()].flat();
  const count = (c: IncidentRollupRow['confidence']): number => rows.filter((r) => r.confidence === c).length;
  return {
    ...feedEnvelope(view),
    operatingDate: hold.operatingDate,
    rows,
    totals: { suspected: rows.length, high: count('high'), medium: count('medium'), low: count('low') },
    planned: hold.rows.size,
    pending: Math.max(0, hold.order.length - hold.rows.size),
  };
}
