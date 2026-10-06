import type { DepotBusRow } from '@/models/depotLive';
import type { BusOpState, StateMix } from '@/lib/depot/types';
import { median } from '@/lib/depot/infer/geo';
import { isScheduledForFeedDate, MAX_PLAUSIBLE_DELAY_MIN } from '@/lib/depot/infer/outshed';
import { ROUTE_TOKEN_CLASS, SERVICE_CLASS_PRIORITY } from '@/lib/depot/sim/config';
import type { RouteDelay, RouteOperator, RouteRow } from './routeTableTypes';

export type { RouteDelay, RouteOperator, RouteRow } from './routeTableTypes';

/** A bus running more than this many minutes behind schedule counts as late. */
export const LATE_AFTER_MIN = 10;

const MEDIAN_DECIMALS = 10;
const SHARE_DECIMALS = 10_000;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The class token that decides the route's class: of several, the most specific
 * by SERVICE_CLASS_PRIORITY (the rule duties and buses use), the earliest in the
 * name when two tokens share a class.
 */
function serviceTokenOf(routeName: string): string | null {
  let best: { token: string; rank: number } | null = null;
  for (const token of routeName.split('_')) {
    const upper = token.toUpperCase();
    const serviceClass = ROUTE_TOKEN_CLASS[upper];
    if (serviceClass === undefined) continue;
    const rank = SERVICE_CLASS_PRIORITY.indexOf(serviceClass);
    if (best === null || rank < best.rank) best = { token: upper, rank };
  }
  return best === null ? null : best.token;
}

function directionOf(routeName: string): 'IN' | 'OUT' | null {
  const last = routeName.split('_').pop()?.toUpperCase();
  return last === 'IN' || last === 'OUT' ? last : null;
}

/** Smallest non-null value: stable whatever order the feed arrived in. */
function firstSorted(values: readonly (string | null)[]): string | null {
  const present = values.filter((v): v is string => v !== null && v !== '');
  return present.length === 0 ? null : present.reduce((a, b) => (compare(a, b) <= 0 ? a : b));
}

function operatorsOf(rows: readonly DepotBusRow[]): RouteOperator[] {
  const byDepot = new Map<string, DepotBusRow[]>();
  for (const row of rows) {
    if (row.depotId === null) continue;
    byDepot.set(row.depotId, [...(byDepot.get(row.depotId) ?? []), row]);
  }
  return [...byDepot.entries()]
    .map(([depotId, members]) => {
      const names = new Map<string, number>();
      for (const m of members) {
        if (m.depotName) names.set(m.depotName, (names.get(m.depotName) ?? 0) + 1);
      }
      const depotName =
        [...names.entries()].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))[0]?.[0] ?? '';
      return { depotId, depotName, buses: members.length };
    })
    .sort((a, b) => b.buses - a.buses || compare(a.depotId, b.depotId));
}

function stateMix(rows: readonly DepotBusRow[], stateOf: (r: DepotBusRow) => BusOpState): StateMix {
  const counts: Record<BusOpState, number> = {
    in_service: 0,
    on_road: 0,
    standing: 0,
    dark: 0,
    off_road: 0,
  };
  for (const row of rows) counts[stateOf(row)] += 1;
  return {
    inService: counts.in_service,
    onRoad: counts.on_road,
    standing: counts.standing,
    dark: counts.dark,
    offRoad: counts.off_road,
  };
}

function delayOf(rows: readonly DepotBusRow[], feedNow: string | null): RouteDelay {
  const delays: number[] = [];
  for (const row of rows) {
    const d = row.delayMinutes;
    if (!isScheduledForFeedDate(row, feedNow)) continue;
    if (d === null || !Number.isFinite(d) || Math.abs(d) > MAX_PLAUSIBLE_DELAY_MIN) continue;
    delays.push(d);
  }
  const coverage = { n: delays.length, of: rows.length };
  if (delays.length === 0) return { medianMin: null, lateShare: null, coverage };
  const late = delays.filter((d) => d > LATE_AFTER_MIN).length;
  return {
    medianMin: Math.round(median(delays) * MEDIAN_DECIMALS) / MEDIAN_DECIMALS,
    lateShare: Math.round((late / delays.length) * SHARE_DECIMALS) / SHARE_DECIMALS,
    coverage,
  };
}

function rowOf(
  routeName: string,
  rows: readonly DepotBusRow[],
  stateOf: (r: DepotBusRow) => BusOpState,
  feedNow: string | null,
): RouteRow {
  const operators = operatorsOf(rows);
  const primary =
    operators.length > 0 && (operators.length === 1 || operators[0]!.buses > operators[1]!.buses)
      ? operators[0]!.depotId
      : null;
  return {
    routeName,
    routeId: firstSorted(rows.map((r) => r.routeId)),
    description: firstSorted(rows.map((r) => r.routeDescription)),
    serviceToken: serviceTokenOf(routeName),
    direction: directionOf(routeName),
    buses: rows.length,
    operators,
    primaryDepotId: primary,
    states: stateMix(rows, stateOf),
    delay: delayOf(rows, feedNow),
  };
}

/**
 * One row per route name in the live snapshot. Order of the input never
 * changes the output: ties are broken by name and id, never by arrival.
 */
export function buildRouteTable(
  rows: readonly DepotBusRow[],
  stateOf: (row: DepotBusRow) => BusOpState,
  feedNow: string | null,
): RouteRow[] {
  const groups = new Map<string, DepotBusRow[]>();
  for (const row of rows) {
    const name = row.routeName;
    if (name === null || name.trim() === '') continue;
    groups.set(name, [...(groups.get(name) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([name, members]) => rowOf(name, members, stateOf, feedNow))
    .sort((a, b) => b.buses - a.buses || compare(a.routeName, b.routeName));
}
