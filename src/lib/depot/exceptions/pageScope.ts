import type { DepotExceptionsResponse } from '../api';
import { formatCount } from '../format';
import { EXCEPTION_KIND_LABEL, SEVERITY_LABEL } from '../labels';
import { BUS_EXCEPTION_KINDS } from './busPage';
import type {
  BusExceptionKind,
  DepotException,
  DepotExceptionKind,
  ExceptionKind,
  ExceptionSeverity,
} from './types';

/**
 * What the exceptions page is about. With `?depot=` the WHOLE page is that depot's: the
 * bands count it (the response's `depotScope`), the depot list is its own, and the totals
 * line names its bus total. With `?kind=` as well, the depot section's count is the
 * filtered list's (R2-m22, R2-m23). Pure; the page renders what this returns.
 */
export interface ExceptionPageScope {
  /** The depot the page is about ("KAUSHAMBI", or "Depot 77" for an id the snapshot lacks); null for the network. */
  readonly depotName: string | null;
  /** The depot exceptions in scope, before the kind filter. */
  readonly depotList: readonly DepotException[];
  /** Per kind; null while a depot's own bus counts have not arrived (never the network's). */
  readonly counts: Readonly<Record<ExceptionKind, number | null>>;
  /** Depot exceptions in scope after the kind filter: the depot section's count. */
  readonly depotCount: number;
  readonly busTotal: number | null;
  /** Bus exceptions by severity; known for the network only. */
  readonly busSeverity: Readonly<Record<ExceptionSeverity, number>> | null;
}

type ScopeInput = Pick<DepotExceptionsResponse, 'report' | 'busSeverityCounts' | 'depotScope'>;

const DEPOT_KINDS: readonly DepotExceptionKind[] = [
  'dark_share_high',
  'off_road_high',
  'on_road_low',
  'power_cut_cluster',
];

function depotKindCounts(list: readonly DepotException[]): Record<DepotExceptionKind, number> {
  return Object.fromEntries(
    DEPOT_KINDS.map((kind) => [kind, list.filter((e) => e.kind === kind).length]),
  ) as Record<DepotExceptionKind, number>;
}

function busCountsOf(
  counts: Readonly<Partial<Record<BusExceptionKind, number>>> | null,
): Record<BusExceptionKind, number | null> {
  return Object.fromEntries(
    BUS_EXCEPTION_KINDS.map((kind) => [kind, counts === null ? null : (counts[kind] ?? 0)]),
  ) as Record<BusExceptionKind, number | null>;
}

export function exceptionPageScope(
  response: ScopeInput,
  depotId: string | null,
  depotKind: DepotExceptionKind | null,
): ExceptionPageScope {
  const { report } = response;
  const countIn = (list: readonly DepotException[]): number =>
    depotKind === null ? list.length : list.filter((e) => e.kind === depotKind).length;
  if (depotId === null) {
    return {
      depotName: null,
      depotList: report.depot,
      counts: report.counts,
      depotCount: countIn(report.depot),
      busTotal: report.busTotal,
      busSeverity: response.busSeverityCounts,
    };
  }
  const scope = response.depotScope?.depotId === depotId ? response.depotScope : null;
  // A previous answer kept on screen while the depot's own arrives: its depot list can be
  // narrowed, but its bus counts are the network's and must not stand for the depot.
  const depotList = scope ? scope.depot : report.depot.filter((e) => e.depotId === depotId);
  const fromRows = depotList[0]?.depotName ?? null;
  return {
    depotName: scope?.depotName ?? fromRows ?? `Depot ${depotId}`,
    depotList,
    counts: { ...depotKindCounts(depotList), ...busCountsOf(scope ? scope.busCounts : null) },
    depotCount: countIn(depotList),
    busTotal: scope ? scope.busTotal : null,
    busSeverity: null,
  };
}

/** A bus kind's group row: "EMERGENCY FLAG · 46 · CRITICAL" (the kind's total, its severity once). */
export function busGroupLabel(
  kind: BusExceptionKind,
  total: number,
  severity: ExceptionSeverity,
): string {
  return [EXCEPTION_KIND_LABEL[kind], formatCount(total), SEVERITY_LABEL[severity]]
    .join(' · ')
    .toUpperCase();
}
