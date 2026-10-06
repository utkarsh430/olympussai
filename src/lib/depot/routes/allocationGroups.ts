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
  AllocationUnchangedItem,
  DepotAllocationResponse,
} from './api';
import type { AllocationListReason } from './routeQuery';

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
  /** The reason, sent back as `?reason=` to page through this group's routes. */
  readonly reason: AllocationListReason;
  /** Stays in the plan unchanged, or is outside the plan altogether. */
  readonly kind: 'stay' | 'outside';
  readonly heading: string;
  readonly count: number;
  readonly countLabel: string;
}

function countLabel(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'route' : 'routes'}`;
}

export function stayItem(u: AllocationUnchangedItem): UnmovedItem {
  return {
    routeName: u.routeName,
    depotId: u.depotId,
    depotName: u.depotName,
    linked: isRealDepot(u.depotId),
    trips: formatCount(u.tripsPerDay),
    deadKmPerTrip: formatKm(u.deadKmPerTrip),
  };
}

/** The depot name comes from the server; none is looked up or invented here. */
export function outsideItem(e: AllocationExcludedRoute): UnmovedItem {
  return {
    routeName: e.routeName,
    depotId: e.primaryDepotId,
    depotName: e.depotName,
    linked: isRealDepot(e.primaryDepotId),
    trips: null,
    deadKmPerTrip: null,
  };
}

/**
 * Non-empty groups only, from the server's counts by reason: stays in
 * precedence order, then exclusions in theirs (not-profiled routes are
 * stated by the profile coverage section instead).
 */
export function unmovedGroups(
  a: Pick<
    DepotAllocationResponse,
    'unchangedByReason' | 'excludedByReason' | 'params'
  >,
): UnmovedGroup[] {
  const stays = UNCHANGED_ORDER.map(
    (reason): UnmovedGroup => ({
      reason,
      kind: 'stay',
      heading: unchangedReasonText(reason, a.params),
      count: a.unchangedByReason[reason],
      countLabel: countLabel(a.unchangedByReason[reason]),
    }),
  );
  const outside = EXCLUSION_ORDER.filter((reason) => reason !== 'not_profiled').map(
    (reason): UnmovedGroup => ({
      reason,
      kind: 'outside',
      heading: exclusionText(reason),
      count: a.excludedByReason[reason],
      countLabel: countLabel(a.excludedByReason[reason]),
    }),
  );
  return [...stays, ...outside].filter((group) => group.count > 0);
}
