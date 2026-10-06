import type { DepotBusRow } from '@/models/depotLive';
import type { DepotBusView } from '../api';
import type { FleetSnapshotView } from '../repositories/types';
import { compareText } from '../exceptions/depotExceptions';
import { DUE_SOON_WITHIN_KM } from '../maintenance/config';
import type { MaintenanceResponse, OffRoadBus } from '../maintenance/api';
import { countByGroup, modelService, sortByUrgency } from '../maintenance/serviceModel';
import { workshopLoad } from '../maintenance/workshop';
import { deviceFlags } from '../roster/rosterModel';
import { modelBus } from '../sim/fleetMaster';
import { modelDepotMaster } from '../sim/depotMaster';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';
import { buildDepotDetail } from './depotView';

type MaintenanceBody = Omit<MaintenanceResponse, keyof ReturnType<typeof feedEnvelope>>;

function toOffRoadBus(bus: DepotBusView): OffRoadBus {
  return {
    registrationNumber: bus.registrationNumber,
    vehicleStatus: bus.vehicleStatus,
    tripStatus: bus.tripStatus,
    gpsAgeMin: bus.gpsAgeMin,
    flags: deviceFlags(bus),
  };
}

/** Longest silent first; a bus with no known age goes last. */
function bySilence(a: OffRoadBus, b: OffRoadBus): number {
  const ageA = a.gpsAgeMin ?? -1;
  const ageB = b.gpsAgeMin ?? -1;
  return ageB - ageA || compareText(a.registrationNumber, b.registrationNumber);
}

function buildBody(
  view: FleetSnapshotView,
  analysis: SnapshotAnalysis,
  depotId: string,
): MaintenanceBody | null {
  const detail = buildDepotDetail(view, depotId);
  if (!detail) return null;
  const rows: readonly DepotBusRow[] = analysis.rowsByDepot.get(depotId) ?? [];
  const offRoad = detail.buses
    .filter((bus) => bus.state === 'off_road')
    .map(toOffRoadBus)
    .sort(bySilence);
  const services = sortByUrgency(
    rows.map((row) => modelService(modelBus(row.registrationNumber, row.routeName))),
  );
  return {
    depot: { id: detail.depot.id, name: detail.depot.name },
    offRoad: { provenance: 'live', buses: offRoad },
    distanceCoverage: {
      provenance: 'live',
      coverage: { n: rows.filter((row) => row.odometerRaw !== null).length, of: rows.length },
    },
    preventive: {
      provenance: 'modelled',
      dueSoonWithinKm: DUE_SOON_WITHIN_KM,
      counts: countByGroup(services),
      buses: services,
    },
    workshop: {
      provenance: 'modelled',
      offRoadProvenance: 'live',
      load: workshopLoad(offRoad.length, modelDepotMaster(detail.depot).workshopBays),
    },
  };
}

/*
 * The body depends only on the rows (through the analysis) and the depot, so it
 * is held per analysis and depot. A null body (unknown depot) is not held: the
 * lookup is cheap and an unknown id must not grow the map.
 */
const bodies = new WeakMap<SnapshotAnalysis, Map<string, MaintenanceBody>>();

/**
 * One depot's maintenance page payload, or null when the snapshot has no such
 * depot. The envelope is built from this request's view on every call, never
 * held with the body: the same rows can be fresh now and stale last-good next.
 */
export function buildMaintenanceResponse(
  view: FleetSnapshotView,
  depotId: string,
): MaintenanceResponse | null {
  const analysis = analyseSnapshot(view);
  const held = bodies.get(analysis)?.get(depotId);
  const body = held ?? buildBody(view, analysis, depotId);
  if (body === null) return null;
  if (held === undefined) {
    const perDepot = bodies.get(analysis) ?? new Map<string, MaintenanceBody>();
    bodies.set(analysis, new Map([...perDepot, [depotId, body]]));
  }
  return { ...feedEnvelope(view), ...body };
}
