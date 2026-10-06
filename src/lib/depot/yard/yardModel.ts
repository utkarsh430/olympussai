import type { DepotBusView, DepotDetailResponse, VisitorBus } from '@/lib/depot/api';
import { formatCount } from '@/lib/depot/format';
import { distanceM, isUsablePosition } from '@/lib/depot/infer/geo';
import { lastHeardText } from '@/lib/depot/roster/rosterModel';
import { MOVING_SPEED_KMPH } from '@/lib/depot/infer/thresholds';
import type { Yard } from '@/lib/depot/infer/types';
import type { BusOpState } from '@/lib/depot/types';
import { YARD_RULE_SENTENCE } from '@/lib/depot/infer/yardRuleText';

/** Fixed order for every state grouping, busiest operational state first. */
export const YARD_STATE_ORDER: readonly BusOpState[] = [
  'in_service',
  'on_road',
  'standing',
  'dark',
  'off_road',
];

/**
 * One hue per operational state for a near-black surface (`#02040a`). Checked with the
 * dataviz validator: chroma, adjacent-pair separation under colour-vision deficiency
 * and 3:1 contrast pass; the lightness band is the design system's light-surface band,
 * which these dark-surface steps sit just above. The state is always also written as a
 * word, so colour never carries it alone. Exported so the cockpit and roster can reuse
 * the same hues.
 */
export const BUS_STATE_COLOUR: Readonly<Record<BusOpState, string>> = {
  in_service: '#3fb68b',
  on_road: '#5aa9e6',
  standing: '#e0b04a',
  dark: '#a79bff',
  off_road: '#e5624d',
};

/** Buses are drawn out to this many yard radii; further out is not on the map. */
export const DISPLAY_RADIUS_FACTOR = 4;
/** How many away buses the roll lists before pointing at the total. */
export const AWAY_LIST_CAP = 15;

const UNKNOWN_HOME_LABEL = 'Home depot not known';
const RULE_TEXT = YARD_RULE_SENTENCE;

export interface StateGroup<T> {
  readonly state: BusOpState;
  readonly buses: readonly T[];
}

export interface VisitorGroup {
  readonly homeDepotId: string | null;
  readonly homeDepotName: string;
  readonly buses: readonly VisitorBus[];
}

export interface YardMapPoint {
  readonly registration: string;
  readonly lat: number;
  readonly lng: number;
  readonly state: BusOpState;
  readonly relation: 'home' | 'visiting';
  readonly distanceM: number;
}

export interface YardCounts {
  readonly inYard: number;
  readonly visitors: number;
  readonly away: number;
  readonly unknown: number;
}

