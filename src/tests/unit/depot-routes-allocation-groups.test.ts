import { describe, expect, it } from 'vitest';
import { depotNameMap, moveRows, unmovedGroups } from '@/lib/depot/routes/allocationGroups';
import type {
  AllocationExcludedRoute,
  AllocationMoveItem,
  AllocationUnchangedItem,
  RouteListItem,
} from '@/lib/depot/routes/api';

const PARAMS = { minSavingKmPerDay: 5, maxMoves: 200 };

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

describe('unmovedGroups', () => {
  const names = new Map([['2', 'MATHURA']]);

  it('groups stays by reason in precedence order, then exclusions, leaving out unprofiled routes', () => {
    const groups = unmovedGroups(
      [stay('X', 'no_capacity'), stay('Y', 'already_best'), stay('Z', 'already_best')],
      [out('P', 'not_profiled'), out('Q', 'no_primary_depot', null), out('R', 'too_few_located_stops')],
      PARAMS,
      names,
    );
    expect(groups.map((g) => [g.key, g.kind, g.countLabel])).toEqual([
      ['already_best', 'stay', '2 routes'],
      ['no_capacity', 'stay', '1 route'],
      ['no_primary_depot', 'outside', '1 route'],
      ['too_few_located_stops', 'outside', '1 route'],
    ]);
    expect(groups[0]?.heading).toBe('Already at its nearest depot.');
  });

  it('gives each route its depot, figures where the plan has them, and a link only to a real depot', () => {
    const [stayGroup, noPrimary, noStops] = unmovedGroups(
      [stay('Y', 'already_best')],
      [out('Q', 'no_primary_depot', null), out('R', 'too_few_located_stops')],
      PARAMS,
      names,
    );
    expect(stayGroup?.items[0]).toEqual({
      routeName: 'Y', depotId: '1', depotName: 'AGRA', linked: true, trips: '4', deadKmPerTrip: '10.0',
    });
    expect(noPrimary?.items[0]).toEqual({
      routeName: 'Q', depotId: null, depotName: null, linked: false, trips: null, deadKmPerTrip: null,
    });
    expect(noStops?.items[0]).toMatchObject({ depotId: '2', depotName: 'MATHURA', linked: true });
  });

  it('returns no groups when every route moved or lacks a profile', () => {
    expect(unmovedGroups([], [out('P', 'not_profiled')], PARAMS, names)).toEqual([]);
  });
});

describe('depotNameMap', () => {
  it('maps each operating depot id to its name', () => {
    const route = {
      operators: [
        { depotId: '1', depotName: 'AGRA', buses: 2 },
        { depotId: 'unassigned', depotName: 'No home depot', buses: 1 },
      ],
    } as unknown as RouteListItem;
    expect([...depotNameMap([route]).entries()]).toEqual([
      ['1', 'AGRA'],
      ['unassigned', 'No home depot'],
    ]);
  });
});
