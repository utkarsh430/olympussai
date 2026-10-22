import { formatCount, formatPercent, signFor } from '../format';
import { hourLabel } from '../service/serviceWording';
import { routeWindowFigures } from './metrics';
import { depotName } from './scenario';
import type { NetworkMetrics, Recommendation, Scenario, ScenarioRoute, Selection, UnresolvedShortage } from './types';
import { busesWord, clock, hoursPhrase, hourWindow, UNRESOLVED_WORDS } from './wording';

/*
 * The AI operational briefing, written from the page's state alone: the figures before
 * and after the moves the manager kept, the largest shortages, the donors, the moves and
 * what stays short. Six sections, each a few sentences; no claim the figures do not support.
 */

export interface BriefingSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export interface BriefingInput {
  readonly scenario: Scenario;
  readonly selection: Selection;
  readonly bandLabel: string;
  readonly routes: readonly ScenarioRoute[];
  readonly before: NetworkMetrics;
  /** Null until a plan has been generated. */
  readonly after: NetworkMetrics | null;
  readonly recommendations: readonly Recommendation[];
  readonly includedIds: ReadonlySet<string>;
  readonly unresolved: readonly UnresolvedShortage[];
}

const TOP_SHORTAGES = 5;
const TOP_DONORS = 4;
const TOP_MOVES = 5;
const TOP_UNRESOLVED = 4;

const points = (before: number, after: number): string => {
  const pts = Math.round((after - before) * 100);
  return `${pts > 0 ? '+' : ''}${pts} percentage points`;
};

const scopeWords = (input: BriefingInput): string =>
  input.selection.depotId === null ? 'across all eight depots' : `at ${depotName(input.scenario, input.selection.depotId)}`;

function situation(input: BriefingInput): BriefingSection {
  const { before, selection } = input;
  const window = hourWindow(selection.fromHour, selection.toHour);
  const peak =
    before.peakShortageHour === null
      ? 'No hour in the window is short.'
      : `The pinch is sharpest at ${hourLabel(before.peakShortageHour)}, when ${busesWord(before.peakSimultaneousShortage)} are short at once.`;
  return {
    heading: 'Network Situation',
    paragraphs: [
      `${input.bandLabel} (${window}) ${scopeWords(input)}: ${formatCount(before.routes)} routes carry a forecast of ${formatCount(before.demand)} passengers, and the current allocation covers ${formatPercent(before.coverage)} of that demand.`,
      `${formatCount(before.routesShort)} routes are short in at least one hour, a cumulative shortage of ${formatCount(before.shortageBusHours)} bus-hours, while ${formatCount(before.routesSurplus)} routes hold ${formatCount(before.surplusBusHours)} surplus bus-hours over the same window. ${peak}`,
    ],
  };
}

function shortages(input: BriefingInput): BriefingSection {
  const worst = input.routes
    .map((r) => ({ r, f: routeWindowFigures(r, null, input.selection) }))
    .filter((x) => x.f.shortageBusHours > 0)
    .sort((a, b) => b.f.peakShortage - a.f.peakShortage || b.f.shortageBusHours - a.f.shortageBusHours)
    .slice(0, TOP_SHORTAGES);
  if (worst.length === 0) {
    return { heading: 'Critical Shortages', paragraphs: ['No route is short in this window; no priority attention is required.'] };
  }
  const lines = worst.map(
    ({ r, f }) =>
      `${r.id} (${depotName(input.scenario, r.depotId)}): short ${busesWord(f.peakShortage)} at ${f.peakShortageHour === null ? '' : hourLabel(f.peakShortageHour)}, ${formatCount(f.shortageBusHours)} bus-hours over the window, coverage ${formatPercent(f.coverage)}.`,
  );
  return {
    heading: 'Critical Shortages',
    paragraphs: [`The ${formatCount(worst.length)} routes needing priority attention, by their deepest hourly shortage:`, ...lines],
  };
}

function opportunities(input: BriefingInput): BriefingSection {
  const donors = input.routes
    .map((r) => ({ r, f: routeWindowFigures(r, null, input.selection) }))
    .filter((x) => x.f.surplusBusHours > 0)
    .sort((a, b) => b.f.surplusBusHours - a.f.surplusBusHours)
    .slice(0, TOP_DONORS);
  if (donors.length === 0) {
    return { heading: 'Available Redistribution Opportunities', paragraphs: ['No route holds spare buses in this window, so nothing can be redistributed.'] };
  }
  const lines = donors.map(({ r, f }) => `${r.id} (${depotName(input.scenario, r.depotId)}): ${formatCount(f.surplusBusHours)} surplus bus-hours.`);
  const feasible = input.recommendations.length;
  return {
    heading: 'Available Redistribution Opportunities',
    paragraphs: [
      `${formatCount(input.before.surplusBusHours)} surplus bus-hours stand on ${formatCount(input.before.routesSurplus)} routes; the engine finds ${formatCount(feasible)} feasible ${feasible === 1 ? 'transfer' : 'transfers'} that reach a short route without leaving the donor short. The largest sources:`,
      ...lines,
    ],
  };
}

