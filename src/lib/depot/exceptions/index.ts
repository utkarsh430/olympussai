import type { DepotBusRow } from '@/models/depotLive';
import type { BusOpState, DepotSummary } from '../types';
import type { DepotScore } from '../score/types';
import { BUS_EXCEPTION_CAP, EXCEPTION_KINDS } from './config';
import { detectBusExceptions } from './busExceptions';
import { detectDepotExceptions } from './depotExceptions';
import type {
  BusException,
  DepotException,
  ExceptionKind,
  ExceptionReport,
  ExceptionSeverity,
} from './types';

export {
  BUS_EXCEPTION_CAP,
  CRITICAL_Z,
  EXCEPTION_Z,
  MIN_RATE_GAP,
  POWER_CUT_CLUSTER_MIN,
  POWER_CUT_CLUSTER_SHARE,
} from './config';
export { detectBusExceptions } from './busExceptions';
export { detectDepotExceptions } from './depotExceptions';

/**
 * Depot and bus exceptions together, by severity, from the full (uncapped)
 * lists. Counts by kind cannot give this: a depot-rate kind can be critical
 * or warning.
 */
export function countBySeverity(
  depot: readonly DepotException[],
  bus: readonly BusException[],
): Record<ExceptionSeverity, number> {
  const counts: Record<ExceptionSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const e of depot) counts[e.severity] += 1;
  for (const e of bus) counts[e.severity] += 1;
  return counts;
}

/**
 * The network report from already-detected, already-sorted lists. Counts and
 * `busTotal` are taken from the full lists before the bus list is capped, so a
 * capped screen still states the true size of the problem.
 */
export function assembleReport(
  depot: readonly DepotException[],
  bus: readonly BusException[],
): ExceptionReport {
  const counts = Object.fromEntries(EXCEPTION_KINDS.map((k) => [k, 0])) as Record<
    ExceptionKind,
    number
  >;
  for (const e of depot) counts[e.kind] += 1;
  for (const e of bus) counts[e.kind] += 1;
  return {
    depot: [...depot],
    bus: bus.slice(0, BUS_EXCEPTION_CAP),
    busTotal: bus.length,
    counts,
  };
}

/**
 * Everything that needs attention on one snapshot. Pure: the caller supplies
 * `stateOf` so the per-snapshot state classification is done once, elsewhere.
 */
export function buildExceptionReport(
  rows: readonly DepotBusRow[],
  depots: readonly DepotSummary[],
  scores: readonly DepotScore[],
  feedNow: string | null,
  stateOf: (row: DepotBusRow) => BusOpState,
): ExceptionReport {
  return assembleReport(
    detectDepotExceptions(depots, scores, rows, stateOf),
    detectBusExceptions(rows, depots, feedNow, stateOf),
  );
}
