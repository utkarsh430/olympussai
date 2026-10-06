import { formatCount } from '@/lib/depot/format';
import { DEPOTS_ROOT } from '@/lib/depot/nav';
import { exceptionRows, type ExceptionKindRow } from './overviewModel';
import type {
  BusExceptionKind,
  DepotExceptionKind,
  ExceptionKind,
  ExceptionSeverity,
} from '@/lib/depot/exceptions/types';

/**
 * Exception totals that always name their scope: depot exceptions and bus
 * exceptions are different things, so a bare "2,041 in all" is never shown.
 *
 * Built only from the network response's uncapped counts. Each bus kind has one
 * fixed severity (`exceptions/busExceptions.ts`), so the bus split by severity
 * is exact from the counts by kind; the depot split is what remains of the
 * server's severity totals (depot exceptions are only critical or warning).
 */

const DEPOT_KINDS: ReadonlySet<ExceptionKind> = new Set<DepotExceptionKind>([
  'dark_share_high',
  'off_road_high',
  'on_road_low',
  'power_cut_cluster',
]);

const BUS_KIND_SEVERITY: Readonly<Record<BusExceptionKind, ExceptionSeverity>> = {
  emergency: 'critical',
  long_dark: 'warning',
  power_cut: 'info',
  tamper_code: 'info',
};

export interface ExceptionScope {
  readonly depot: { readonly total: number; readonly critical: number; readonly warning: number };
  readonly bus: {
    readonly total: number;
    readonly critical: number;
    readonly warning: number;
    readonly info: number;
  };
}

function whole(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export function exceptionScope(
  counts: Readonly<Record<ExceptionKind, number>>,
  severities: Readonly<Record<ExceptionSeverity, number>>,
): ExceptionScope {
  const bus = { critical: 0, warning: 0, info: 0 };
  (Object.keys(BUS_KIND_SEVERITY) as BusExceptionKind[]).forEach((kind) => {
    bus[BUS_KIND_SEVERITY[kind]] += whole(counts[kind]);
  });
  const depotTotal = [...DEPOT_KINDS].reduce((sum, kind) => sum + whole(counts[kind]), 0);
  const depotCritical = Math.min(
    depotTotal,
    Math.max(0, whole(severities.critical) - bus.critical),
  );
  return {
    depot: { total: depotTotal, critical: depotCritical, warning: depotTotal - depotCritical },
    bus: { total: bus.critical + bus.warning + bus.info, ...bus },
  };
}

function scopeLine(noun: string, total: number, parts: readonly string[]): string {
  if (total === 0) return `No ${noun} exceptions`;
  const word = total === 1 ? 'exception' : 'exceptions';
  return `${formatCount(total)} ${noun} ${word} (${parts.join(', ')})`;
}

/** "73 depot exceptions (4 critical, 69 warning)". */
export function depotScopeLine(scope: ExceptionScope): string {
  const { total, critical, warning } = scope.depot;
  return scopeLine('depot', total, [
    `${formatCount(critical)} critical`,
    `${formatCount(warning)} warning`,
  ]);
}

/** "1,968 bus exceptions (43 critical, 698 warning, 1,227 info)". */
export function busScopeLine(scope: ExceptionScope): string {
  const { total, critical, warning, info } = scope.bus;
  return scopeLine('bus', total, [
    `${formatCount(critical)} critical`,
    `${formatCount(warning)} warning`,
    `${formatCount(info)} info`,
  ]);
}

export interface ExceptionGroups {
  readonly depot: readonly ExceptionKindRow[];
  readonly bus: readonly ExceptionKindRow[];
}

/** The kinds split by scope, each in the overview's fixed order. */
export function exceptionGroups(counts: Readonly<Record<ExceptionKind, number>>): ExceptionGroups {
  const rows = exceptionRows(counts);
  return {
    depot: rows.filter((row) => DEPOT_KINDS.has(row.kind)),
    bus: rows.filter((row) => !DEPOT_KINDS.has(row.kind)),
  };
}

/** The exceptions page, filtered to one kind. */
export function exceptionKindHref(kind: ExceptionKind): string {
  return `${DEPOTS_ROOT}/exceptions?kind=${encodeURIComponent(kind)}`;
}
