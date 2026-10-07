import { formatCount } from '../format';
import type { ProvenanceDescription } from '../provenanceLine';
import { changeCell, DASH, gapFigure, gapWords, hourLabel } from './serviceWording';
import { proposalRow, type ProposalRow, type ServiceFigure } from './servicePageModel';
import type {
  NetworkHourlyResponse,
  NetworkProposal,
  NetworkProposalGroup,
  NetworkRouteStrip,
  Proposal,
  ProposalKind,
  ReallocationUncoveredReason,
} from './types';

/*
 * The network "Service by the hour" page as data: the heat map's cells and its table view
 * in words, the figure band, the MIXED provenance line, the proposals table's rows and
 * groups, and the reallocation's reasons. The components render what these return.
 */

/** A gap of at least each of these whole buses (either way) takes one more step of strength. */
export const HEAT_STEPS: readonly number[] = [1, 3, 6];

export type HeatTone = 'short' | 'over' | 'even';

export interface HeatCell {
  /** The signed whole gap: "+3", "−2", "0". */
  readonly text: string;
  readonly words: string;
  readonly tone: HeatTone;
  /** 0 for even, then 1 to `HEAT_STEPS.length` by size. */
  readonly step: number;
  /** Observed (or the feed clock's hour); false where the modelled day stands in. */
  readonly measured: boolean;
}

export function heatCell(gap: number, basis: 'measured' | 'modelled'): HeatCell {
  const whole = Math.round(gap);
  const size = Math.abs(whole);
  const tone: HeatTone = whole === 0 ? 'even' : whole > 0 ? 'short' : 'over';
  return {
    text: gapFigure(gap),
    words: gapWords(gap),
    tone,
    step: HEAT_STEPS.filter((s) => size >= s).length,
    measured: basis === 'measured',
  };
}

export interface HeatTableRow {
  readonly routeName: string;
  readonly depot: string;
  /** 24 entries: the signed gap and "measured" or "modelled". */
  readonly hours: readonly string[];
  readonly peak: string;
}

/** The heat map in words: one row per route, every hour's gap and what it rests on. */
export function heatTableRows(strips: readonly NetworkRouteStrip[]): HeatTableRow[] {
  return strips.map((s) => ({
    routeName: s.routeName,
    depot: s.depotName ?? DASH,
    hours: s.gaps.map((g, h) => `${gapFigure(g)} ${s.bases[h] ?? 'modelled'}`),
    peak: s.peakHour === null ? 'None short' : `${gapFigure(s.peakGap)} at ${hourLabel(s.peakHour)}`,
  }));
}

/** The page's MIXED line; with nothing observed it names no observed hours. */
export function networkProvenance(body: Pick<NetworkHourlyResponse, 'observed'> | null): ProvenanceDescription {
  const observed = body === null || body.observed !== null;
  return {
    default: 'mixed',
    live: 'Buses now',
    derived: observed ? 'observed hours and scheduled trips' : 'scheduled trips',
    modelled: observed
      ? 'other hours, demand, need, proposals and moves'
      : 'deployment by hour, demand, need, proposals and moves',
  };
}

/** Routes short at the next peak (MODELLED), buses short and over in the band, moves proposed. */
export function networkFigures(body: NetworkHourlyResponse): readonly ServiceFigure[] {
  const next = body.bands.find((b) => b.band === body.nextPeak);
  const band = body.bands.find((b) => b.band === body.band);
  const label = band?.label.toLowerCase() ?? '';
  const { movesWithin, movesBetween } = body.totals;
  return [
    {
      label: 'Routes short at the next peak',
      value: formatCount(next?.shortRoutes ?? 0),
      caption: next ? `${next.label}, of ${formatCount(body.routes.total)} routes` : DASH,
      tag: 'modelled',
      tone: (next?.shortRoutes ?? 0) > 0 ? 'worse' : undefined,
      lead: true,
    },
    { label: 'Buses short', value: formatCount(body.totals.busesShort), caption: `Across short routes, ${label}`, tag: 'modelled' },
    { label: 'Buses over', value: formatCount(body.totals.busesOver), caption: `Across over routes, ${label}`, tag: 'modelled' },
    {
      label: 'Moves proposed',
      value: formatCount(movesWithin + movesBetween),
      caption: `${formatCount(movesWithin)} within depots, ${formatCount(movesBetween)} between`,
      tag: 'modelled',
    },
  ];
}

const NETWORK_UNIT: Partial<Record<ProposalKind, string>> = { shift_departures: ' trips' };

/** The change cell: a route's own as on its day page; a network kind with its figure. */
export function networkChangeCell(kind: ProposalKind, change: number, count: number | null): string {
  if (count === null) return changeCell(kind, change);
  return `${changeCell(kind, 0)} ${formatCount(count)}${NETWORK_UNIT[kind] ?? ''}`;
}

export interface NetworkProposalRow extends Omit<ProposalRow, 'proposal'> {
  readonly route: string;
  readonly depot: string;
  readonly group: NetworkProposalGroup;
  readonly proposal: NetworkProposal;
}

export function networkProposalRow(p: NetworkProposal): NetworkProposalRow {
  const base = proposalRow({ ...p, routeName: p.routeName ?? '' } as Proposal);
  const change = p.count === null ? base.change : networkChangeCell(p.kind, p.change, p.count);
  return {
    ...base,
    change,
    route: p.routes.length > 0 ? p.routes.join(', ') : DASH,
    depot: p.depotName ?? DASH,
    group: p.group,
    proposal: p,
  };
}

export const NETWORK_GROUP_LABEL: Readonly<Record<NetworkProposalGroup, string>> = {
  changes: 'Changes',
  findings: 'Findings',
  network: 'Network moves',
};

const GROUP_ORDER: readonly NetworkProposalGroup[] = ['changes', 'findings', 'network'];

/** Changes, then findings, then the network moves; each by start hour, then route. */
export function orderNetworkProposals(proposals: readonly NetworkProposal[]): readonly NetworkProposal[] {
  const key = (p: NetworkProposal): string => p.routes.join(',') || (p.depotId ?? '');
  return [...proposals].sort(
    (a, b) =>
      GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
      a.band.fromHour - b.band.fromHour ||
      (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0),
  );
}

const UNCOVERED_WORDS: Readonly<Record<ReallocationUncoveredReason, string>> = {
  no_surplus_in_range: 'No depot with buses to spare lies within the intra-day distance.',
  insufficient_surplus: 'The depots within reach ran out of buses to spare.',
  no_position: 'The route’s depot has no known position, so no other depot can be measured to it.',
};

export function uncoveredWords(reason: ReallocationUncoveredReason): string {
  return UNCOVERED_WORDS[reason];
}

/**
 * When the body cut a group, one sentence that says so: "Listed: the 100 changes carrying the
 * most passengers of 685." Null when nothing was cut.
 */
export function cutNote(
  proposals: readonly Pick<NetworkProposal, 'group'>[],
  totals: Readonly<Record<NetworkProposalGroup, number>>,
): string | null {
  const parts = GROUP_ORDER.flatMap((group) => {
    const shown = proposals.filter((p) => p.group === group).length;
    const total = totals[group];
    if (shown >= total) return [];
    return [`the first ${formatCount(shown)} of ${formatCount(total)} ${NETWORK_GROUP_LABEL[group].toLowerCase()}`];
  });
  return parts.length === 0 ? null : `Listed by weight: ${parts.join('; ')}.`;
}
