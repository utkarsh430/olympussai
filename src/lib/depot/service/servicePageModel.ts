import type { ProvenanceDescription } from '../provenanceLine';
import type { DepotMeaning } from '../palette';
import { MINUS, formatCount, formatFeedTimeOn, formatPlainDate } from '../format';
import { BREAKPOINT_PX, WIDE_VIEWPORT_PX } from '../shell/geometry';
import type { Provenance } from '../types';
import {
  DASH,
  SERVICE_TEXT,
  TIER_CELL,
  TIER_SENTENCE,
  bandLabel,
  busFigure,
  changeCell,
  gapFigure,
  gapWords,
} from './serviceWording';
import type { ImpactRange, Proposal, RouteHourlyBody, RouteHourlyResponse } from './types';

/*
 * The route's hour-by-hour page as data: the figure band for the current hour, the
 * coverage sentences, the provenance line and the proposals table's rows and column
 * sets per width. The components render what these return.
 */

export interface ServiceFigure {
  readonly label: string;
  readonly value: string;
  readonly caption: string;
  readonly tag?: Provenance;
  readonly tone?: DepotMeaning;
}

type Body = RouteHourlyResponse;

function currentFigures(body: Body): Body['hours'][number] | null {
  if (body.currentHour === null) return null;
  return body.hours.find((h) => h.hour === body.currentHour) ?? null;
}

function gapTone(gap: number): DepotMeaning | undefined {
  const whole = Math.round(gap);
  if (whole === 0) return undefined;
  return whole > 0 ? 'worse' : 'better';
}

function samplesFigure(body: Body): ServiceFigure {
  if (body.observed === null) {
    return { label: 'Samples', value: '0', caption: SERVICE_TEXT.notObservedYet };
  }
  const since = formatFeedTimeOn(body.observed.since, body.feedNow);
  return { label: 'Samples', value: formatCount(body.observed.samples), caption: `Observed since ${since}` };
}

/** Deployed now, needed now (modelled), the gap now and the samples behind the day. */
export function serviceFigures(body: Body): readonly ServiceFigure[] {
  const now = currentFigures(body);
  if (now === null) {
    const none = { value: DASH, caption: SERVICE_TEXT.noFeedClock };
    return [
      { label: 'Deployed now', ...none },
      { label: 'Needed now', ...none, tag: 'modelled' },
      { label: 'Gap now', ...none },
      samplesFigure(body),
    ];
  }
  const range = `Range ${busFigure(neededAt(now, 'low'))} to ${busFigure(neededAt(now, 'high'))}`;
  return [
    { label: 'Deployed now', value: busFigure(now.deployed), caption: SERVICE_TEXT.deployedCaption },
    { label: 'Needed now', value: busFigure(now.needed), caption: range, tag: 'modelled' },
    { label: 'Gap now', value: gapFigure(now.gap), caption: gapWords(now.gap), tone: gapTone(now.gap) },
    samplesFigure(body),
  ];
}

const TENTHS = 10;

function neededAt(hour: Body['hours'][number], end: 'low' | 'high'): number {
  if (hour.demand <= 0) return hour.needed;
  return Math.round((hour.demandBand[end] * hour.needed * TENTHS) / hour.demand) / TENTHS;
}

/** The route's standing buses, said once: they carry its name but are not deployed. */
function standingSentence(standing: number): readonly string[] {
  if (standing <= 0) return [];
  return standing === 1
    ? ['1 standing now carries this route’s name; it is not counted as deployed.']
    : [`${formatCount(standing)} standing now carry this route’s name; they are not counted as deployed.`];
}

/** The coverage sentences: what the day's figures rest on. */
export function coverageSentences(body: Body): readonly string[] {
  const observed =
    body.observed === null
      ? 'Not yet observed by this server today.'
      : `Observed by this server since ${formatFeedTimeOn(body.observed.since, body.feedNow)} (${formatCount(body.observed.samples)} samples).`;
  return [
    observed,
    `Only buses that report a route name are counted: ${formatCount(body.routeCoverage.n)} of ${formatCount(body.routeCoverage.of)}.`,
    ...standingSentence(body.standingNow),
    `Scheduled trips known for ${formatCount(body.scheduledCoverage.n)} of ${formatCount(body.scheduledCoverage.of)} buses seen on this route today.`,
  ];
}

/**
 * The page's MIXED line: what is live, derived and modelled, then the coverage. Before the
 * day has loaded (or when it cannot) the line names the classes alone.
 */
export function routeHourlyProvenance(body: Body | null): ProvenanceDescription {
  const classes: ProvenanceDescription = {
    default: 'mixed',
    live: 'Buses on the route now',
    derived: 'deployed and scheduled buses by hour',
    modelled: 'passenger demand, buses needed and the proposals',
  };
  return body === null ? classes : { ...classes, second: coverageSentences(body).join(' ') };
}

/** The chart section's note: the operating date in words. */
export function chartNote(body: Pick<RouteHourlyBody, 'operatingDate'>): string {
  return `Operating day ${formatPlainDate(body.operatingDate)}`;
}

