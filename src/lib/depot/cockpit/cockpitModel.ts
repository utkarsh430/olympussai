import type { DepotBusView, DepotDetailResponse, VisitorBus } from '@/lib/depot/api';
import {
  describeBusException,
  describeDepotException,
  SEVERITY_LABEL,
} from '@/lib/depot/exceptions/describe';
import type { ExceptionSeverity } from '@/lib/depot/exceptions/types';
import { formatCount } from '@/lib/depot/format';
import type { BusLocation, OutshedRow, OutshedState, Yard } from '@/lib/depot/infer/types';
import { YARD_DOMINANCE_RATIO, YARD_MIN_CLUSTER } from '@/lib/depot/infer/yard';
import { BUS_LOCATION_LABEL, BUS_STATE_LABEL, DEPOT_KIND_LABEL } from '@/lib/depot/labels';
import {
  buildLeagueRows,
  PEER_GROUP_LABEL,
  unrankedSentence,
} from '@/lib/depot/league/leagueModel';
import type { DepotScore } from '@/lib/depot/score/types';
import type { BusOpState, Coverage, DepotSummary, Figure, StateMix } from '@/lib/depot/types';

/**
 * What a depot manager sees first on a shift: the cockpit's figures, derived
 * from one `DepotDetailResponse`. Pure, so every ordering and sentence is tested;
 * the components only render what this returns.
 */

export interface StateCell {
  readonly state: BusOpState;
  readonly label: string;
  readonly count: number;
  /** Share of the fleet, 0 to 1; null for a depot with no buses. */
  readonly share: number | null;
}

export interface LocationCell {
  readonly location: BusLocation;
  readonly label: string;
  readonly count: number;
}

export type YardStatus =
  | { readonly established: true; readonly sample: Coverage; readonly sentence: string }
  | { readonly established: false; readonly sentence: string };

export interface StatusBoard {
  readonly fleet: number;
  readonly states: readonly StateCell[];
  readonly standing: number;
  /** Standing buses by location; null when there is no yard to place them against. */
  readonly locations: readonly LocationCell[] | null;
  readonly yard: YardStatus;
}

export interface TrackerRow {
  readonly key: string;
  readonly registrationNumber: string;
  readonly routeName: string | null;
  readonly journeyCode: string | null;
  readonly scheduledStart: string;
  readonly state: OutshedState;
  readonly label: string;
  readonly minutes: number | null;
  readonly minutesText: string;
}

export interface CockpitHeader {
  readonly name: string;
  readonly kindLabel: string;
  readonly fleet: number;
  readonly ranked: boolean;
  readonly index: number | null;
  readonly rank: number | null;
  readonly peerCount: number | null;
  readonly peerGroupLabel: string | null;
  readonly unrankedReason: string | null;
}

export interface ExceptionLine {
  readonly id: string;
  readonly severity: ExceptionSeverity;
  readonly severityLabel: string;
  /** "Depot", or the bus registration. */
  readonly subject: string;
  readonly registrationNumber: string | null;
  readonly sentence: string;
}

export interface VisitorRow {
  readonly registrationNumber: string;
  /** The visitor's own depot, whose roster lists it; null when the feed gives none. */
  readonly homeDepotId: string | null;
  readonly homeDepotLabel: string;
  readonly stateLabel: string;
}

export interface CockpitModel {
  readonly header: CockpitHeader;
  readonly board: StatusBoard;
  readonly tracker: readonly TrackerRow[];
  readonly coverageSentence: string;
  readonly hasSchedules: boolean;
  readonly exceptions: readonly ExceptionLine[];
  readonly visitors: readonly VisitorRow[];
}

const STATE_KEYS: readonly (readonly [BusOpState, keyof StateMix])[] = [
  ['in_service', 'inService'],
  ['on_road', 'onRoad'],
  ['standing', 'standing'],
  ['dark', 'dark'],
  ['off_road', 'offRoad'],
];
const LOCATIONS: readonly BusLocation[] = ['in_yard', 'at_other_yard', 'away', 'unknown'];

