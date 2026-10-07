import { formatCount, formatFeedTime } from '@/lib/depot/format';
import { bandLabel } from '@/lib/depot/service/bands';
import { money } from '@/lib/depot/service/proposalDetail';
import type {
  HourBasis,
  ImpactRange,
  ObservedSummary,
  Proposal,
  ProposalKind,
  ProposalTier,
} from '@/lib/depot/service/types';
import type { Provenance } from '@/lib/depot/types';

/*
 * Fact text and fixed sentences shared by the route-day, network-hours and proposal facts.
 * Figures live in fact text only; the sentences here hold no figure and say nothing of a
 * person. The words "hour", "morning" and "evening" are outside the copilot's vocabulary,
 * so a time of day is always a fact ("10:00–11:00"), never prose.
 */

/** A count of buses is always a whole number: a mean over hours is rounded before it is said. */
export function busesText(n: number): string {
  const size = Math.round(Math.abs(n));
  return `${formatCount(size)} ${size === 1 ? 'bus' : 'buses'}`;
}

/** A count with its own noun, singular for one. */
export const countText = (n: number, one: string, many: string): string =>
  `${formatCount(n)} ${n === 1 ? one : many}`;

const CLOCK = /^\d{2}:\d{2}$/;

/** "06:15 (79 samples)": since when this server observed the date, and how often. */
export function observedSinceText(observed: ObservedSummary): string {
  const since = CLOCK.test(observed.since) ? observed.since : formatFeedTime(observed.since);
  return `${since} (${countText(observed.samples, 'sample', 'samples')})`;
}

/** One hour of the day as the span it covers: "10:00–11:00". */
export const hourSpanText = (hour: number): string => bandLabel({ fromHour: hour, toHour: hour });

/** Observed hours are DERIVED, the feed clock's own hour LIVE, the modelled day MODELLED. */
export const DEPLOYED_PROVENANCE: Readonly<Record<HourBasis, Provenance>> = {
  observed: 'derived',
  current: 'live',
  modelled: 'modelled',
};

/** A finding from measured data only is DERIVED; anything resting on modelled demand is MODELLED. */
export const proposalProvenance = (tier: ProposalTier): Provenance =>
  tier === 'A' ? 'derived' : 'modelled';

const FINDING_WORDS: Readonly<Record<ProposalKind, string>> = {
  add_buses: 'add',
  hold_buses: 'hold',
  trips_not_run: 'trips not run',
  service_span_gap: 'service span gap',
  headway_gap: 'headway gap',
  revise_running_time: 'revise running time',
  reserve_by_hour: 'reserve by hour',
  maintenance_window: 'maintenance window',
  shift_departures: 'shift departures',
  corridor_over_served: 'corridor over-served',
  corridor_under_served: 'corridor under-served',
};

/** "add 3 buses", "hold 2 buses", or the finding's name when no bus moves. */
export function changeText(proposal: Proposal): string {
  const words = FINDING_WORDS[proposal.kind];
  return proposal.change === 0 ? words : `${words} ${busesText(proposal.change)}`;
}

/** "07:00–10:00: add 3 buses", optionally after the route's name. */
export function proposalLine(proposal: Proposal, withRoute: boolean): string {
  const line = `${bandLabel(proposal.band)}: ${changeText(proposal)}`;
  return withRoute ? `${proposal.routeName} ${line}` : line;
}

/** A modelled range with its noun: "120 to 180 passengers", "₹1,200 to ₹1,800". */
export function rangeText(range: ImpactRange, figure: (n: number) => string, noun = ''): string {
  return `${figure(range.low)} to ${figure(range.high)}${noun === '' ? '' : ` ${noun}`}`;
}

export const passengersText = (proposal: Proposal): string | null =>
  proposal.impact === null ? null : rangeText(proposal.impact.passengersPerDay, formatCount, 'passengers');
export const revenueText = (range: ImpactRange): string => rangeText(range, money);

/** The line with its modelled passengers, for a list ranked by impact. */
export function proposalImpactLine(proposal: Proposal): string {
  const impact = passengersText(proposal);
  return impact === null ? proposalLine(proposal, true) : `${proposalLine(proposal, true)}, ${impact}`;
}

/** What a proposal rests on, as a sentence with no figure. */
export const TIER_WORDS: Readonly<Record<ProposalTier, string>> = {
  A: 'It rests on measured data only: the feed and the timetable.',
  B: 'It rests on measured buses on the road and modelled passenger demand.',
  C: 'It rests on the modelled plan and modelled passenger demand only.',
};

export const RECOMMENDATION_ONLY = 'This is a recommendation; nothing is dispatched or assigned.';
export const DEMAND_NOTE =
  'Needs rest on modelled passenger demand until measured passenger counts are connected.';
export const MAYBE_COVERED =
  'Buses on the road that report no route name may already cover this gap.';
