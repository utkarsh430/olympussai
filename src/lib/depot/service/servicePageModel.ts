import type { DepotMeaning } from '../palette';
import { MINUS, formatCount } from '../format';
import { BREAKPOINT_PX, WIDE_VIEWPORT_PX } from '../shell/geometry';
import type { Provenance } from '../types';
import {
  DASH,
  SERVICE_TEXT,
  TIER_CELL,
  TIER_SENTENCE,
  bandLabel,
  busFigure,
  gapFigure,
  gapWords,
  hourLabel,
} from './serviceWording';
import { changeWords } from './proposalChange';
import type { ImpactRange, Proposal, RouteHourFigures, RouteHourlyResponse } from './types';

/*
 * The route's hour-by-hour page as data: the figure band for the current hour and the
 * proposals table's rows and column sets per width (the coverage and the provenance line
 * are in `serviceCoverage`). The components render what these return.
 */

export interface ServiceFigure {
  readonly label: string;
  readonly value: string;
  readonly caption: string;
  readonly tag?: Provenance;
  readonly tone?: DepotMeaning;
  /** The band's main number: the gap now. */
  readonly lead?: boolean;
}

type Body = RouteHourlyResponse;

function currentFigures(body: Body): Body['hours'][number] | null {
  if (body.currentHour === null) return null;
  return body.hours.find((h) => h.hour === body.currentHour) ?? null;
}

function gapTone(gap: number): DepotMeaning | undefined {
  const whole = Math.round(gap);
  if (whole === 0) return undefined;
  // Over is the standing meaning: surplus buses are buses that could stand, not a good hour.
  return whole > 0 ? 'worse' : 'standing';
}

/** The day's question beside the hour's: how many hours are short, and when the most. */
function hoursShortFigure(body: Body): ServiceFigure {
  const short = body.hours.filter((h) => Math.round(h.gap) > 0);
  const peak = short.reduce<Body['hours'][number] | null>(
    (best, h) => (best === null || h.gap > best.gap ? h : best),
    null,
  );
  const caption =
    peak === null ? SERVICE_TEXT.noHourShort : `Peak ${gapFigure(peak.gap)} at ${hourLabel(peak.hour)}`;
  return { label: 'Hours short', value: formatCount(short.length), caption, tag: 'modelled' };
}

/** Deployed now, needed now (modelled), the gap now as the band's lead, and the day's hours short. */
export function serviceFigures(body: Body): readonly ServiceFigure[] {
  const now = currentFigures(body);
  if (now === null) {
    const none = { value: DASH, caption: SERVICE_TEXT.noFeedClock };
    return [
      { label: 'Deployed now', ...none },
      { label: 'Needed now', ...none, tag: 'modelled' },
      { label: 'Gap now', ...none, lead: true },
      hoursShortFigure(body),
    ];
  }
  const range = `Range ${busFigure(neededAt(now, 'low'))} to ${busFigure(neededAt(now, 'high'))}`;
  return [
    { label: 'Deployed now', value: busFigure(now.deployed), caption: SERVICE_TEXT.deployedCaption },
    { label: 'Needed now', value: busFigure(now.needed), caption: range, tag: 'modelled' },
    {
      label: 'Gap now',
      value: gapFigure(now.gap),
      caption: gapWords(now.gap),
      tone: gapTone(now.gap),
      lead: true,
    },
    hoursShortFigure(body),
  ];
}

const TENTHS = 10;

function neededAt(hour: Body['hours'][number], end: 'low' | 'high'): number {
  if (hour.demand <= 0) return hour.needed;
  return Math.round((hour.demandBand[end] * hour.needed * TENTHS) / hour.demand) / TENTHS;
}

