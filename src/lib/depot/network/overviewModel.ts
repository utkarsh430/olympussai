import { EXCEPTION_KIND_LABEL, RANK_REASON_LABEL } from '@/lib/depot/labels';
import type { DepotSummary } from '@/lib/depot/types';
import type { DepotScore } from '@/lib/depot/score/types';
import type { ExceptionKind, ExceptionSeverity } from '@/lib/depot/exceptions/types';

/**
 * Pure shaping for the network overview: everything the page needs from a
 * `DepotNetworkResponse` that is worth testing on its own.
 */

export interface DepotRow {
  readonly depot: DepotSummary;
  readonly score: DepotScore | null;
}

/** One row per depot, in the depot list's order, with its score when there is one. */
export function joinScores(
  depots: readonly DepotSummary[],
  scores: readonly DepotScore[],
): DepotRow[] {
  const byId = new Map(scores.map((entry) => [entry.depotId, entry]));
  return depots.map((depot) => ({ depot, score: byId.get(depot.id) ?? null }));
}

/** A row's index when it is genuinely ranked; null otherwise. */
export function rankedIndex(row: DepotRow): number | null {
  const index = row.score?.index ?? null;
  if (!row.score?.ranked || index === null || !Number.isFinite(index)) return null;
  return index;
}

/** The index to one decimal, or a dash when there is none. */
export function formatIndex(index: number | null): string {
  return index === null || !Number.isFinite(index) ? '—' : index.toFixed(1);
}

/** Why a row has no index, in words. */
export function unrankedReason(row: DepotRow): string {
  return row.score ? RANK_REASON_LABEL[row.score.reason] : 'No score for this depot';
}

/** One line for the screen-reader status when the selection changes. */
export function selectionStatus(row: DepotRow | null): string {
  if (!row) return '';
  const index = rankedIndex(row);
  const detail =
    index === null ? `not ranked: ${unrankedReason(row)}` : `index ${formatIndex(index)}`;
  return `Selected ${row.depot.name}, ${detail}`;
}

export const RANKED_STRIP_SIZE = 5;

export interface RankedExtremes {
  /** Highest index first. */
  readonly top: readonly DepotRow[];
  /** Lowest index first. Never repeats a depot already in `top`. */
  readonly bottom: readonly DepotRow[];
}

function byIndexThenId(direction: 1 | -1) {
  return (left: DepotRow, right: DepotRow): number => {
    const gap = ((rankedIndex(left) ?? 0) - (rankedIndex(right) ?? 0)) * direction;
    if (gap !== 0) return gap;
    return left.depot.id < right.depot.id ? -1 : left.depot.id > right.depot.id ? 1 : 0;
  };
}

/** The best and worst ranked depots by index; ties go to the smaller id. */
export function rankedExtremes(
  rows: readonly DepotRow[],
  size: number = RANKED_STRIP_SIZE,
): RankedExtremes {
  const ranked = rows.filter((row) => rankedIndex(row) !== null);
  const top = [...ranked].sort(byIndexThenId(-1)).slice(0, size);
  const shown = new Set(top.map((row) => row.depot.id));
  const bottom = ranked
    .filter((row) => !shown.has(row.depot.id))
    .sort(byIndexThenId(1))
    .slice(0, size);
  return { top, bottom };
}

export interface UnrankedSummary {
  readonly total: number;
  readonly fleetTooSmall: number;
  readonly notADepot: number;
  /** Depots the score list does not mention at all. */
  readonly unscored: number;
}

export function unrankedSummary(rows: readonly DepotRow[]): UnrankedSummary {
  const unranked = rows.filter((row) => rankedIndex(row) === null);
  const count = (test: (row: DepotRow) => boolean): number => unranked.filter(test).length;
  return {
    total: unranked.length,
    fleetTooSmall: count((row) => row.score?.reason === 'fleet_too_small'),
    notADepot: count((row) => row.score?.reason === 'not_a_depot'),
    unscored: count((row) => row.score === null),
  };
}

/** Depots with no positioned bus, so no node on the map. */
export function unpositionedCount(depots: readonly DepotSummary[]): number {
  return depots.filter((depot) => depot.centroid === null).length;
}

/**
 * Severity per exception kind, as the exception rules assign it. The three
 * depot-rate kinds are `critical` or `warning` depending on how far the depot
 * sits from its peers, which a count by kind cannot tell apart: `variable` (worded "Critical or warning").
 */
export type KindSeverity = ExceptionSeverity | 'variable';

const KIND_SEVERITY: ReadonlyArray<{
  readonly kind: ExceptionKind;
  readonly severity: KindSeverity;
}> = [
  { kind: 'emergency', severity: 'critical' },
  { kind: 'dark_share_high', severity: 'variable' },
  { kind: 'off_road_high', severity: 'variable' },
  { kind: 'on_road_low', severity: 'variable' },
  { kind: 'power_cut_cluster', severity: 'warning' },
  { kind: 'long_dark', severity: 'warning' },
  { kind: 'power_cut', severity: 'info' },
  { kind: 'tamper_code', severity: 'info' },
];

export interface ExceptionKindRow {
  readonly kind: ExceptionKind;
  readonly label: string;
  readonly severity: KindSeverity;
  readonly count: number;
}

function safeCount(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export function exceptionRows(counts: Readonly<Record<ExceptionKind, number>>): ExceptionKindRow[] {
  return KIND_SEVERITY.map((entry) => ({
    ...entry,
    label: EXCEPTION_KIND_LABEL[entry.kind],
    count: safeCount(counts[entry.kind]),
  }));
}