export const OUTSHED_STATE_LABEL: Readonly<Record<OutshedState, string>> = {
  overdue: 'Overdue',
  due: 'Due now',
  upcoming: 'Upcoming',
  unknown: 'Unknown',
  departed: 'Departed',
  ended: 'Window ended',
};
const OUTSHED_ORDER: readonly OutshedState[] = [
  'overdue',
  'due',
  'upcoming',
  'unknown',
  'departed',
  'ended',
];
const SEVERITY_ORDER: readonly ExceptionSeverity[] = ['critical', 'warning', 'info'];
const DASH = '—';
const MS_PER_MIN = 60_000;

const NO_YARD_SENTENCE =
  `No yard is established for this depot, so standing buses cannot be placed in it: a yard is ` +
  `claimed only when at least ${YARD_MIN_CLUSTER} parked buses stand together in one connected ` +
  `place that holds at least half of the depot's parked buses and ${YARD_DOMINANCE_RATIO} times ` +
  `as many as any other place.`;

function describeYard(yard: Figure<Yard | null>): YardStatus {
  if (yard.value === null) return { established: false, sentence: NO_YARD_SENTENCE };
  const sample = { n: yard.value.inCluster, of: yard.value.parked };
  const sentence = `Yard learned from ${formatCount(sample.n)} of ${formatCount(sample.of)} parked buses.`;
  return { established: true, sample, sentence };
}

function buildBoard(
  depot: DepotSummary,
  buses: readonly DepotBusView[],
  yard: YardStatus,
): StatusBoard {
  const states = STATE_KEYS.map(([state, key]) => ({
    state,
    label: BUS_STATE_LABEL[state],
    count: depot.states[key],
    share: depot.fleet > 0 ? depot.states[key] / depot.fleet : null,
  }));
  const standing = buses.filter((bus) => bus.state === 'standing');
  const locations = yard.established
    ? LOCATIONS.map((location) => ({
        location,
        label: BUS_LOCATION_LABEL[location],
        count: standing.filter((bus) => bus.location === location).length,
      }))
    : null;
  return { fleet: depot.fleet, states, standing: standing.length, locations, yard };
}

/** Minutes from the feed clock to a feed timestamp; both carry the same nominal zone. */
function minutesFromNow(feedNow: string | null, at: string): number | null {
  if (feedNow === null) return null;
  const diff = Date.parse(at) - Date.parse(feedNow);
  return Number.isFinite(diff) ? Math.round(diff / MS_PER_MIN) : null;
}

function departedText(row: OutshedRow): string {
  if (row.minutesLate === null) {
    return row.evidence === 'left_yard' ? 'Left the yard; no departure time' : DASH;
  }
  if (row.minutesLate === 0) return 'On time';
  return row.minutesLate > 0 ? `${row.minutesLate} min late` : `${-row.minutesLate} min early`;
}

function minutesFor(
  row: OutshedRow,
  feedNow: string | null,
): Pick<TrackerRow, 'minutes' | 'minutesText'> {
  const until = minutesFromNow(feedNow, row.scheduledStart);
  switch (row.state) {
    case 'overdue':
      return row.minutesOverdue === null
        ? { minutes: null, minutesText: DASH }
        : { minutes: row.minutesOverdue, minutesText: `${row.minutesOverdue} min overdue` };
    case 'due':
      return until === null
        ? { minutes: null, minutesText: 'Within grace' }
        : { minutes: -until, minutesText: `${-until} min since schedule` };
    case 'upcoming':
      return until === null
        ? { minutes: null, minutesText: DASH }
        : { minutes: until, minutesText: `in ${until} min` };
    case 'departed':
      return { minutes: row.minutesLate, minutesText: departedText(row) };
    case 'ended':
    case 'unknown':
      return { minutes: null, minutesText: DASH };
  }
}

