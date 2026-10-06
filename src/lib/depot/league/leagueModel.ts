import { DEI_COMPONENTS, MIN_FLEET_FOR_RANK } from '@/lib/depot/score/config';
import { strongestAndWeakest } from '@/lib/depot/score/explain';
import type { DeiComponentKey, DepotScore, PeerGroupId } from '@/lib/depot/score/types';
import { RANK_REASON_LABEL } from '@/lib/depot/labels';
import type { DepotKind, DepotSummary } from '@/lib/depot/types';

/** One component of one depot's index, ready to display. */
export interface ComponentCell {
  readonly key: DeiComponentKey;
  readonly label: string;
  readonly weight: number;
  readonly higherIsBetter: boolean;
  /** The depot's own rate, 0 to 1. */
  readonly value: number | null;
  readonly peerMedian: number | null;
  /** value minus peer median, in percentage points; null when either is unknown. */
  readonly deltaPoints: number | null;
  readonly z: number | null;
  readonly contribution: number;
}

export interface LeagueRow {
  readonly depotId: string;
  readonly name: string;
  readonly kind: DepotKind;
  readonly fleet: number;
  readonly peerGroup: PeerGroupId | null;
  readonly ranked: boolean;
  readonly rank: number | null;
  readonly index: number | null;
  readonly peerCount: number | null;
  readonly components: readonly ComponentCell[];
  readonly score: DepotScore | null;
  /** Snapshots this depot was scored on; fewer than the window's marks it new. */
  readonly samples?: number;
}

export type PeerGroupFilter = PeerGroupId | 'any';

export interface LeagueFilters {
  readonly peerGroup: PeerGroupFilter;
  readonly search: string;
  readonly showUnranked: boolean;
}

export const DEFAULT_LEAGUE_FILTERS: LeagueFilters = {
  peerGroup: 'any',
  search: '',
  showUnranked: false,
};

export { PEER_GROUP_LABEL } from '@/lib/depot/labels';

const PEER_GROUP_ORDER: readonly PeerGroupId[] = ['small', 'medium', 'large', 'all'];
const PERCENT = 100;
const UNRANKED_GROUP_POSITION = PEER_GROUP_ORDER.length;

function toCells(score: DepotScore): ComponentCell[] {
  return score.components.map((component) => {
    const config = DEI_COMPONENTS.find((c) => c.key === component.key);
    const { value, peerMedian } = component;
    return {
      key: component.key,
      label: config?.label ?? component.key,
      weight: config?.weight ?? 0,
      higherIsBetter: config?.higherIsBetter ?? true,
      value,
      peerMedian,
      deltaPoints: value === null || peerMedian === null ? null : (value - peerMedian) * PERCENT,
      z: component.z,
      contribution: component.contribution,
    };
  });
}

function groupPosition(row: LeagueRow): number {
  return row.peerGroup === null ? UNRANKED_GROUP_POSITION : PEER_GROUP_ORDER.indexOf(row.peerGroup);
}

/** Peer group, then rank; unranked depots last, biggest fleet first. */
function compareDefault(a: LeagueRow, b: LeagueRow): number {
  const byGroup = groupPosition(a) - groupPosition(b);
  if (byGroup !== 0) return byGroup;
  if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
  if (a.rank !== null) return -1;
  if (b.rank !== null) return 1;
  return b.fleet - a.fleet || a.name.localeCompare(b.name, 'en');
}

/** Joins depots to their scores. A depot without a score is shown as unranked. */
export function buildLeagueRows(
  depots: readonly DepotSummary[],
  scores: readonly DepotScore[],
): LeagueRow[] {
  const byDepot = new Map(scores.map((score) => [score.depotId, score]));
  return depots
    .map((depot): LeagueRow => {
      const score = byDepot.get(depot.id) ?? null;
      return {
        depotId: depot.id,
        name: depot.name,
        kind: depot.kind,
        fleet: depot.fleet,
        peerGroup: score?.peerGroup ?? null,
        ranked: score?.ranked ?? false,
        rank: score?.rank ?? null,
        index: score?.index ?? null,
        peerCount: score?.peerCount ?? null,
        components: score ? toCells(score) : [],
        score,
        ...(score?.samples === undefined ? {} : { samples: score.samples }),
      };
    })
    .sort(compareDefault);
}

