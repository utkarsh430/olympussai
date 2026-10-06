import type { FleetSnapshotView } from '../repositories/types';
import { FUEL_FLAGGED_CAP, FUEL_ROUTE_CAP, type FuelFlaggedBus, type FuelResponse } from '../fuel/api';
import { analyseFuel } from '../fuel/analysis';
import {
  FUEL_VARIANCE_FLAG_PCT,
  MIN_PEERS,
  type BusFuelFigure,
  type FuelAnalysis,
  type FlaggedBus,
  type FuelRepository,
} from '../fuel/types';
import { operatingDateOf } from '../sim/seed';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';
import { buildDepotDetail } from './depotView';

type FuelBody = Omit<FuelResponse, keyof ReturnType<typeof feedEnvelope>>;

const TENTH = 10;
const PERCENT = 100;
const toTenth = (value: number): number => Math.round(value * TENTH) / TENTH;

/**
 * The flagged bus with its own figure and its peers' median. The analysis keeps
 * the variance, not the median, so the median is read back from it: median =
 * own figure x (1 + variance), good to the tenth the page shows.
 */
function toFlaggedBus(flag: FlaggedBus, figure: BusFuelFigure | undefined): FuelFlaggedBus | null {
  if (!figure || figure.kmPerLitre === null) return null;
  return {
    registrationNumber: flag.registrationNumber,
    routeName: flag.routeName,
    serviceClass: flag.serviceClass,
    kmPerLitre: toTenth(figure.kmPerLitre),
    peerMedianKmPerLitre: toTenth(figure.kmPerLitre * (1 + flag.variancePct / PERCENT)),
    variancePct: flag.variancePct,
    comparison: flag.comparison,
    statement: flag.statement,
  };
}

function shape(
  analysis: FuelAnalysis,
  depot: FuelBody['depot'],
  operatingDate: string,
): FuelBody {
  const byRegistration = new Map(analysis.perBus.map((bus) => [bus.registrationNumber, bus]));
  const flagged = analysis.flagged
    .map((flag) => toFlaggedBus(flag, byRegistration.get(flag.registrationNumber)))
    .filter((bus): bus is FuelFlaggedBus => bus !== null);
  return {
    depot,
    provenance: 'modelled',
    operatingDate,
    pricePerLitre: analysis.pricePerLitre,
    priceDefaulted: analysis.priceDefaulted,
    totals: analysis.depot,
    perClass: analysis.perClass,
    perRoute: analysis.perRoute.slice(0, FUEL_ROUTE_CAP),
    routeTotal: analysis.perRoute.length,
    flagged: flagged.slice(0, FUEL_FLAGGED_CAP),
    flaggedTotal: flagged.length,
    noDistanceCount: analysis.perBus.filter((b) => b.withheldReason === 'no_distance').length,
    noComparisonCount: analysis.perBus.filter((b) => b.withheldReason === 'no_comparison_group')
      .length,
    rule: { thresholdPct: FUEL_VARIANCE_FLAG_PCT, minPeers: MIN_PEERS },
  };
}

async function buildBody(
  view: FleetSnapshotView,
  analysis: SnapshotAnalysis,
  depotId: string,
  fuel: FuelRepository,
): Promise<FuelBody | null> {
  const detail = buildDepotDetail(view, depotId);
  if (!detail) return null;
  const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
  const days = await fuel.fuelDay(detail.buses, operatingDate);
  return shape(analyseFuel(days), { id: detail.depot.id, name: detail.depot.name }, operatingDate);
}

/*
 * The body depends only on the rows and the depot, so it is held per analysis
 * and depot, as a promise so concurrent polls share one read. A failed read is
 * dropped so the next request retries; a null body (unknown depot) is not held.
 */
const bodies = new WeakMap<SnapshotAnalysis, Map<string, Promise<FuelBody | null>>>();

/**
 * One depot's fuel page payload, or null when the snapshot has no such depot.
 * The envelope is built from this request's view on every call, never held with
 * the body: the same rows can be fresh now and stale last-good next.
 */
export async function buildFuelResponse(
  view: FleetSnapshotView,
  depotId: string,
  fuel: FuelRepository,
): Promise<FuelResponse | null> {
  const analysis = analyseSnapshot(view);
  const perDepot = bodies.get(analysis) ?? new Map<string, Promise<FuelBody | null>>();
  bodies.set(analysis, perDepot);
  const held = perDepot.get(depotId);
  const pending = held ?? buildBody(view, analysis, depotId, fuel);
  if (held === undefined) {
    perDepot.set(depotId, pending);
    pending.then(
      (body) => {
        if (body === null) perDepot.delete(depotId);
      },
      () => perDepot.delete(depotId),
    );
  }
  const body = await pending;
  return body === null ? null : { ...feedEnvelope(view), ...body };
}
