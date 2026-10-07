import { cleanName, makeFact, nameFact } from '@/lib/depot/copilot/facts/format';
import {
  DEPLOYED_PROVENANCE,
  busesText,
  countText,
  observedSinceText,
  hourSpanText,
  proposalLine,
  proposalProvenance,
} from '@/lib/depot/copilot/facts/serviceText';
import type { CopilotFact } from '@/lib/depot/copilot/types';
import { formatCount } from '@/lib/depot/format';
import { inBand } from '@/lib/depot/service/bands';
import { hourLabel } from '@/lib/depot/service/feedMinutes';
import type { Proposal, RouteHourFigures, RouteHourlyBody } from '@/lib/depot/service/types';

/*
 * Facts of one route's day, from the route day body as the route page shows it. Every
 * figure says where it comes from: deployed is DERIVED where this server observed the
 * hour, LIVE for the feed clock's own hour and MODELLED otherwise; scheduled is DERIVED
 * from the journeys and timetables known; demand, need and the gap rest on MODELLED demand.
 */

/** Proposals named in one answer: the leading entries keep a request far below the fact cap. */
export const MAX_ROUTE_PROPOSALS = 3;
const HOURS_PER_DAY = 24;

export const routeNameFact = (body: RouteHourlyBody): CopilotFact =>
  nameFact('route.name', 'Route', cleanName(body.routeName), 'live');

/** Below half a bus either way the hour is level: the page's gap row rounds the same way. */
export const gapSide = (gap: number): 'short' | 'over' | 'level' => {
  const whole = Math.round(gap);
  if (whole === 0) return 'level';
  return whole > 0 ? 'short' : 'over';
};

/** Deployed, scheduled, demand, need and gap at one hour, each with its provenance. */
export function routeHourFacts(figures: RouteHourFigures): CopilotFact[] {
  const facts: CopilotFact[] = [
    makeFact('hour.span', 'Hour', hourSpanText(figures.hour), 'derived'),
    makeFact(
      'hour.deployed',
      'Buses running',
      busesText(figures.deployed),
      DEPLOYED_PROVENANCE[figures.deployedBasis],
    ),
    makeFact('hour.demand', 'Passengers', countText(Math.round(figures.demand), 'passenger', 'passengers'), 'modelled'),
    makeFact('hour.needed', 'Buses needed', busesText(figures.needed), 'modelled'),
  ];
  if (figures.scheduled !== null) {
    facts.push(makeFact('hour.scheduled', 'Buses scheduled', busesText(figures.scheduled), 'derived'));
  }
  if (gapSide(figures.gap) !== 'level') {
    facts.push(makeFact('hour.gap', 'Gap', busesText(figures.gap), 'modelled'));
  }
  return facts;
}

/** The proposal whose band holds the hour, if any. */
export const proposalAt = (body: RouteHourlyBody, hour: number): Proposal | undefined =>
  body.proposals.find((p) => inBand(p.band, hour));

/** `<prefix>.line`: the band and the change in one fact, provenance by what it rests on. */
export const proposalLineFact = (proposal: Proposal, id: string, label: string): CopilotFact =>
  makeFact(id, label, proposalLine(proposal, false), proposalProvenance(proposal.tier));

/** The route's day so far: hours short and over, the largest gap, what was observed. */
export function routeDayFacts(body: RouteHourlyBody): CopilotFact[] {
  const short = body.hours.filter((h) => gapSide(h.gap) === 'short');
  const over = body.hours.filter((h) => gapSide(h.gap) === 'over');
  const peak = short.reduce<RouteHourFigures | null>(
    (best, h) => (best === null || h.gap > best.gap ? h : best),
    null,
  );
  const hoursOf = (n: number): string => `${formatCount(n)} of ${HOURS_PER_DAY} hours`;
  const facts: CopilotFact[] = [
    makeFact('day.short_hours', 'Hours short', hoursOf(short.length), 'modelled'),
    makeFact('day.over_hours', 'Hours in surplus', hoursOf(over.length), 'modelled'),
  ];
  if (peak !== null) {
    facts.push(
      makeFact('day.peak_hour', 'Largest gap at', hourSpanText(peak.hour), 'modelled'),
      makeFact('day.peak_gap', 'Largest gap', busesText(peak.gap), 'modelled'),
    );
  }
  if (body.observed !== null) {
    facts.push(
      makeFact('day.observed_since', 'Observed since', observedSinceText(body.observed), 'derived'),
    );
  }
  if (body.currentHour !== null) {
    facts.push(makeFact('day.feed_hour', 'Feed clock', hourLabel(body.currentHour), 'live'));
  }
  body.proposals.slice(0, MAX_ROUTE_PROPOSALS).forEach((p, i) => {
    facts.push(proposalLineFact(p, `p.${i + 1}.line`, `Proposal ${i + 1}`));
  });
  if (body.proposals.length > MAX_ROUTE_PROPOSALS) {
    facts.push(
      makeFact('p.total', 'Proposals', countText(body.proposals.length, 'proposal', 'proposals'), 'modelled'),
    );
  }
  return facts;
}
