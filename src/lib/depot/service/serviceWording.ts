import {
  MINUS,
  formatCount,
  formatDurationMinutes,
  formatOneDecimal,
  formatPercent,
} from '../format';
import type { HourBand, NeedInputs, ProposalKind, ProposalTier } from './types';

/*
 * Every label and sentence of the route's hour-by-hour page, in one place, so the page,
 * its chart and its tests say the same thing. A proposal's reason is printed as the
 * response gives it; nothing here rewrites it.
 */

const HOURS_PER_DAY = 24;
/** The empty cell's mark, as the format module writes it. */
export const DASH = '—';

/** An hour of the operating day as "HH:00". */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** A band of hours from the start of its first to the end of its last: "07:00–11:00". */
export function bandLabel(band: HourBand): string {
  const end = Math.min(band.toHour + 1, HOURS_PER_DAY);
  return `${hourLabel(band.fromHour)}–${hourLabel(end)}`;
}

/** A bus count: whole numbers bare, a mean to one decimal. */
export function busFigure(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return DASH;
  return Number.isInteger(n) ? formatCount(n) : formatOneDecimal(n);
}

/** A signed whole gap: "+3" short, "−2" over, "0" even. */
export function gapFigure(gap: number): string {
  const whole = Math.round(gap);
  if (whole === 0) return '0';
  return whole > 0 ? `+${formatCount(whole)}` : `${MINUS}${formatCount(-whole)}`;
}

/** A delay through the duration formatter, keeping the sign of an early running. */
export function delayFigure(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return DASH;
  const text = formatDurationMinutes(Math.abs(minutes));
  return minutes < 0 && Math.floor(Math.abs(minutes)) > 0 ? `${MINUS}${text}` : text;
}

export const PROPOSAL_KIND_LABEL: Readonly<Record<ProposalKind, string>> = {
  add_buses: 'Add buses',
  hold_buses: 'Hold buses',
  trips_not_run: 'Trips not run',
  service_span_gap: 'Service span gap',
  headway_gap: 'Headway gap',
  revise_running_time: 'Revise running time',
};

/** The short cell word for a finding that moves no bus. */
const KIND_CELL: Readonly<Record<ProposalKind, string>> = {
  add_buses: 'Add',
  hold_buses: 'Hold',
  trips_not_run: 'Trips not run',
  service_span_gap: 'Span gap',
  headway_gap: 'Headway gap',
  revise_running_time: 'Running time',
};

/** "Add 3", "Hold 2", or the finding's short name when no bus moves. */
export function changeCell(kind: ProposalKind, change: number): string {
  if (change === 0) return KIND_CELL[kind];
  return `${KIND_CELL[kind]} ${formatCount(Math.abs(change))}`;
}

export const TIER_CELL: Readonly<Record<ProposalTier, string>> = {
  A: 'A · Measured',
  B: 'B · Mixed',
  C: 'C · Modelled',
};

export const TIER_SENTENCE: Readonly<Record<ProposalTier, string>> = {
  A: 'Rests on measured data only: the feed and the schedule.',
  B: 'Rests on measured deployment and modelled passenger demand.',
  C: 'Rests on the modelled day and modelled passenger demand only.',
};

export const SERVICE_TEXT = {
  chartTitle: 'Buses by hour',
  showTable: 'Show as table',
  tableCaption: 'Buses deployed, scheduled and needed for each hour of the day',
  bandLabel: 'This hour',
  deployedCaption: 'In service or on the road',
  proposalsTitle: 'Proposals',
  proposalsCaption: 'Proposals for this route',
  noProposals: 'No proposal for this route today: no band is short or over by enough to act.',
  punctualityTitle: 'Punctuality by hour',
  punctualityCaption: 'Median delay and late share by hour',
  noPunctuality: 'No hour this server observed carried a delay figure for this route.',
  delayUnit: 'The delay unit is unconfirmed.',
  demand:
    'Passenger demand is modelled from service class and route length, not ticketing; proposals are estimates until ticket data is connected.',
  recommendation: 'Recommendation only: nothing is dispatched or reassigned.',
  maybeCovered: 'May be covered by buses on the road that report no route name.',
  noSource: 'No bus moves for this finding.',
  noSourceFound: 'No source was identified for these buses.',
  noImpact: 'No modelled impact: this finding is about the timetable, not the bus count.',
  noScheduled: 'No scheduled trip is known for this hour.',
  loading: 'Loading the route’s day hour by hour',
  errorTitle: 'Route day unavailable',
  empty: 'This route has no figures for today yet: the feed has not reported it.',
  noFeedClock: 'No feed clock',
  notObservedYet: 'Not observed yet',
  even: 'Even',
} as const;