export interface ProposalRow {
  readonly id: string;
  readonly band: string;
  readonly change: string;
  readonly changeTitle: string;
  readonly deployed: string;
  readonly scheduled: string;
  readonly scheduledTitle: string | undefined;
  readonly needed: string;
  readonly source: string;
  readonly sourceTitle: string;
  readonly impact: string;
  readonly impactTitle: string;
  readonly impactLines: readonly string[];
  readonly restsOn: string;
  readonly restsOnTitle: string;
  readonly reason: string;
  readonly maybeCovered: boolean;
  readonly proposal: Proposal;
}

function money(n: number): string {
  return n < 0 ? `${MINUS}₹${formatCount(-n)}` : `₹${formatCount(n)}`;
}

function rangeText(range: ImpactRange, figure: (n: number) => string, joiner: string): string {
  return `${figure(range.low)}${joiner}${figure(range.high)}`;
}

function sourceCell(p: Proposal): Pick<ProposalRow, 'source' | 'sourceTitle'> {
  if (p.source === null) return { source: DASH, sourceTitle: SERVICE_TEXT.noSource };
  const { depotName, standingInYard, basis } = p.source;
  if (basis === 'observed' && standingInYard !== null) {
    return {
      source: `${depotName} · ${formatCount(standingInYard)} standing`,
      sourceTitle: `${depotName}: ${formatCount(standingInYard)} buses standing in its yard in the hour before the band, as observed.`,
    };
  }
  return {
    source: `${depotName} · day plan`,
    sourceTitle: `${depotName}: idle buses in the modelled day plan.`,
  };
}

function impactCells(p: Proposal): Pick<ProposalRow, 'impact' | 'impactTitle' | 'impactLines'> {
  if (p.impact === null) return { impact: DASH, impactTitle: SERVICE_TEXT.noImpact, impactLines: [] };
  const i = p.impact;
  const lines = [
    `Passengers a day: ${rangeText(i.passengersPerDay, formatCount, ' to ')}`,
    `Revenue a day: ${rangeText(i.revenuePerDay, money, ' to ')}`,
    `Bus-km a day: ${rangeText(i.busKmPerDay, formatCount, ' to ')}`,
    `Cost a day: ${rangeText(i.costPerDay, money, ' to ')}`,
  ];
  return {
    impact: rangeText(i.passengersPerDay, formatCount, '–'),
    impactTitle: lines.join('; '),
    impactLines: lines,
  };
}

export function proposalRow(p: Proposal): ProposalRow {
  return {
    id: p.id,
    band: bandLabel(p.band),
    change: changeCell(p.kind, p.change),
    changeTitle: p.change === 0 ? SERVICE_TEXT.noSource : `${changeCell(p.kind, p.change)} buses`,
    deployed: busFigure(p.deployed),
    scheduled: busFigure(p.scheduled),
    scheduledTitle: p.scheduled === null ? SERVICE_TEXT.noScheduled : undefined,
    needed: busFigure(p.needed),
    ...sourceCell(p),
    ...impactCells(p),
    restsOn: TIER_CELL[p.tier],
    restsOnTitle: TIER_SENTENCE[p.tier],
    reason: p.reason,
    maybeCovered: p.maybeCoveredByUnrouted,
    proposal: p,
  };
}

export type ProposalColumnKey =
  | 'band'
  | 'change'
  | 'deployed'
  | 'scheduled'
  | 'needed'
  | 'source'
  | 'impact'
  | 'restsOn'
  | 'reason';

/** Every column from 1440; below it the reason and the scheduled figure live in the expanded row. */
export type ProposalTableTier = 'full' | 'wide' | 'narrow';

/**
 * Widths in px: each fits its header (a MODELLED pill included) and its longest cell
 * word; a depot name longer than the source column truncates, with the full text in
 * its title. The reason is a sentence, so its column only previews it.
 */
export const PROPOSAL_COLUMN_WIDTHS: Readonly<Record<ProposalColumnKey, number>> = {
  band: 104,
  change: 120,
  deployed: 88,
  scheduled: 96,
  needed: 136,
  source: 160,
  impact: 168,
  restsOn: 120,
  reason: 136,
};

const COLUMN_SETS: Readonly<Record<ProposalTableTier, readonly ProposalColumnKey[]>> = {
  full: ['band', 'change', 'deployed', 'scheduled', 'needed', 'source', 'impact', 'restsOn', 'reason'],
  wide: ['band', 'change', 'deployed', 'needed', 'source', 'impact', 'restsOn'],
  narrow: ['band', 'change', 'needed', 'impact', 'restsOn'],
};

/** The tiers from the widest, for `useWidthTier`. */
export const PROPOSAL_TIERS: readonly (readonly [ProposalTableTier, number])[] = [
  ['full', WIDE_VIEWPORT_PX],
  ['wide', BREAKPOINT_PX.lg],
  ['narrow', 0],
];

export function proposalTierFor(viewportPx: number): ProposalTableTier {
  return PROPOSAL_TIERS.find(([, from]) => viewportPx >= from)?.[0] ?? 'narrow';
}

/** The columns shown at a tier; what a tier drops is in the expanded row. */
export function proposalColumnKeys(tier: ProposalTableTier): readonly ProposalColumnKey[] {
  return COLUMN_SETS[tier];
}