/** Overdue first, then due, upcoming, unknown, departed, ended; by scheduled time within each. */
function buildTracker(rows: readonly OutshedRow[], feedNow: string | null): TrackerRow[] {
  return [...rows]
    .sort(
      (a, b) =>
        OUTSHED_ORDER.indexOf(a.state) - OUTSHED_ORDER.indexOf(b.state) ||
        a.scheduledStart.localeCompare(b.scheduledStart) ||
        a.registrationNumber.localeCompare(b.registrationNumber, 'en'),
    )
    .map((row) => ({
      key: `${row.registrationNumber}:${row.scheduledStart}`,
      registrationNumber: row.registrationNumber,
      routeName: row.routeName,
      journeyCode: row.journeyCode,
      scheduledStart: row.scheduledStart,
      state: row.state,
      label: OUTSHED_STATE_LABEL[row.state],
      ...minutesFor(row, feedNow),
    }));
}

/** "31 of 142 buses carry a schedule for today." */
export function coverageSentence(coverage: Coverage): string {
  if (coverage.of === 0) return 'This depot has no buses, so none carries a schedule for today.';
  const noun = coverage.of === 1 ? 'bus' : 'buses';
  const verb = coverage.n === 1 || coverage.of === 1 ? 'carries' : 'carry';
  return `${formatCount(coverage.n)} of ${formatCount(coverage.of)} ${noun} ${verb} a schedule for today.`;
}

function buildHeader(depot: DepotSummary, score: DepotScore | null): CockpitHeader {
  const base = { name: depot.name, kindLabel: DEPOT_KIND_LABEL[depot.kind], fleet: depot.fleet };
  const row = score === null ? undefined : buildLeagueRows([depot], [score])[0];
  if (row === undefined) {
    return {
      ...base,
      ranked: false,
      index: null,
      rank: null,
      peerCount: null,
      peerGroupLabel: null,
      unrankedReason: 'No score is available for this depot.',
    };
  }
  return {
    ...base,
    ranked: row.ranked,
    index: row.index,
    rank: row.rank,
    peerCount: row.peerCount,
    peerGroupLabel: row.peerGroup === null ? null : PEER_GROUP_LABEL[row.peerGroup],
    // Reuses the league's wording so the two pages never explain a missing rank differently.
    unrankedReason: unrankedSentence(row),
  };
}

function buildExceptions(exceptions: DepotDetailResponse['exceptions']): ExceptionLine[] {
  const lines: ExceptionLine[] = [
    ...exceptions.depot.map((e) => ({
      id: e.id,
      severity: e.severity,
      severityLabel: SEVERITY_LABEL[e.severity],
      subject: 'Depot',
      registrationNumber: null,
      sentence: describeDepotException(e),
    })),
    ...exceptions.bus.map((e) => ({
      id: e.id,
      severity: e.severity,
      severityLabel: SEVERITY_LABEL[e.severity],
      subject: e.registrationNumber,
      registrationNumber: e.registrationNumber,
      sentence: describeBusException(e),
    })),
  ];
  // Stable sort: within a severity, depot-wide lines keep their place before bus lines.
  return lines.sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
}

function buildVisitors(visitors: readonly VisitorBus[]): VisitorRow[] {
  return visitors
    .map((v) => ({
      registrationNumber: v.registrationNumber,
      homeDepotId: v.homeDepotId,
      homeDepotLabel:
        v.homeDepotName ?? (v.homeDepotId ? `Depot ${v.homeDepotId}` : 'No home depot in the feed'),
      stateLabel: BUS_STATE_LABEL[v.state],
    }))
    .sort(
      (a, b) =>
        a.homeDepotLabel.localeCompare(b.homeDepotLabel, 'en') ||
        a.registrationNumber.localeCompare(b.registrationNumber, 'en'),
    );
}

export function buildCockpit(detail: DepotDetailResponse): CockpitModel {
  const yard = describeYard(detail.yard);
  return {
    header: buildHeader(detail.depot, detail.score),
    board: buildBoard(detail.depot, detail.buses, yard),
    tracker: buildTracker(detail.outshed.rows, detail.feedNow),
    coverageSentence: coverageSentence(detail.outshed.coverage),
    hasSchedules: detail.outshed.rows.length > 0,
    exceptions: buildExceptions(detail.exceptions),
    visitors: buildVisitors(detail.visitors),
  };
}