/** Keeps the incoming (default) order. */
export function filterLeagueRows(rows: readonly LeagueRow[], filters: LeagueFilters): LeagueRow[] {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (!filters.showUnranked && !row.ranked) return false;
    if (filters.peerGroup !== 'any' && row.peerGroup !== filters.peerGroup) return false;
    return needle === '' || row.name.toLowerCase().includes(needle);
  });
}

/**
 * The selected depot among the rows the filters show, or null. The selection
 * itself is kept while a filter hides the row, so relaxing the filter reopens
 * its breakdown.
 */
export function selectedRowIn(
  rows: readonly LeagueRow[],
  selectedId: string | null,
): LeagueRow | null {
  if (selectedId === null) return null;
  return rows.find((row) => row.depotId === selectedId) ?? null;
}

/** Peer group is a filter; it earns a column only when every group is listed together. */
export function showsPeerGroupColumn(filters: LeagueFilters): boolean {
  return filters.peerGroup === 'any';
}

const DASH = '—';

/** A 0-to-1 rate as a percentage with one decimal; a dash when unknown. */
export function formatRate(value: number | null): string {
  return value === null ? DASH : `${(value * PERCENT).toFixed(1)}%`;
}

/** A signed difference in percentage points, using a real minus sign. */
export function formatPoints(delta: number | null): string {
  if (delta === null) return DASH;
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return '0.0 pts';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)} pts`;
}

export type DifferenceDirection = 'better' | 'worse' | 'level' | 'unknown';

export interface DifferenceWording {
  readonly text: string;
  readonly direction: DifferenceDirection;
}

const ROUND_TO_TENTH = 10;

/**
 * The one rule for "is this difference good": the sign of the difference as
 * shown (to a tenth), read against whether higher is better. Zero after
 * rounding is level; no peer median is unknown.
 */
export function differenceDirection(
  deltaPoints: number | null,
  higherIsBetter: boolean,
): DifferenceDirection {
  if (deltaPoints === null) return 'unknown';
  const rounded = Math.round(deltaPoints * ROUND_TO_TENTH) / ROUND_TO_TENTH;
  if (rounded === 0) return 'level';
  return rounded > 0 === higherIsBetter ? 'better' : 'worse';
}

/**
 * Says in words whether a difference from the peer median is good or bad. For
 * off-road and dark rates a positive difference is worse, so the sign alone
 * must never be left to carry the meaning.
 */
export function describeDifference(
  deltaPoints: number | null,
  higherIsBetter: boolean,
): DifferenceWording {
  const direction = differenceDirection(deltaPoints, higherIsBetter);
  if (deltaPoints === null) return { text: 'no peer median', direction };
  if (direction === 'level') return { text: 'level with peers', direction };
  const rounded = Math.round(Math.abs(deltaPoints) * ROUND_TO_TENTH) / ROUND_TO_TENTH;
  return { text: `${rounded.toFixed(1)} pts ${direction} than peers`, direction };
}

/** Why a depot has no rank; null for a ranked depot. */
export function unrankedSentence(row: LeagueRow): string | null {
  if (row.ranked) return null;
  if (row.kind !== 'depot') return RANK_REASON_LABEL.not_a_depot;
  return `Needs at least ${MIN_FLEET_FOR_RANK} buses to be ranked; this depot has ${row.fleet}.`;
}

/** One sentence on what moved a depot's index most. */
export function explainRow(row: LeagueRow): string {
  const reason = unrankedSentence(row);
  if (reason !== null) return reason;
  if (row.score === null) return 'No score is available for this depot.';
  const { strongest, weakest } = strongestAndWeakest(row.score);
  if (strongest === null || weakest === null) {
    return 'No single measure stands out; every component contributes equally.';
  }
  const label = (key: DeiComponentKey): string =>
    DEI_COMPONENTS.find((c) => c.key === key)?.label ?? key;
  return `Helped most by ${label(strongest.key)}; held back most by ${label(weakest.key)}.`;
}
