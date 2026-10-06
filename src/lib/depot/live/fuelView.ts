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
import { summariseDay } from '../sim/operatingDay';
import type { OperatingDay } from '../sim/operatingDayTypes';
import { analyseSnapshot, feedEnvelope } from './analysis';
import { operatingDayFor } from './operatingDayView';
import { holdPerSnapshot } from './revenueView';

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
  day: OperatingDay,
): FuelBody {
  const { operatingDate } = day;
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
    day: summariseDay(day),
    notRunCount: day.notRun.length,
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

/*
 * The body depends on the rows (through the analysis), the depot, the operating
 * date, the route-catalogue revision (a newly cached profile changes a route's
 * length, so the day's distances) and the fuel source. `holdPerSnapshot` holds
 * it under all five in one slot per analysis that a new date or revision
 * resets, as a promise so concurrent polls share one read; a failed read is
 * dropped so the next request retries.
 */
const heldBody = holdPerSnapshot<FuelBody, FuelRepository>(
  async (view, analysis, _operatingDate, depotId, fuel): Promise<FuelBody> => {
    // The caller has already confirmed the depot exists. The day is the shared one.
    const day = operatingDayFor(view, depotId);
    if (!day) throw new Error(`No depot ${depotId} in the snapshot`);
    const days = await fuel.fuelDay(day);
    const name = analysis.depotsById.get(depotId)?.name ?? depotId;
    return shape(analyseFuel(days), { id: depotId, name }, day);
  },
);

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
  if (!analyseSnapshot(view).depotsById.has(depotId)) return null;
  const body = await heldBody(view, depotId, fuel);
  return { ...feedEnvelope(view), ...body };
}
