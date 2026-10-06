import { formatShare } from '@/lib/depot/format';
import { EXCEPTION_KIND_LABEL } from '@/lib/depot/labels';
import type { DepotSummary, Figure, NetworkKpis } from '@/lib/depot/types';
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

export interface KpiRow {
  readonly key: keyof NetworkKpis;
  readonly label: string;
  readonly figure: Figure;
  /** Share of the fleet for a bus count; null for fleet itself and for depots. */
  readonly share: string | null;
}

const KPI_ORDER: ReadonlyArray<{ readonly key: keyof NetworkKpis; readonly label: string }> = [
  { key: 'fleet', label: 'Fleet' },
  { key: 'depots', label: 'Depots' },
  { key: 'reporting', label: 'Reporting' },
  { key: 'onRoad', label: 'On road' },
  { key: 'stationary', label: 'Stationary' },
  { key: 'noSignal', label: 'No signal' },
  { key: 'underMaintenance', label: 'Under maintenance' },
  { key: 'assigned', label: 'Route assigned' },
];

const NOT_BUS_COUNTS: ReadonlySet<keyof NetworkKpis> = new Set(['fleet', 'depots']);

export function kpiRows(kpis: NetworkKpis): KpiRow[] {
  const fleet = kpis.fleet.value;
  return KPI_ORDER.map(({ key, label }) => ({
    key,
    label,
    figure: kpis[key],
    share: NOT_BUS_COUNTS.has(key) ? null : formatShare(kpis[key].value, fleet),
  }));
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

export type SeverityTotals = Readonly<Record<ExceptionSeverity | 'total', number>>;

/** Totals by severity, from the server's own severity counts (exact, unlike counts by kind). */
export function severityTotals(
  severities: Readonly<Record<ExceptionSeverity, number>>,
): SeverityTotals {
  const critical = safeCount(severities.critical);
  const warning = safeCount(severities.warning);
  const info = safeCount(severities.info);
  return { critical, warning, info, total: critical + warning + info };
}