/** "Short by 3", "Over by 2" or "Even": the gap in words beside its signed figure. */
export function gapWords(gap: number): string {
  const whole = Math.round(gap);
  if (whole === 0) return SERVICE_TEXT.even;
  return whole > 0 ? `Short by ${formatCount(whole)}` : `Over by ${formatCount(-whole)}`;
}

/** The chart's legend, in words; each entry also has its own mark. */
export const LEGEND_TEXT = {
  observed: 'Deployed, observed',
  modelled: 'Deployed, modelled day',
  notObserved: 'Not observed (modelled day)',
  scheduled: 'Scheduled',
  needed: 'Needed, from modelled demand, with its range',
  now: 'Now',
  gap: 'Gap row: + short, − over',
} as const;

/** Where the journey time came from, in words. */
const JOURNEY_SOURCE: Readonly<Record<NeedInputs['journeyMinutesProvenance'], string>> = {
  live: 'from the feed',
  derived: 'from the feed’s scheduled times',
  reference: 'from the route profile',
  modelled: 'from the trip model',
};

/** What the need formula was given for this route, in words. */
export function needInputsSentence(need: NeedInputs): string {
  const journey = formatDurationMinutes(need.journeyMinutes);
  const layover = formatDurationMinutes(need.layoverMinutes);
  return `This route’s need rests on ${formatCount(need.seatsPerBus)} seats per bus, a journey of ${journey} ${JOURNEY_SOURCE[need.journeyMinutesProvenance]} plus ${layover} of layover, a target load of ${formatPercent(need.targetLoad)} and ${formatPercent(need.busiestStretchShare)} of boardings on the busiest stretch.`;
}

/** The closing disclosure: definitions, formulas in words, assumptions and replacements. */
export const SERVICE_HOW_PRODUCED: readonly string[] = [
  'Deployed is the mean number of buses carrying this route name in each hour in service or on the road, from the 5-minute samples this server took of the feed. An hour with fewer than 6 of its 12 samples is not observed; there the figure comes from the modelled operating day, drawn hatched ahead of now and as an empty outline before it, and counts the bus-hours of the modelled duties that had a bus. Standing buses that carry the route name are not counted as deployed.',
  'Scheduled is bus-hours: for each trip known for this route, the minutes it overlaps the hour, divided by 60. Trips come from the journeys the feed itself reports and from timetables loaded on request, so the figure covers only the buses whose day is known.',
  'Needed is trips needed times the round trip: the hour’s modelled boardings times the busiest stretch’s share, divided by seats per bus times the target load, gives trips; trips times the journey time plus layover, divided by 60, gives buses. The range follows the demand model’s spread of a quarter either way.',
  'The gap is needed minus deployed: positive is short, negative is over. A proposal adds buses where a band is short by at least 2 buses and a fifth of the need for 2 hours or more, from standing buses in a depot’s yard, else from buses the modelled day plan leaves idle; with neither, it names no source and rests on modelled figures only. It holds buses where a band is over while keeping one bus each way.',
  'Until ticketing is connected, the day’s modelled boardings follow the modelled duties: the day’s total rises and falls with the buses the modelled day plans for the route. So the gap shows when in the day buses are short, rather than how many are short over the whole day.',
  'Assumptions: passenger demand, seats per bus and the target load are modelled, not measured. Ticket sales would replace the demand model, a timetable feed the partial scheduled figure, and a stored history the single day this server has observed.',
];
