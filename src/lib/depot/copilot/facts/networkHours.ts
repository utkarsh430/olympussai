import { cleanName, makeFact, nameFact } from '@/lib/depot/copilot/facts/format';
import {
  busesText,
  countText,
  observedSinceText,
  passengersText,
  proposalLine,
  proposalProvenance,
} from '@/lib/depot/copilot/facts/serviceText';
import type { CopilotFact } from '@/lib/depot/copilot/types';
import { formatPlainDate } from '@/lib/depot/format';
import { bandLabel, inBand } from '@/lib/depot/service/bands';
import type {
  HourBand,
  NetworkBandSummary,
  NetworkHourlyBody,
  NetworkProposal,
  NetworkRouteGap,
  ServiceBandKey,
} from '@/lib/depot/service/types';

/*
 * Facts of the network's day by band, from the network hourly body. Gaps rest on MODELLED
 * demand; the bands themselves are REFERENCE constants; the moves are the MODELLED
 * reallocation; decision counts are what was recorded (DERIVED).
 */

/** Routes and proposals named in one answer; the table carries the same rows. */
export const MAX_BAND_ROUTES = 3;
export const MAX_BAND_PROPOSALS = 3;

const BAND_NAME: Readonly<Record<ServiceBandKey, string>> = {
  early: 'early',
  morning_peak: 'morning peak',
  midday: 'midday',
  evening_peak: 'evening peak',
  late: 'late',
};

/** The band that holds the hour; none for the hours before the early band. */
export const bandAt = (body: NetworkHourlyBody, hour: number): NetworkBandSummary | undefined =>
  body.bands.find((b) => inBand(b.band, hour));

const overlaps = (a: HourBand, b: HourBand): boolean =>
  a.fromHour <= b.toHour && a.toHour >= b.fromHour;

const ofDepot = (depotId: string | undefined) => (r: { readonly depotId: string | null }): boolean =>
  depotId === undefined || r.depotId === depotId;

const sumOf = (routes: readonly NetworkRouteGap[]): number =>
  routes.reduce((sum, r) => sum + Math.abs(r.gap), 0);

/** The band's routes, optionally one depot's, with the bus totals recomputed for that subset. */
export function bandSubset(band: NetworkBandSummary, depotId?: string): NetworkBandSummary {
  if (depotId === undefined) return band;
  const shortRoutes = band.shortRoutes.filter(ofDepot(depotId));
  const overRoutes = band.overRoutes.filter(ofDepot(depotId));
  return { ...band, shortRoutes, overRoutes, busesShort: sumOf(shortRoutes), busesOver: sumOf(overRoutes) };
}

function routeFacts(prefix: 'short' | 'over', routes: readonly NetworkRouteGap[]): CopilotFact[] {
  return routes.slice(0, MAX_BAND_ROUTES).flatMap((r, i) => [
    nameFact(`${prefix}.${i + 1}.name`, `Route ${i + 1}`, cleanName(r.routeName), 'live'),
    makeFact(`${prefix}.${i + 1}.gap`, `Gap ${i + 1}`, busesText(r.gap), 'modelled'),
  ]);
}

/** The band's name and span, its route counts and bus totals, and its leading routes. */
export function bandFacts(band: NetworkBandSummary): CopilotFact[] {
  return [
    makeFact('band.label', 'Band', `${BAND_NAME[band.key]}, ${bandLabel(band.band)}`, 'reference'),
    makeFact('band.short_routes', 'Routes short', countText(band.shortRoutes.length, 'route', 'routes'), 'modelled'),
    makeFact('band.buses_short', 'Buses short', busesText(band.busesShort), 'modelled'),
    makeFact('band.over_routes', 'Routes in surplus', countText(band.overRoutes.length, 'route', 'routes'), 'modelled'),
    makeFact('band.buses_over', 'Buses in surplus', busesText(band.busesOver), 'modelled'),
    ...routeFacts('short', band.shortRoutes),
    ...routeFacts('over', band.overRoutes),
  ];
}

/** The proposals whose band overlaps this band, optionally one depot's, in the body's order. */
export function bandProposals(
  body: NetworkHourlyBody,
  band: NetworkBandSummary,
  depotId?: string,
): NetworkProposal[] {
  return body.proposals.filter((p) => overlaps(p.band, band.band) && ofDepot(depotId)(p));
}

/** `band.p.<n>`: the route, its band and its change, provenance by what it rests on. */
export function bandProposalFacts(proposals: readonly NetworkProposal[]): CopilotFact[] {
  return proposals.slice(0, MAX_BAND_PROPOSALS).map((p, i) =>
    makeFact(`band.p.${i + 1}`, `Proposal ${i + 1}`, proposalLine(p, true), proposalProvenance(p.tier)),
  );
}

/** `brief.p.<n>`: the leading proposals by modelled passengers, each with its range. */
export function briefProposalFacts(body: NetworkHourlyBody): CopilotFact[] {
  return body.proposals.slice(0, MAX_BAND_PROPOSALS).map((p, i) => {
    const passengers = passengersText(p);
    const text = passengers === null ? proposalLine(p, true) : `${proposalLine(p, true)}, ${passengers}`;
    return makeFact(`brief.p.${i + 1}`, `Proposal ${i + 1}`, text, 'modelled');
  });
}

/** The day's moves and, when a trail exists, the decisions recorded. */
export function briefDayFacts(body: NetworkHourlyBody): CopilotFact[] {
  const facts = [
    makeFact('brief.date', 'Operating date', formatPlainDate(body.operatingDate), 'derived'),
    makeFact('brief.moves_within', 'Moves within depots', busesText(body.moves.withinDepots), 'modelled'),
    makeFact('brief.moves_between', 'Moves between depots', busesText(body.moves.betweenDepots), 'modelled'),
  ];
  if (body.observed !== null) {
    facts.push(
      makeFact('brief.observed_since', 'Observed since', observedSinceText(body.observed), 'derived'),
    );
  }
  if (body.decisions !== null) {
    const { accepted, declined, open } = body.decisions;
    facts.push(
      makeFact('brief.accepted', 'Accepted', countText(accepted, 'proposal', 'proposals'), 'derived'),
      makeFact('brief.declined', 'Declined', countText(declined, 'proposal', 'proposals'), 'derived'),
      makeFact('brief.open', 'Open', countText(open, 'proposal', 'proposals'), 'derived'),
    );
  }
  return facts;
}
