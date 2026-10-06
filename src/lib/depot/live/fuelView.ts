import type { FleetSnapshotView } from '../repositories/types';
import {
  FUEL_FLAGGED_CAP,
  FUEL_ROUTE_CAP,
  type FuelFlaggedBus,
  type FuelOtherRoutes,
  type FuelResponse,
} from '../fuel/api';
import { compareText } from '../fuel/compare';
import { analyseFuel, mergeTotals } from '../fuel/analysis';
import {
  FUEL_VARIANCE_FLAG_PCT,
  MIN_PEERS,
  type BusFuelFigure,
  type FuelAnalysis,
  type FuelGroupRow,
  type FlaggedBus,
  type FuelRepository,
} from '../fuel/types';
import { operatingDateOf } from '../sim/seed';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';
import { buildDepotDetail } from './depotView';

type FuelBody = Omit<FuelResponse, keyof ReturnType<typeof feedEnvelope>>;

const TENTH = 10;
const toTenth = (value: number): number => Math.round(value * TENTH) / TENTH;

/** The flagged bus with its own figure and the exact median of its peers, both to a tenth. */
function toFlaggedBus(flag: FlaggedBus, figure: BusFuelFigure | undefined): FuelFlaggedBus | null {
  if (!figure || figure.kmPerLitre === null) return null;
  return {
    registrationNumber: flag.registrationNumber,
    routeName: flag.routeName,
    serviceClass: flag.serviceClass,
    kmPerLitre: toTenth(figure.kmPerLitre),
    peerMedianKmPerLitre: toTenth(flag.peerMedianKmPerLitre),
    variancePct: flag.variancePct,
    comparison: flag.comparison,
    statement: flag.statement,
  };
}

/** Dearest route first; equal cost falls back to the name so the order never depends on input. */
function routesByCost(rows: readonly FuelGroupRow[]): readonly FuelGroupRow[] {
  return [...rows].sort(
    (a, b) =>
      b.cost - a.cost ||
      (a.key === b.key ? 0 : a.key === null ? 1 : b.key === null ? -1 : compareText(a.key, b.key)),
  );
}

function otherRoutesOf(rest: readonly FuelGroupRow[]): FuelOtherRoutes | null {
  return rest.length === 0 ? null : { routeCount: rest.length, totals: mergeTotals(rest) };
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
  const byCost = routesByCost(analysis.perRoute);
  return {
    depot,
    provenance: 'modelled',
    operatingDate,
    pricePerLitre: analysis.pricePerLitre,
    priceDefaulted: analysis.priceDefaulted,
    totals: analysis.depot,
    perClass: analysis.perClass,
    perRoute: byCost.slice(0, FUEL_ROUTE_CAP),
    routeTotal: byCost.length,
    otherRoutes: otherRoutesOf(byCost.slice(FUEL_ROUTE_CAP)),
    flagged: flagged.slice(0, FUEL_FLAGGED_CAP),
    flaggedTotal: flagged.length,
    noDistanceCount: analysis.perBus.filter((b) => b.withheldReason === 'no_distance').length,
    noComparisonCount: analysis.perBus.filter((b) => b.withheldReason === 'no_comparison_group')
      .length,
    peersDifferCount: analysis.perBus.filter((b) => b.withheldReason === 'peers_differ').length,
    rule: { thresholdPct: FUEL_VARIANCE_FLAG_PCT, minPeers: MIN_PEERS },
  };
}

async function buildBody(
  view: FleetSnapshotView,
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
 * The body depends on the rows (through the analysis), the depot, the operating
 * date and the fuel source, so it is held under all four, as a promise so
 * concurrent polls share one read. `memoiseBody` is not used: it is synchronous
 * and keyed on the snapshot alone, while this body awaits a repository and
 * varies by depot, date and source. A failed read is dropped so the next
 * request retries; a null body (unknown depot) is not held.
 */
const bodies = new WeakMap<
  SnapshotAnalysis,
  WeakMap<FuelRepository, Map<string, Promise<FuelBody | null>>>
>();

function heldFor(analysis: SnapshotAnalysis, fuel: FuelRepository) {
  const byRepository =
    bodies.get(analysis) ??
    new WeakMap<FuelRepository, Map<string, Promise<FuelBody | null>>>();
  bodies.set(analysis, byRepository);
  const held = byRepository.get(fuel) ?? new Map<string, Promise<FuelBody | null>>();
  byRepository.set(fuel, held);
  return held;
}

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
  const perKey = heldFor(analysis, fuel);
  const key = `${depotId}|${operatingDateOf(view.feedNow, view.fetchedAt)}`;
  const held = perKey.get(key);
  const pending = held ?? buildBody(view, depotId, fuel);
  if (held === undefined) {
    perKey.set(key, pending);
    pending.then(
      (body) => {
        if (body === null) perKey.delete(key);
      },
      () => perKey.delete(key),
    );
  }
  const body = await pending;
  return body === null ? null : { ...feedEnvelope(view), ...body };
}
