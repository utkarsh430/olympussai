import { describe, expect, it } from 'vitest';
import { TRIP_MODEL_PARAMS } from '@/lib/depot/sim/tripFrequencyConfig';
import {
  moveRows,
  outsideItem,
  stayItem,
  unmovedGroups,
} from '@/lib/depot/routes/allocationGroups';
import {
  ALLOCATION_EXCLUSIONS,
  UNCHANGED_REASONS,
  type AllocationExcludedRoute,
  type AllocationMoveItem,
  type AllocationUnchangedItem,
} from '@/lib/depot/routes/api';

const PARAMS = { minSavingKmPerDay: 5, maxMoves: 200, detourFactor: 1.3, tripModel: TRIP_MODEL_PARAMS };

function move(routeName: string, savedKmPerDay: number, madeRoom = false): AllocationMoveItem {
  return {
    routeName,
    fromDepotId: '1',
    toDepotId: '2',
    busesNeeded: 2,
    savedKmPerDay,
    madeRoom,
    fromDepotName: 'AGRA',
    toDepotName: 'MATHURA',
    tripsPerDay: 6,
    fromDeadKmPerTrip: 14.25,
    toDeadKmPerTrip: 3,
  };
}

function stay(routeName: string, reason: AllocationUnchangedItem['reason']): AllocationUnchangedItem {
  return { routeName, depotId: '1', depotName: 'AGRA', reason, tripsPerDay: 4, deadKmPerTrip: 9.96 };
}

function out(
  routeName: string,
  reason: AllocationExcludedRoute['reason'],
  primaryDepotId: string | null = '2',
): AllocationExcludedRoute {
  return { routeName, primaryDepotId, depotName: null, buses: 1, reason };
}

describe('moveRows', () => {
  it('puts the largest saving first, comparing in tenths, then route name', () => {
    const rows = moveRows([move('C', 10.04), move('A', 10.0), move('B', 55.5), move('D', 0, true)]);
    expect(rows.map((r) => r.routeName)).toEqual(['B', 'A', 'C', 'D']);
  });

  it('words each figure and marks a move made to make room', () => {
    const [plain, room] = moveRows([move('A', 67.5), move('B', 0, true)]);
    expect(plain).toMatchObject({
      trips: '6',
      deadNow: '14.3',
      deadAfter: '3.0',
      saving: '67.5',
      note: null,
      fromLinked: true,
      toLinked: true,
    });
    expect(room?.note).toBe('moved to make room, no saving of its own');
  });
});

const zero = <R extends string>(reasons: readonly R[]): Record<R, number> =>
  Object.fromEntries(reasons.map((r) => [r, 0])) as Record<R, number>;

describe('unmovedGroups', () => {
  it('groups by the server counts: stays in precedence order, then exclusions, without unprofiled', () => {
    const groups = unmovedGroups({
      params: PARAMS,
      unchangedByReason: { ...zero(UNCHANGED_REASONS), no_capacity: 1, already_best: 2 },
      excludedByReason: {
        ...zero(ALLOCATION_EXCLUSIONS),
        not_profiled: 9,
        no_primary_depot: 1,
        unassigned_bucket: 3,
      },
    });
    expect(groups.map((g) => [g.reason, g.kind, g.countLabel])).toEqual([
      ['already_best', 'stay', '2 routes'],
      ['no_capacity', 'stay', '1 route'],
      ['no_primary_depot', 'outside', '1 route'],
      ['unassigned_bucket', 'outside', '3 routes'],
    ]);
    expect(groups[0]?.heading).toBe('Already at its nearest depot.');
  });

  it('returns no groups when every count is zero', () => {
    const counts = { unchangedByReason: zero(UNCHANGED_REASONS), excludedByReason: zero(ALLOCATION_EXCLUSIONS) };
    expect(unmovedGroups({ params: PARAMS, ...counts })).toEqual([]);
  });
});

describe('list items', () => {
  it('gives a stay its figures and an excluded route the depot name the server sent', () => {
    expect(stayItem(stay('X', 'already_best'))).toMatchObject({ routeName: 'X', linked: true });
    const named = outsideItem({ ...out('Q', 'operator_not_depot'), depotName: 'MATHURA' });
    expect(named).toMatchObject({ depotName: 'MATHURA', trips: null, deadKmPerTrip: null });
    expect(outsideItem(out('U', 'unassigned_bucket', 'unassigned')).linked).toBe(false);
  });
});
