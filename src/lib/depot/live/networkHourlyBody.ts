import { DEMAND_BASIS } from '../sim/hourlyDemandConfig';
import { nextPeakBand, routeStrip } from '../service/networkHours';
import type {
  BandReallocation,
  ImpactRange,
  NetworkHourlyBody,
  NetworkProposal,
  NetworkRouteStrip,
  ServiceBandKey,
  ServiceBandSummary,
} from '../service/types';
import type { NetworkDay } from './networkHourlyDay';

/*
 * One band (and optionally one depot) of the network's day, as the API answers it: the
 * band tallies, one page of route strips by the band's peak gap, the band's proposals,
 * its reallocation and the totals. A selection from the day; nothing is recomputed.
 */

/** Route strips per page of the heat map. */
export const NETWORK_ROUTES_PAGE_SIZE = 25;

export interface NetworkSelection {
  readonly band: ServiceBandKey;
  readonly depotId: string | null;
  readonly page: number;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Largest band peak first, then the band's mean gap, then the name. */
function compareStrips(a: NetworkRouteStrip, b: NetworkRouteStrip): number {
  return b.peakGap - a.peakGap || b.bandGap - a.bandGap || byText(a.routeName, b.routeName);
}

/** The depot's own tally in place of the network's, when a depot is chosen. */
function bandsFor(bands: readonly ServiceBandSummary[], depotId: string | null): ServiceBandSummary[] {
  if (depotId === null) return [...bands];
  return bands.map((b) => {
    const own = b.byDepot.find((d) => d.depotId === depotId);
    const tally = own ?? { shortRoutes: 0, overRoutes: 0, busesShort: 0, busesOver: 0 };
    return {
      ...b,
      shortRoutes: tally.shortRoutes,
      overRoutes: tally.overRoutes,
      busesShort: tally.busesShort,
      busesOver: tally.busesOver,
      byDepot: own ? [own] : [],
    };
  });
}

function proposalsFor(
  proposals: readonly NetworkProposal[],
  depotId: string | null,
  routesOfDepot: ReadonlySet<string>,
): NetworkProposal[] {
  if (depotId === null) return [...proposals];
  return proposals.filter((p) => p.depotId === depotId || p.routes.some((r) => routesOfDepot.has(r)));
}

function reallocationFor(r: BandReallocation, depotId: string | null): BandReallocation {
  if (depotId === null) return r;
  const moves = r.moves.filter((m) => m.fromDepotId === depotId || m.toDepotId === depotId);
  const sum = (within: boolean): number =>
    moves.filter((m) => m.withinDepot === within).reduce((s, m) => s + m.buses, 0);
  const deadKm = Math.round(moves.reduce((s, m) => s + m.buses * m.deadKmPerBus, 0) * 10) / 10;
  return {
    ...r,
    moves,
    uncovered: r.uncovered.filter((u) => u.depotId === depotId),
    busesWithin: sum(true),
    busesBetween: sum(false),
    deadKm,
  };
}

function summed(proposals: readonly NetworkProposal[], pick: 'passengersPerDay' | 'busKmPerDay'): ImpactRange {
  return proposals.reduce<ImpactRange>(
    (t, p) => (p.impact === null ? t : { low: t.low + p.impact[pick].low, high: t.high + p.impact[pick].high }),
    { low: 0, high: 0 },
  );
}

/** The body for one band, depot and page of the network's day, less the envelope. */
export function networkHourlyBody(day: NetworkDay, selection: NetworkSelection): NetworkHourlyBody {
  const { band, depotId, page } = selection;
  const days = depotId === null ? day.days : day.days.filter((d) => d.depotId === depotId);
  const strips = days.map((d) => routeStrip(d, band)).sort(compareStrips);
  const start = page * NETWORK_ROUTES_PAGE_SIZE;
  const plan = day.plans.get(band);
  const routesOfDepot = new Set(days.map((d) => d.day.routeName));
  const proposals = proposalsFor(plan?.proposals ?? [], depotId, routesOfDepot);
  const reallocation = reallocationFor(
    plan?.reallocation ?? { band, moves: [], uncovered: [], busesWithin: 0, busesBetween: 0, deadKm: 0 },
    depotId,
  );
  const bands = bandsFor(day.bands, depotId);
  const tally = bands.find((b) => b.band === band);
  const changes = proposals.filter((p) => p.group === 'changes');
  return {
    operatingDate: day.operatingDate,
    currentHour: day.currentHour,
    band,
    nextPeak: nextPeakBand(day.currentHour),
    depotId,
    depots: day.depots,
    bands,
    routes: {
      total: strips.length,
      page,
      pageSize: NETWORK_ROUTES_PAGE_SIZE,
      rows: strips.slice(start, start + NETWORK_ROUTES_PAGE_SIZE),
    },
    proposals,
    reallocation,
    totals: {
      busesShort: tally?.busesShort ?? 0,
      busesOver: tally?.busesOver ?? 0,
      movesWithin: reallocation.busesWithin,
      movesBetween: reallocation.busesBetween,
      uncovered: reallocation.uncovered.reduce((s, u) => s + u.buses, 0),
      passengersPerDay: summed(changes, 'passengersPerDay'),
      busKmPerDay: summed(changes, 'busKmPerDay'),
    },
    observed: day.observed,
    routeCoverage: day.routeCoverage,
    demandBasis: DEMAND_BASIS,
  };
}
