import { describe, expect, it } from 'vitest';
import {
  EXCLUSION_ORDER,
  UNCHANGED_ORDER,
  allocationHeadline,
  exclusionText,
  formatKm,
  moveNote,
  notProfiledSentence,
  paramsSentence,
  planHeadline,
  toTenths,
  unchangedReasonText,
  DEAD_KM_MEANING,
  PROFILES_GROW_WITH_USE,
  RECOMMENDATION_ONLY,
  TRIPS_MODELLED_NOTE,
} from '@/lib/depot/routes/allocationWording';
import { ALLOCATION_EXCLUSIONS, UNCHANGED_REASONS, type DepotAllocationResponse } from '@/lib/depot/routes/api';
import { TRIP_DEFINITION } from '@/lib/depot/sim/tripFrequencyConfig';

const TRIP_MODEL = {
  factorMin: 1,
  factorMax: 2,
  shortRouteMin: 90,
  longRouteMin: 480,
  unknownDurationFactor: 1.5,
  noise: 0.15,
};
const PARAMS = { minSavingKmPerDay: 5, maxMoves: 200, detourFactor: 1.3, tripModel: TRIP_MODEL };

function countsOf<R extends string>(reasons: readonly R[], items: readonly { reason: R }[]): Record<R, number> {
  return Object.fromEntries(reasons.map((r) => [r, items.filter((i) => i.reason === r).length])) as Record<R, number>;
}

function response(partial: Partial<DepotAllocationResponse> = {}): DepotAllocationResponse {
  return {
    feedNow: '2026-10-06T08:00:00Z',
    fetchedAt: '2026-10-06T08:00:05.000Z',
    source: 'live',
    stale: false,
    operatingDate: '2026-10-06',
    depotId: null,
    recommendationOnly: true,
    coverage: { profiled: { n: 530, of: 1204 }, planned: { n: 412, of: 1204 } },
    depotPositions: { yard: 98, median: 40, none: 0, provenance: 'derived' },
    beforeKmPerDay: { value: 12345.67, provenance: 'modelled', coverage: { n: 412, of: 1204 } },
    afterKmPerDay: { value: 10000.04, provenance: 'modelled', coverage: { n: 412, of: 1204 } },
    savedKmPerDay: { value: 2345.63, provenance: 'modelled', coverage: { n: 412, of: 1204 } },
    moves: [],
    reason: null,
    q: null,
    offset: 0,
    limit: 0,
    unchanged: [],
    unchangedTotal: 0,
    excluded: [],
    excludedTotal: 0,
    profilesPending: false,
    profilesPendingNote: null,
    tripDefinition: TRIP_DEFINITION,
    provenance: { deadKmPerTrip: 'derived', tripsPerDay: 'modelled', kmPerDay: 'modelled', capacity: 'modelled' },
    params: PARAMS,
    profileEndpoint: '/api/upsrtc/depot/route/{routeName}',
    ...partial,
    // As the server does: the counts by reason cover the whole lists.
    unchangedByReason: countsOf(UNCHANGED_REASONS, partial.unchanged ?? []),
    excludedByReason: countsOf(ALLOCATION_EXCLUSIONS, partial.excluded ?? []),
  };
}

function unchanged(routeName: string, reason: DepotAllocationResponse['unchanged'][number]['reason']) {
  return { routeName, depotId: '1', depotName: 'AGRA', reason, tripsPerDay: 4, deadKmPerTrip: 12.3 };
}

function excluded(routeName: string, reason: DepotAllocationResponse['excluded'][number]['reason']) {
  return { routeName, primaryDepotId: '1', depotName: 'AGRA', buses: 2, reason };
}

describe('kilometre figures', () => {
  it('compares in tenths, so float noise never changes a figure', () => {
    expect(toTenths(0.1 + 0.2)).toBe(3);
    expect(toTenths(12.34)).toBe(123);
    expect(toTenths(-0.04)).toBe(0);
  });

  it('prints one decimal with Indian digit grouping', () => {
    expect(formatKm(123456.78)).toBe('1,23,456.8');
    expect(formatKm(0)).toBe('0.0');
    expect(formatKm(-0.04)).toBe('0.0');
  });
});

describe('reasons in words', () => {
  it('orders unchanged reasons by the allocator precedence', () => {
    expect(UNCHANGED_ORDER).toEqual([
      'no_candidate', 'already_best', 'below_threshold', 'over_capacity', 'move_limit', 'no_capacity',
    ]);
    expect(EXCLUSION_ORDER).toEqual([
      'no_primary_depot', 'unassigned_bucket', 'operator_not_depot', 'bus_count_over_cap',
      'not_profiled', 'too_few_located_stops', 'no_depot_position',
    ]);
  });

  it('words the unassigned bucket apart from hired units, and the bus cap with its figure', () => {
    expect(exclusionText('unassigned_bucket')).toContain('no home depot');
    expect(exclusionText('unassigned_bucket')).not.toContain('hired');
    expect(exclusionText('bus_count_over_cap')).toContain('More than 500 buses');
  });

  it('states the threshold and the move cap from the server parameters', () => {
    expect(unchangedReasonText('below_threshold', PARAMS)).toContain('under 5 km a day');
    expect(unchangedReasonText('move_limit', PARAMS)).toContain('200');
    expect(unchangedReasonText('move_limit', PARAMS)).toContain('possibly a swap');
    expect(unchangedReasonText('no_capacity', PARAMS)).toContain('none has room');
    expect(unchangedReasonText('over_capacity', PARAMS)).toContain('over its modelled capacity');
    expect(unchangedReasonText('already_best', PARAMS)).toBe('Already at its nearest depot.');
  });

  it('gives every exclusion a plain reason', () => {
    expect(exclusionText('no_primary_depot')).toContain('equally');
    expect(exclusionText('operator_not_depot')).toContain('hired, electric or enforcement');
    expect(exclusionText('too_few_located_stops')).toContain('no terminals to measure from');
    expect(exclusionText('no_depot_position')).toContain('location is unknown');
  });

  it('marks a route that moved to make room, saying when it saved nothing itself', () => {
    const base = { routeName: 'R', fromDepotId: '1', toDepotId: '2', busesNeeded: 1 };
    expect(moveNote({ ...base, savedKmPerDay: 40, madeRoom: false })).toBeNull();
    expect(moveNote({ ...base, savedKmPerDay: 2.4, madeRoom: true })).toBe('moved to make room');
    expect(moveNote({ ...base, savedKmPerDay: 0.04, madeRoom: true })).toBe(
      'moved to make room, no saving of its own',
    );
    expect(moveNote({ ...base, savedKmPerDay: -3, madeRoom: true })).toBe(
      'moved to make room, no saving of its own',
    );
  });
});