export interface YardModel {
  readonly established: boolean;
  readonly yard: Yard | null;
  /** One sentence: the basis of the yard, or that none could be established. */
  readonly basis: string;
  /** Plain-words rule; set only when no yard was established. */
  readonly rule: string | null;
  /** Parked buses (not moving) with a position; the sample a yard would rest on. */
  readonly parkedWithPosition: number;
  readonly counts: YardCounts;
  readonly inYardGroups: readonly StateGroup<DepotBusView>[];
  /** Every bus by state, used when no yard splits them into in-yard and away. */
  readonly allGroups: readonly StateGroup<DepotBusView>[];
  readonly visitorGroups: readonly VisitorGroup[];
  readonly away: { readonly buses: readonly DepotBusView[]; readonly total: number };
  readonly unknown: readonly DepotBusView[];
  readonly points: readonly YardMapPoint[];
  /**
   * Positioned buses further than the display distance, not drawn: this depot's own
   * (listed under Away from the yard) and visitors (listed under Visitors).
   */
  readonly beyondOwn: number;
  readonly beyondVisiting: number;
  /** Visitors drawn as hollow markers, and visitors the feed gave no position for. */
  readonly visitorsDrawn: number;
  readonly visitorsWithoutPosition: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byRegistration(buses: readonly DepotBusView[]): DepotBusView[] {
  return [...buses].sort((a, b) => compareText(a.registrationNumber, b.registrationNumber));
}

function groupByState(buses: readonly DepotBusView[]): StateGroup<DepotBusView>[] {
  return YARD_STATE_ORDER.map((state) => ({
    state,
    buses: byRegistration(buses.filter((bus) => bus.state === state)),
  })).filter((group) => group.buses.length > 0);
}

function groupVisitors(visitors: readonly VisitorBus[]): VisitorGroup[] {
  const byHome = new Map<string, VisitorBus[]>();
  for (const visitor of visitors) {
    const key = visitor.homeDepotName ?? '';
    byHome.set(key, [...(byHome.get(key) ?? []), visitor]);
  }
  return [...byHome.entries()]
    .map(([name, buses]) => ({
      homeDepotId: buses[0]?.homeDepotId ?? null,
      homeDepotName: name === '' ? UNKNOWN_HOME_LABEL : name,
      buses: [...buses].sort((a, b) => compareText(a.registrationNumber, b.registrationNumber)),
    }))
    .sort(
      (a, b) =>
        Number(a.homeDepotName === UNKNOWN_HOME_LABEL) -
          Number(b.homeDepotName === UNKNOWN_HOME_LABEL) ||
        compareText(a.homeDepotName, b.homeDepotName),
    );
}

function awayOrder(a: DepotBusView, b: DepotBusView): number {
  const da = a.distanceFromYardKm ?? Number.POSITIVE_INFINITY;
  const db = b.distanceFromYardKm ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da < db ? -1 : 1;
  return compareText(a.registrationNumber, b.registrationNumber);
}

function basisSentence(yard: Yard | null, coverage: { n: number; of: number } | undefined): string {
  if (!yard) return 'A yard could not be established for this depot.';
  const sample = coverage ?? { n: yard.inCluster, of: yard.parked };
  return `Learned from where this depot's buses park: ${sample.n} of ${sample.of} parked buses stand together.`;
}

/** "heard 4 min ago", worded like the roster; plain when there is no usable GPS age. */
export function formatHeardAgo(ageMin: number | null): string {
  if (ageMin === null || !Number.isFinite(ageMin) || ageMin < 0) return 'no GPS time';
  return `heard ${lastHeardText(ageMin)}`;
}

interface Candidate {
  readonly registration: string;
  readonly lat: number;
  readonly lng: number;
  readonly state: BusOpState;
  readonly relation: YardMapPoint['relation'];
}

function candidatesOf(data: DepotDetailResponse): Candidate[] {
  const own: Candidate[] = data.buses.filter(isUsablePosition).map((bus) => ({
    registration: bus.registrationNumber,
    lat: bus.latitude,
    lng: bus.longitude,
    state: bus.state,
    relation: 'home',
  }));
  const visiting: Candidate[] = data.visitors.flatMap((visitor) => {
    const at = visitor.position;
    if (!at || !isUsablePosition({ latitude: at.lat, longitude: at.lng })) return [];
    const candidate: Candidate = {
      registration: visitor.registrationNumber,
      lat: at.lat,
      lng: at.lng,
      state: visitor.state,
      relation: 'visiting',
    };
    return [candidate];
  });
  return [...own, ...visiting];
}

/**
 * Everything the yard page shows, derived from one depot response. Pure. "Has a position"
 * is the server's rule (`isUsablePosition`), so (0, 0) fixes are never drawn or counted.
 */
export function buildYardModel(data: DepotDetailResponse): YardModel {
  const yard = data.yard.value;
  const parkedWithPosition = data.buses.filter(
    (bus) => isUsablePosition(bus) && bus.speedKmph !== null && bus.speedKmph <= MOVING_SPEED_KMPH,
  ).length;

  const inYard = data.buses.filter((bus) => bus.location === 'in_yard');
  const away = data.buses
    .filter((bus) => bus.location === 'away' || bus.location === 'at_other_yard')
    .sort(awayOrder);
  const unknown = byRegistration(data.buses.filter((bus) => bus.location === 'unknown'));

  const limitM = yard ? yard.radiusM * DISPLAY_RADIUS_FACTOR : 0;
  const measured = yard
    ? candidatesOf(data).map((candidate) => ({
        candidate,
        metres: distanceM(yard.lat, yard.lng, candidate.lat, candidate.lng),
      }))
    : [];
  const points: YardMapPoint[] = measured
    .filter(({ metres }) => Number.isFinite(metres) && metres <= limitM)
    .map(({ candidate, metres }) => ({ ...candidate, distanceM: metres }))
    .sort((a, b) => compareText(a.registration, b.registration));

  return {
    established: yard !== null,
    yard,
    basis: basisSentence(yard, data.yard.coverage),
    rule: yard ? null : RULE_TEXT,
    parkedWithPosition,
    counts: {
      inYard: inYard.length,
      visitors: data.visitors.length,
      away: away.length,
      unknown: unknown.length,
    },
    inYardGroups: groupByState(inYard),
    allGroups: groupByState(data.buses),
    visitorGroups: groupVisitors(data.visitors),
    away: { buses: away.slice(0, AWAY_LIST_CAP), total: away.length },
    unknown,
    points,
    beyondOwn: measured.filter(({ candidate }) => candidate.relation === 'home').length -
      points.filter((point) => point.relation === 'home').length,
    beyondVisiting: measured.filter(({ candidate }) => candidate.relation === 'visiting').length -
      points.filter((point) => point.relation === 'visiting').length,
    visitorsDrawn: points.filter((point) => point.relation === 'visiting').length,
    visitorsWithoutPosition: data.visitors.filter((visitor) => visitor.position === null).length,
  };
}

/**
 * The map note's tail, after "N buses drawn". Own buses beyond the range are in the
 * Away list; visitors beyond it are in the Visitors list, so each is worded alone.
 */
export function beyondRangeSentence(
  counts: Pick<YardModel, 'beyondOwn' | 'beyondVisiting'>,
): string {
  const { beyondOwn: own, beyondVisiting: visiting } = counts;
  if (own === 0 && visiting === 0) return 'every bus with a position is drawn.';
  const parts: string[] = [];
  if (own > 0) {
    parts.push(
      `${formatCount(own)} more of this depot's buses with a position ${own === 1 ? 'lies' : 'lie'} beyond the map's range and ${own === 1 ? 'is' : 'are'} not shown, see Away from the yard below`,
    );
  }
  if (visiting > 0) {
    parts.push(
      `${formatCount(visiting)} visiting ${visiting === 1 ? 'bus' : 'buses'} with a position ${visiting === 1 ? 'lies' : 'lie'} beyond the map's range and ${visiting === 1 ? 'is' : 'are'} not shown, ${visiting === 1 ? 'it is' : 'they are'} listed under Visitors`,
    );
  }
  return `${parts.join('; ')}.`;
}
