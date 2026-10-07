import { DEMAND_BASIS } from '../sim/hourlyDemandConfig';
import { nextPeakBand, routeStrip } from '../service/networkHours';
import { compareProposals } from '../service/proposals';
import type {
  BandReallocation,
  ImpactRange,
  NetworkHourlyBody,
  NetworkProposal,
  NetworkProposalGroup,
  NetworkRouteStrip,
  Proposal,
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

/**
 * The most proposals of one group a body carries: a network day can hold a thousand route
 * proposals in a band, more than a person reads and a body worth sending each minute. The
 * heaviest are kept (the most passengers carried, else the most buses or trips), and the
 * page says how many there were.
 */
export const NETWORK_PROPOSALS_PER_GROUP = 100;

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

const GROUPS: readonly NetworkProposalGroup[] = ['changes', 'findings', 'network'];

/** Heaviest first: a route's own as its day orders them, a network kind by its figure. */
function compareWeight(a: NetworkProposal, b: NetworkProposal): number {
  if (a.count !== null || b.count !== null) return (b.count ?? 0) - (a.count ?? 0) || a.id.localeCompare(b.id);
  return compareProposals(a as Proposal, b as Proposal) || a.id.localeCompare(b.id);
}

function cut(proposals: readonly NetworkProposal[]): {
  readonly kept: NetworkProposal[];
  readonly totals: Record<NetworkProposalGroup, number>;
} {
  const totals = { changes: 0, findings: 0, network: 0 };
  const kept = GROUPS.flatMap((group) => {
    const members = proposals.filter((p) => p.group === group);
    totals[group] = members.length;
    return [...members].sort(compareWeight).slice(0, NETWORK_PROPOSALS_PER_GROUP);
  });
  return { kept, totals };
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
  const all = proposalsFor(plan?.proposals ?? [], depotId, routesOfDepot);
  const { kept: proposals, totals: proposalTotals } = cut(all);
  const reallocation = reallocationFor(
    plan?.reallocation ?? { band, moves: [], uncovered: [], busesWithin: 0, busesBetween: 0, deadKm: 0 },
    depotId,
  );
  const bands = bandsFor(day.bands, depotId);
  const tally = bands.find((b) => b.band === band);
  // The totals sum every change of the band, not only those the cut keeps.
  const changes = all.filter((p) => p.group === 'changes');
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
    proposalTotals,
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
