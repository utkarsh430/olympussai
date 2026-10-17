import { formatCount, formatPercent } from '../format';
import { hourLabel } from '../service/serviceWording';
import type { Feasibility, Recommendation, ScenarioRoute, UnresolvedReason } from './types';

/*
 * The AI Redistribution Engine's words: the page's title and sentences, the figures'
 * explanations, and the sentences the engine writes from its own numbers.
 */

export const PAGE_TITLE = 'AI Redistribution Engine';
export const PAGE_TAGLINE = 'Right Buses. Right Routes. Right Time.';
export const PAGE_DESCRIPTION =
  'Analyze hourly passenger demand, identify route-level shortages and surplus capacity, and discover intelligent bus redistribution opportunities to maximize service coverage and fleet efficiency.';
/** The discreet indicator that the figures are a scenario, not verified live measurements. */
export const SCENARIO_INDICATOR = 'Demonstration Scenario';

export const SECTION = {
  overview: { id: 'network-overview', label: 'Network Intelligence Overview' },
  heatmap: { id: 'demand-supply-heatmap', label: 'Hourly Demand & Supply Heatmap' },
  recommendations: { id: 'ai-recommendations', label: 'AI Redistribution Recommendations' },
  impact: { id: 'impact-analysis', label: 'Before vs. After Impact Analysis' },
  timeline: { id: 'movement-timeline', label: 'Bus Movement Timeline' },
  briefing: { id: 'operational-briefing', label: 'AI Operational Briefing' },
} as const;

const MINUTES_PER_HOUR = 60;

/** Minutes from midnight as "07:20". */
export function clock(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const h = Math.floor(whole / MINUTES_PER_HOUR) % 24;
  const m = whole % MINUTES_PER_HOUR;
  return `${hourLabel(h).slice(0, 2)}:${m < 10 ? `0${m}` : m}`;
}

/** Inclusive hours as a window: 8 to 9 reads "08:00–10:00". */
export function hourWindow(fromHour: number, toHour: number): string {
  return `${hourLabel(fromHour)}–${toHour + 1 >= 24 ? '24:00' : hourLabel(toHour + 1)}`;
}

/** "08:00" for one hour, else the window. */
export function hoursPhrase(fromHour: number, toHour: number): string {
  return fromHour === toHour ? hourLabel(fromHour) : hourWindow(fromHour, toHour);
}

export const FEASIBILITY_LABEL: Readonly<Record<Feasibility, string>> = {
  high: 'High feasibility',
  medium: 'Medium feasibility',
  low: 'Low feasibility',
};

export const FEASIBILITY_WORDS: Readonly<Record<Feasibility, string>> = {
  high: 'Same depot, under 30 minutes of repositioning.',
  medium: 'Within an hour of repositioning.',
  low: 'Over an hour of repositioning between depots; confirm crew hours before relying on it.',
};

export const UNRESOLVED_WORDS: Readonly<Record<UnresolvedReason, string>> = {
  surplus_exhausted: 'Spare buses within reach were all committed to larger shortages.',
  no_surplus: 'No route holds a spare bus in these hours.',
  out_of_reach: 'Spare buses exist only at depots beyond intra-day repositioning distance.',
};

export const KPI_HELP = {
  routesShort: 'Routes whose buses required exceed buses available in at least one hour of the selected window.',
  shortage:
    'The sum over every route and hour in the window of buses required minus buses available, where positive. Bus-hours accumulate across the window; the peak figure is the most buses short at any single hour.',
  surplus:
    'The sum over every route and hour in the window of buses available minus buses required, where positive; the peak figure is the most spare buses standing at any single hour.',
  opportunities: 'Feasible transfers the engine finds for this window: each moves spare buses to a short route without leaving the donor short.',
  coverage:
    'Passenger demand the current allocation can carry: each hour counts min(1, available ÷ required) of its passengers, summed over the window and divided by total demand.',
  improvement: 'Demand coverage after every feasible transfer minus coverage now, in percentage points.',
} as const;

/** The engine's reason for one transfer, written from its figures. */
export function recommendationReason(
  rec: Pick<Recommendation, 'buses' | 'targetFromHour' | 'targetToHour' | 'repositionMin' | 'coverageBefore' | 'coverageAfter'>,
  destination: ScenarioRoute,
  donor: ScenarioRoute,
  donorDepotName: string | null,
  donorSpare: number,
): string {
  const hour = rec.targetFromHour;
  const demand = destination.demand[hour] ?? 0;
  const need = destination.required[hour] ?? 0;
  const have = destination.available[hour] ?? 0;
  const where = donorDepotName === null ? 'in the same depot' : `at ${donorDepotName}`;
  const window = hoursPhrase(rec.targetFromHour, rec.targetToHour);
  const spare = formatCount(donorSpare);
  const buses = formatCount(rec.buses);
  return (
    `${destination.id} faces concentrated demand at ${hourLabel(hour)}: ${formatCount(demand)} passengers forecast against ` +
    `${formatCount(have)} of ${formatCount(need)} buses required. ${donor.id} ${where} holds ${spare} spare ` +
    `${donorSpare === 1 ? 'bus' : 'buses'} over the same window, so ${buses} can reposition in about ${rec.repositionMin} minutes ` +
    `and lift ${destination.id}'s coverage over ${window} from ${formatPercent(rec.coverageBefore)} to ${formatPercent(rec.coverageAfter)}.`
  );
}

/** "+8 pts" style change in coverage. */
export function coveragePoints(before: number, after: number): string {
  const pts = Math.round((after - before) * 100);
  return `${pts > 0 ? '+' : ''}${pts} pts`;
}

export function busesWord(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'bus' : 'buses'}`;
}