describe('planHeadline', () => {
  it('is one sentence: what would move and on how many routes', () => {
    // M11: the exact sentence the fixture produces, not either of two wordings.
    expect(planHeadline(response())).toBe(
      'No route would move. Based on 412 of 1,204 routes with a known profile.',
    );
  });
});

describe('allocationHeadline', () => {
  it('states the three totals, the coverage and the depot positions', () => {
    const h = allocationHeadline(response());
    expect(h.now).toBe('12,345.7');
    expect(h.after).toBe('10,000.0');
    expect(h.saving).toBe('2,345.6');
    expect(h.coverageLine).toBe(
      'Based on 412 of 1,204 routes with a known profile that can be measured from a depot; 530 of 1,204 routes have a known profile.',
    );
    expect(h.positionsLine).toBe(
      'Depot positions are inferred: 98 depots placed at their yard, 40 at the median position of their buses.',
    );
    expect(h.planned).toBe(true);
  });

  it('names depots with no position only when there are some', () => {
    const h = allocationHeadline(
      response({ depotPositions: { yard: 1, median: 1, none: 2, provenance: 'derived' } }),
    );
    expect(h.positionsLine).toBe(
      'Depot positions are inferred: 1 depot placed at its yard, 1 at the median position of its buses, 2 with no position.',
    );
  });

  it('counts moves, made-room moves and unmoved routes by reason in precedence order', () => {
    const move = (routeName: string, madeRoom: boolean) => ({
      routeName, fromDepotId: '1', toDepotId: '2', busesNeeded: 1, savedKmPerDay: madeRoom ? 0 : 20,
      madeRoom, fromDepotName: 'AGRA', toDepotName: 'MATHURA', tripsPerDay: 3,
      fromDeadKmPerTrip: 10, toDeadKmPerTrip: 4,
    });
    const h = allocationHeadline(
      response({
        moves: [move('A', false), move('B', true)],
        unchanged: [
          unchanged('C', 'no_capacity'),
          unchanged('D', 'already_best'),
          unchanged('E', 'already_best'),
          unchanged('F', 'below_threshold'),
        ],
        excluded: [excluded('G', 'not_profiled'), excluded('H', 'no_primary_depot')],
      }),
    );
    expect(h.movesLine).toBe('2 routes would move to another depot, 1 of them to make room for another route.');
    expect(h.stayLine).toBe(
      '4 routes would stay: 2 already at the nearest depot, 1 saving under 5 km a day, 1 no depot with room.',
    );
    expect(h.excludedLine).toBe(
      '2 routes are outside the plan: 1 run equally by two depots, 1 no known profile.',
    );
  });

  it('says plainly when nothing would move and nothing is left out', () => {
    const h = allocationHeadline(response());
    expect(h.movesLine).toBe('No route would move.');
    expect(h.stayLine).toBeNull();
    expect(h.excludedLine).toBeNull();
  });

  it('says why there is no plan when no route can be measured', () => {
    const h = allocationHeadline(
      response({ coverage: { profiled: { n: 0, of: 50 }, planned: { n: 0, of: 50 } } }),
    );
    expect(h.planned).toBe(false);
    expect(h.emptyLine).toBe(
      'No route can be planned yet: none of the 50 routes in the feed has a known profile that can be measured from a depot.',
    );
  });
});

describe('fixed sentences', () => {
  it('states the parameters as fixed', () => {
    expect(paramsSentence(PARAMS)).toBe(
      'The plan moves a route only for a saving of at least 5 km a day and makes at most 200 moves; road distance is taken as 1.3 times the straight line. The server fixes these; they cannot be changed here.',
    );
  });

  it('counts routes without a profile, with the reason', () => {
    expect(notProfiledSentence(674, 1204)).toBe(
      '674 of 1,204 routes have no known profile yet, so the plan cannot measure their dead kilometres.',
    );
    expect(notProfiledSentence(0, 10)).toBe('Every route in the feed has a known profile.');
  });

  it('explains trips, use-driven coverage and recommendation only, never "simulated"', () => {
    for (const s of [TRIPS_MODELLED_NOTE, DEAD_KM_MEANING, PROFILES_GROW_WITH_USE, RECOMMENDATION_ONLY]) {
      expect(s.toLowerCase()).not.toContain('simulated');
    }
    expect(TRIPS_MODELLED_NOTE).toContain('modelled from the buses');
    expect(DEAD_KM_MEANING).toContain('first and last stops');
    expect(PROFILES_GROW_WITH_USE).toContain('one route at a time');
    expect(PROFILES_GROW_WITH_USE).toContain('never by itself');
    expect(PROFILES_GROW_WITH_USE).toContain('at most 40 a press');
    expect(RECOMMENDATION_ONLY).toContain('no route is reassigned');
  });
});
