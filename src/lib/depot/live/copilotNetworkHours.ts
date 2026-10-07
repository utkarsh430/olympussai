import type { FleetSnapshotView, ServiceRepositories } from '../repositories/types';
import { SERVICE_BANDS, bandGapOf, bandHours, type NetworkRouteDay } from '../service/networkHours';
import type {
  CopilotBandSummary,
  CopilotNetworkHours,
  CopilotNetworkProposal,
  NetworkRouteGap,
  ProposalKind,
  ServiceBand,
} from '../service/types';
import type { NetworkDay } from './networkHourlyDay';
import { heldNetworkDay } from './networkHourlyView';

/*
 * The network's day as the copilot reads it: a selection from the same held day the Service
 * page's API answers, so a question and the page never disagree. Per band every short and
 * over-served route, largest first; each route's own proposals once, by modelled passengers;
 * the reallocation's moves summed over the day. No upstream call.
 */

/** The network kinds name a depot or a corridor, not a route; the copilot's answers are about routes. */
const NETWORK_KINDS: ReadonlySet<ProposalKind> = new Set<ProposalKind>([
  'reserve_by_hour',
  'maintenance_window',
  'shift_departures',
  'corridor_over_served',
  'corridor_under_served',
]);

const sumOfGaps = (routes: readonly NetworkRouteGap[]): number =>
  routes.reduce((sum, r) => sum + Math.abs(r.gap), 0);

/**
 * A route's mean gap over the band as whole buses (the copilot never says a fraction of a
 * bus; a mean within half a bus of zero is not short or over), and whether this server
 * observed every hour of it.
 */
function routeGap(route: NetworkRouteDay, band: ServiceBand): NetworkRouteGap {
  const hours = bandHours(route.day, band.key);
  return {
    routeName: route.day.routeName,
    depotId: route.depotId,
    depotName: route.depotName,
    gap: Math.round(bandGapOf(route.day, band.key)) + 0,
    observed: hours.length > 0 && hours.every((h) => h.deployedBasis !== 'modelled'),
  };
}

function bandSummary(day: NetworkDay, band: ServiceBand): CopilotBandSummary {
  const gaps = day.days.map((route) => routeGap(route, band));
  const shortRoutes = gaps.filter((g) => g.gap > 0).sort((a, b) => b.gap - a.gap);
  const overRoutes = gaps.filter((g) => g.gap < 0).sort((a, b) => a.gap - b.gap);
  return {
    key: band.key,
    band: { fromHour: band.fromHour, toHour: band.toHour },
    shortRoutes,
    overRoutes,
    busesShort: sumOfGaps(shortRoutes),
    busesOver: sumOfGaps(overRoutes),
  };
}

const passengersOf = (p: CopilotNetworkProposal): number => p.impact?.passengersPerDay.high ?? 0;

/** Each route's own proposals once (a band's plan repeats one that spans two bands), by modelled passengers. */
function routeProposals(day: NetworkDay): CopilotNetworkProposal[] {
  const byId = new Map<string, CopilotNetworkProposal>();
  for (const plan of day.plans.values()) {
    for (const p of plan.proposals) {
      if (p.routeName === null || NETWORK_KINDS.has(p.kind) || byId.has(p.id)) continue;
      byId.set(p.id, { ...p, routeName: p.routeName });
    }
  }
  return [...byId.values()].sort((a, b) => passengersOf(b) - passengersOf(a));
}

/** The network's day by band for the copilot, from the day held for this snapshot. */
export async function copilotNetworkHours(
  view: FleetSnapshotView,
  services: ServiceRepositories,
): Promise<CopilotNetworkHours> {
  const day = await heldNetworkDay(view, services);
  const plans = [...day.plans.values()];
  return {
    operatingDate: day.operatingDate,
    currentHour: day.currentHour,
    observed: day.observed,
    bands: SERVICE_BANDS.map((band) => bandSummary(day, band)),
    proposals: routeProposals(day),
    moves: {
      withinDepots: plans.reduce((sum, p) => sum + p.reallocation.busesWithin, 0),
      betweenDepots: plans.reduce((sum, p) => sum + p.reallocation.busesBetween, 0),
    },
    decisions: null,
  };
}