function movements(input: BriefingInput): BriefingSection {
  const kept = input.recommendations.filter((r) => input.includedIds.has(r.id));
  if (input.after === null) {
    return { heading: 'Recommended Movements', paragraphs: ['No redistribution plan has been generated for this window yet.'] };
  }
  if (kept.length === 0) {
    return { heading: 'Recommended Movements', paragraphs: ['Every proposed transfer has been excluded; the projected figures equal the current allocation.'] };
  }
  const lines = kept
    .slice(0, TOP_MOVES)
    .map(
      (m) =>
        `Transfer ${String(m.ordinal).padStart(2, '0')}: ${busesWord(m.buses)} from ${m.fromRouteId} to ${m.toRouteId}, repositioning ${clock(m.repositionStartMin)}–${clock(m.repositionEndMin)} to serve ${hoursPhrase(m.targetFromHour, m.targetToHour)}; about ${formatCount(m.passengersServed)} passengers carried.`,
    );
  const excluded = input.recommendations.length - kept.length;
  return {
    heading: 'Recommended Movements',
    paragraphs: [
      `${formatCount(kept.length)} of ${formatCount(input.recommendations.length)} proposed transfers are kept in the plan${excluded > 0 ? ` (${formatCount(excluded)} excluded by the manager)` : ''}, moving ${formatCount(kept.reduce((s, m) => s + m.buses, 0))} bus movements in all. The most valuable:`,
      ...lines,
    ],
  };
}

function impact(input: BriefingInput): BriefingSection {
  const { before, after } = input;
  if (after === null) {
    return { heading: 'Expected Operational Impact', paragraphs: ['Projected figures appear once a plan is generated.'] };
  }
  const shortageDrop = before.shortageBusHours - after.shortageBusHours;
  const surplusUsed = before.surplusBusHours - after.surplusBusHours;
  const waitChange = before.meanWaitMin - after.meanWaitMin;
  const remaining =
    after.shortageBusHours === 0
      ? 'No shortage remains in the window under the kept transfers.'
      : `${formatCount(after.shortageBusHours)} bus-hours of shortage remain on ${formatCount(after.routesShort)} routes.`;
  return {
    heading: 'Expected Operational Impact',
    paragraphs: [
      `Demand coverage moves from ${formatPercent(before.coverage)} to ${formatPercent(after.coverage)} (${points(before.coverage, after.coverage)}); the shortage falls from ${formatCount(before.shortageBusHours)} to ${formatCount(after.shortageBusHours)} bus-hours (${formatCount(shortageDrop)} closed), and routes short fall from ${formatCount(before.routesShort)} to ${formatCount(after.routesShort)}.`,
      `${formatCount(surplusUsed)} of ${formatCount(before.surplusBusHours)} surplus bus-hours are put to use. The headway-based estimate of mean passenger wait moves from ${before.meanWaitMin.toFixed(1)} to ${after.meanWaitMin.toFixed(1)} minutes (${signFor(after.meanWaitMin - before.meanWaitMin)}${Math.abs(waitChange).toFixed(1)}). ${remaining}`,
    ],
  };
}

function attention(input: BriefingInput): BriefingSection {
  const list = input.after === null ? [] : input.unresolved;
  if (input.after === null) {
    return { heading: 'Manager Attention Required', paragraphs: ['Generate a plan to see which shortages the available surplus cannot reach.'] };
  }
  if (list.length === 0) {
    return { heading: 'Manager Attention Required', paragraphs: ['No shortage remains after the kept transfers. Confirm crew availability for each repositioning before scheduling.'] };
  }
  const low = input.recommendations.filter((r) => input.includedIds.has(r.id) && r.feasibility === 'low').length;
  const lines = list
    .slice(0, TOP_UNRESOLVED)
    .map((u) => `${u.routeId}: still short ${busesWord(u.peakShortage)} at peak over ${u.hours.map(hourLabel).join(', ')}. ${UNRESOLVED_WORDS[u.reason]}`);
  return {
    heading: 'Manager Attention Required',
    paragraphs: [
      `${formatCount(list.length)} routes stay short after the plan, ${formatCount(list.reduce((s, u) => s + u.busHours, 0))} bus-hours in all; these need hired capacity, trip consolidation or a schedule change rather than redistribution.`,
      ...lines,
      ...(low > 0 ? [`${formatCount(low)} kept ${low === 1 ? 'transfer is' : 'transfers are'} low-feasibility inter-depot moves; confirm crew duty hours before relying on them.`] : []),
      'Every figure here is a recommendation: no bus has been dispatched or reassigned.',
    ],
  };
}

export function buildBriefing(input: BriefingInput): readonly BriefingSection[] {
  return [situation(input), shortages(input), opportunities(input), movements(input), impact(input), attention(input)];
}

/** The briefing as plain text, for the clipboard. */
export function briefingText(title: string, sections: readonly BriefingSection[]): string {
  return [title.toUpperCase(), '', ...sections.flatMap((s) => [s.heading.toUpperCase(), ...s.paragraphs, ''])].join('\n').trimEnd();
}
