import { formatCount } from '../format';
import { UNASSIGNED_DEPOT_ID } from '../types';
import {
  EXCLUSION_ORDER,
  UNCHANGED_ORDER,
  exclusionText,
  formatKm,
  moveNote,
  toTenths,
  unchangedReasonText,
} from './allocationWording';
import type {
  AllocationExcludedRoute,
  AllocationMoveItem,
  AllocationParams,
  AllocationUnchangedItem,
  RouteListItem,
} from './api';

/**
 * Rows for the recommended moves and the groups of routes the plan leaves
 * where they are. Routes without a profile are not grouped here: the page
 * gives them their own section, because the cure (opening them) differs.
 */

function isRealDepot(depotId: string | null): depotId is string {
  return depotId !== null && depotId !== UNASSIGNED_DEPOT_ID;
}

export interface MoveRow {
  readonly routeName: string;
  readonly fromDepotId: string;
  readonly fromDepotName: string;
  readonly fromLinked: boolean;
  readonly toDepotId: string;
  readonly toDepotName: string;
  readonly toLinked: boolean;
  /** MODELLED. */
  readonly trips: string;
  /** DERIVED, kilometres a trip. */
  readonly deadNow: string;
  readonly deadAfter: string;
  /** MODELLED, kilometres a day. */
  readonly saving: string;
  readonly note: string | null;
}

/** Largest saving first (compared in tenths), then route name. */
export function moveRows(moves: readonly AllocationMoveItem[]): MoveRow[] {
  return [...moves]
    .sort(
      (a, b) =>
        toTenths(b.savedKmPerDay) - toTenths(a.savedKmPerDay) ||
        a.routeName.localeCompare(b.routeName, 'en'),
    )
    .map((m) => ({
      routeName: m.routeName,
      fromDepotId: m.fromDepotId,
      fromDepotName: m.fromDepotName,
      fromLinked: isRealDepot(m.fromDepotId),
      toDepotId: m.toDepotId,
      toDepotName: m.toDepotName,
      toLinked: isRealDepot(m.toDepotId),
      trips: formatCount(m.tripsPerDay),
      deadNow: formatKm(m.fromDeadKmPerTrip),
      deadAfter: formatKm(m.toDeadKmPerTrip),
      saving: formatKm(m.savedKmPerDay),
      note: moveNote(m),
    }));
}

export interface UnmovedItem {
  readonly routeName: string;
  readonly depotId: string | null;
  readonly depotName: string | null;
  readonly linked: boolean;
  /** MODELLED; null for a route outside the plan. */
  readonly trips: string | null;
  /** DERIVED; null for a route outside the plan. */
  readonly deadKmPerTrip: string | null;
}

export interface UnmovedGroup {
  readonly key: string;
  /** Stays in the plan unchanged, or is outside the plan altogether. */
  readonly kind: 'stay' | 'outside';
  readonly heading: string;
  readonly countLabel: string;
  readonly items: readonly UnmovedItem[];
}

function countLabel(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'route' : 'routes'}`;
}

function stayItem(u: AllocationUnchangedItem): UnmovedItem {
  return {
    routeName: u.routeName,
    depotId: u.depotId,
    depotName: u.depotName,
    linked: isRealDepot(u.depotId),
    trips: formatCount(u.tripsPerDay),
    deadKmPerTrip: formatKm(u.deadKmPerTrip),
  };
}

function outsideItem(e: AllocationExcludedRoute, names: ReadonlyMap<string, string>): UnmovedItem {
  const id = e.primaryDepotId;
  return {
    routeName: e.routeName,
    depotId: id,
    depotName: id === null ? null : (names.get(id) ?? `Depot ${id}`),
    linked: isRealDepot(id),
    trips: null,
    deadKmPerTrip: null,
  };
}

/** Non-empty groups only: stays in precedence order, then exclusions in theirs. */
export function unmovedGroups(
  unchanged: readonly AllocationUnchangedItem[],
  excluded: readonly AllocationExcludedRoute[],
  params: Pick<AllocationParams, 'minSavingKmPerDay' | 'maxMoves'>,
  names: ReadonlyMap<string, string>,
): UnmovedGroup[] {
  const stays = UNCHANGED_ORDER.map((reason): UnmovedGroup => {
    const items = unchanged.filter((u) => u.reason === reason).map(stayItem);
    return {
      key: reason,
      kind: 'stay',
      heading: unchangedReasonText(reason, params),
      countLabel: countLabel(items.length),
      items,
    };
  });
  const outside = EXCLUSION_ORDER.filter((reason) => reason !== 'not_profiled').map(
    (reason): UnmovedGroup => {
      const items = excluded.filter((e) => e.reason === reason).map((e) => outsideItem(e, names));
      return {
        key: reason,
        kind: 'outside',
        heading: exclusionText(reason),
        countLabel: countLabel(items.length),
        items,
      };
    },
  );
  return [...stays, ...outside].filter((group) => group.items.length > 0);
}

/** Depot id to name, from the operators the route table lists. */
export function depotNameMap(routes: readonly RouteListItem[]): ReadonlyMap<string, string> {
  return new Map(routes.flatMap((r) => r.operators.map((o) => [o.depotId, o.depotName] as const)));
}