export interface ProposalRow {
  readonly id: string;
  readonly band: string;
  readonly change: string;
  readonly changeTitle: string;
  /** The hourly range and the peak hour, for the expanded row; null when the change is one figure. */
  readonly peak: string | null;
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

/**
 * The source cell names the depot only, so it fits its column at every width; what the depot
 * offers (its standing buses, or the day plan's idle ones) is in the title and the expanded row.
 */
function sourceCell(p: Proposal): Pick<ProposalRow, 'source' | 'sourceTitle'> {
  if (p.source === null) {
    const title = p.change === 0 ? SERVICE_TEXT.noSource : SERVICE_TEXT.noSourceFound;
    return { source: DASH, sourceTitle: title };
  }
  const { depotName, standingInYard, basis } = p.source;
  if (basis === 'observed' && standingInYard !== null) {
    return {
      source: depotName,
      sourceTitle: `${depotName}: ${formatCount(standingInYard)} buses standing in its yard in the hour before the band, as observed.`,
    };
  }
  return { source: depotName, sourceTitle: `${depotName}: idle buses in the modelled day plan.` };
}

/** The bus-km a hold saves, as a positive range: its bus-km figure is the negative saving. */
function kmSaved(range: ImpactRange): ImpactRange {
  return { low: Math.max(0, -range.high), high: Math.max(0, -range.low) };
}

/**
 * The impact cell: the passengers an add carries, the bus-km a hold saves (a hold carries no
 * more passengers). The expanded row lists all four ranges either way.
 */
function impactCells(p: Proposal): Pick<ProposalRow, 'impact' | 'impactTitle' | 'impactLines'> {
  if (p.impact === null) return { impact: DASH, impactTitle: SERVICE_TEXT.noImpact, impactLines: [] };
  const i = p.impact;
  const lines = [
    `Passengers a day: ${rangeText(i.passengersPerDay, formatCount, ' to ')}`,
    `Revenue a day: ${rangeText(i.revenuePerDay, money, ' to ')}`,
    `Bus-km a day: ${rangeText(i.busKmPerDay, formatCount, ' to ')}`,
    `Cost a day: ${rangeText(i.costPerDay, money, ' to ')}`,
  ];
  const impact =
    p.change < 0
      ? `${rangeText(kmSaved(i.busKmPerDay), formatCount, '–')} km saved`
      : `${rangeText(i.passengersPerDay, formatCount, '–')} passengers`;
  return { impact, impactTitle: lines.join('; '), impactLines: lines };
}

/** One row of the proposals table; `hours` (the route's day) gives an add its hourly range. */
export function proposalRow(p: Proposal, hours: readonly RouteHourFigures[] = []): ProposalRow {
  return {
    id: p.id,
    band: bandLabel(p.band),
    ...changeWords(p, hours, SERVICE_TEXT.noSource),
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

/** The proposals table's two groups: what to do, then what to know. */
export const PROPOSAL_GROUP = { changes: 'Changes', findings: 'Timetable findings' } as const;

/** A proposal that moves buses (add or hold) is a change; one that moves none is a timetable finding. */
export function proposalGroup(p: Pick<Proposal, 'change'>): string {
  return p.change === 0 ? PROPOSAL_GROUP.findings : PROPOSAL_GROUP.changes;
}

/** True when a band ends before the current hour: today it can only inform the next day's plan. */
export function hasPastBand(
  proposals: readonly Pick<Proposal, 'band'>[],
  currentHour: number | null,
): boolean {
  return currentHour !== null && proposals.some((p) => p.band.toHour < currentHour);
}

/** Changes first, then the timetable findings; each by start hour, then end hour. */
export function orderProposals(proposals: readonly Proposal[]): readonly Proposal[] {
  const rank = (p: Proposal): number => (p.change === 0 ? 1 : 0);
  return [...proposals].sort(
    (a, b) => rank(a) - rank(b) || a.band.fromHour - b.band.fromHour || a.band.toHour - b.band.toHour,
  );
}

export type ProposalColumnKey =
  | 'band'
  | 'change'
  | 'deployed'
  | 'scheduled'
  | 'needed'
  | 'source'
  | 'impact'
  | 'restsOn';

/**
 * Every figure column from 1440; a narrower width drops the columns the expanded row also
 * holds (scheduled and source, then deployed and impact), and a phone keeps the band, the
 * change and what it rests on, so the table and its open row fit the frame without
 * scrolling sideways. The reason is a sentence, so at every width it is the expanded row's
 * first line.
 */
export type ProposalTableTier = 'full' | 'wide' | 'narrow' | 'phone';

/**
 * Widths in px, as a browser draws them: each fits its header (its "mean" unit and a
 * MODELLED pill included) and its longest cell word. The source cell is the depot's name
 * alone, capped inside this width (a very long name truncates, with the full text in its
 * title), since an automatic table layout would otherwise widen the column to the whole
 * name. Rests-on is one word, so the phone set fits a 390px frame.
 */
export const PROPOSAL_COLUMN_WIDTHS: Readonly<Record<ProposalColumnKey, number>> = {
  band: 112,
  change: 128,
  deployed: 128,
  scheduled: 136,
  needed: 200,
  source: 120,
  impact: 192,
  restsOn: 92,
};

const COLUMN_SETS: Readonly<Record<ProposalTableTier, readonly ProposalColumnKey[]>> = {
  full: ['band', 'change', 'deployed', 'scheduled', 'needed', 'source', 'impact', 'restsOn'],
  wide: ['band', 'change', 'deployed', 'needed', 'impact', 'restsOn'],
  narrow: ['band', 'change', 'needed', 'impact', 'restsOn'],
  phone: ['band', 'change', 'restsOn'],
};

/** The viewport from which the narrow set fits its frame (its width plus both gutters). */
const NARROW_FROM_PX = 800;

/** The tiers from the widest, for `useWidthTier`. */
export const PROPOSAL_TIERS: readonly (readonly [ProposalTableTier, number])[] = [
  ['full', WIDE_VIEWPORT_PX],
  ['wide', BREAKPOINT_PX.lg],
  ['narrow', NARROW_FROM_PX],
  ['phone', 0],
];

export function proposalTierFor(viewportPx: number): ProposalTableTier {
  return PROPOSAL_TIERS.find(([, from]) => viewportPx >= from)?.[0] ?? 'phone';
}

/** The columns shown at a tier; what a tier drops is in the expanded row. */
export function proposalColumnKeys(tier: ProposalTableTier): readonly ProposalColumnKey[] {
  return COLUMN_SETS[tier];
}
