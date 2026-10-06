import { describe, expect, it } from 'vitest';
import type { RouteListItem } from '@/lib/depot/routes/api';
import {
  NO_CLASS,
  NO_ROUTE_FILTERS,
  ROUTE_PAGE_SIZE,
  classOptions,
  depotOptions,
  filterRoutes,
  pageOf,
  routeRangeSentence,
  sortRoutes,
} from '@/lib/depot/routes/routesPageModel';
import { deadKmWords, delayWords, operatorsView } from '@/lib/depot/routes/routeRowWording';

type Op = { depotId: string; depotName: string; buses: number };

function route(
  routeName: string,
  operators: readonly Op[],
  partial: Partial<RouteListItem> = {},
): RouteListItem {
  const buses = operators.reduce((sum, o) => sum + o.buses, 0);
  return {
    routeName,
    routeId: null,
    description: null,
    serviceToken: 'ORD',
    direction: null,
    buses,
    operators,
    primaryDepotId: operators[0]?.depotId ?? null,
    states: { inService: buses, onRoad: 0, standing: 0, dark: 0, offRoad: 0 },
    delay: { medianMin: null, lateShare: null, coverage: { n: 0, of: buses } },
    profiled: false,
    firstStop: null,
    lastStop: null,
    lengthKm: null,
    scheduledDurationMin: null,
    tripsPerDay: { value: buses, provenance: 'modelled' },
    tripsBasis: 'buses_only',
    deadKm: null,
    ...partial,
  };
}

const AGRA = { depotId: '1', depotName: 'AGRA', buses: 3 };
const MATHURA = { depotId: '2', depotName: 'MATHURA', buses: 2 };
const ALIGARH = { depotId: '3', depotName: 'ALIGARH', buses: 1 };

const ROUTES: readonly RouteListItem[] = [
  route('AGRA-DELHI ORD', [AGRA, MATHURA]),
  route('MATHURA-AGRA EXP', [MATHURA], { serviceToken: 'EXP' }),
  route('ALIGARH LOCAL', [ALIGARH], { serviceToken: null }),
];

describe('filter options', () => {
  it('lists every operating depot once, by name', () => {
    expect(depotOptions(ROUTES)).toEqual([
      { value: '1', label: 'AGRA' },
      { value: '3', label: 'ALIGARH' },
      { value: '2', label: 'MATHURA' },
    ]);
  });

  it('lists classes in order, with routes whose name carries none last', () => {
    expect(classOptions(ROUTES)).toEqual([
      { value: 'EXP', label: 'EXP' },
      { value: 'ORD', label: 'ORD' },
      { value: NO_CLASS, label: 'No class in name' },
    ]);
  });
});

describe('filterRoutes', () => {
  it('keeps every route without a filter, and a route run by a depot among others', () => {
    expect(filterRoutes(ROUTES, NO_ROUTE_FILTERS)).toHaveLength(3);
    const byMathura = filterRoutes(ROUTES, { depotId: '2', serviceClass: null });
    expect(byMathura.map((r) => r.routeName)).toEqual(['AGRA-DELHI ORD', 'MATHURA-AGRA EXP']);
  });

  it('filters by class, including routes with no class in the name', () => {
    expect(filterRoutes(ROUTES, { depotId: null, serviceClass: 'EXP' })).toHaveLength(1);
    const none = filterRoutes(ROUTES, { depotId: null, serviceClass: NO_CLASS });
    expect(none.map((r) => r.routeName)).toEqual(['ALIGARH LOCAL']);
  });
});

describe('sortRoutes', () => {
  it('keeps the server order without a sort, and never mutates the input', () => {
    const copy = [...ROUTES];
    expect(sortRoutes(ROUTES, null)).toEqual(ROUTES);
    sortRoutes(ROUTES, { key: 'route', direction: 'asc' });
    expect(ROUTES).toEqual(copy);
  });

  it('sorts by the majority depot name and by buses', () => {
    const byDepot = sortRoutes(ROUTES, { key: 'depot', direction: 'asc' });
    expect(byDepot.map((r) => r.routeName)).toEqual(['AGRA-DELHI ORD', 'ALIGARH LOCAL', 'MATHURA-AGRA EXP']);
    const byBuses = sortRoutes(ROUTES, { key: 'buses', direction: 'asc' });
    expect(byBuses.map((r) => r.buses)).toEqual([1, 2, 5]);
  });

  it('sorts dead kilometres in tenths, unknown last both ways', () => {
    const dk = (perTripKm: number) => ({
      outKm: 0, inKm: 0, perTripKm, firstStopUsed: 'A', lastStopUsed: 'B', approximated: false,
      depotId: '1', depotPosition: 'yard' as const, provenance: 'derived' as const,
    });
    const list = [
      route('A', [AGRA], { deadKm: dk(0.1 + 0.2) }),
      route('B', [AGRA]),
      route('C', [AGRA], { deadKm: dk(0.3) }),
      route('D', [AGRA], { deadKm: dk(0.2) }),
    ];
    expect(sortRoutes(list, { key: 'deadKm', direction: 'asc' }).map((r) => r.routeName)).toEqual([
      'D', 'A', 'C', 'B',
    ]);
    expect(sortRoutes(list, { key: 'deadKm', direction: 'desc' }).map((r) => r.routeName)).toEqual([
      'A', 'C', 'D', 'B',
    ]);
  });
});

describe('paging', () => {
  const items = Array.from({ length: 60 }, (_, i) => i);

  it('cuts pages of the page size and counts them', () => {
    const p = pageOf(items, 2);
    expect(ROUTE_PAGE_SIZE).toBe(25);
    expect(p).toMatchObject({ page: 2, pageCount: 3, offset: 50, total: 60 });
    expect(p.items).toEqual(items.slice(50));
  });

  it('clamps a page past the end (a filter or poll shrank the list) and below the start', () => {
    expect(pageOf(items, 9).page).toBe(2);
    expect(pageOf(items, -1).page).toBe(0);
    expect(pageOf([], 3)).toMatchObject({ page: 0, pageCount: 1, offset: 0, total: 0, items: [] });
  });

  it('states the range and the filter honestly', () => {
    expect(routeRangeSentence({ offset: 0, shown: 25, total: 1204 }, 1204)).toBe(
      'Showing 1–25 of 1,204 routes',
    );
    expect(routeRangeSentence({ offset: 25, shown: 5, total: 30 }, 1204)).toBe(
      'Showing 26–30 of 30 routes that match these filters, out of 1,204 in the feed',
    );
    expect(routeRangeSentence({ offset: 0, shown: 0, total: 0 }, 1204)).toBe(
      'No routes match these filters, out of 1,204 in the feed',
    );
  });
});

describe('row wording', () => {
  it('names the majority operator and links real depots only', () => {
    const shared = operatorsView(route('R', [AGRA, MATHURA]));
    expect(shared.operators.map((o) => [o.depotName, o.majority, o.linked])).toEqual([
      ['AGRA', true, true],
      ['MATHURA', false, true],
    ]);
    expect(shared.note).toBeNull();
    const tie = operatorsView(route('T', [AGRA, { ...MATHURA, buses: 3 }], { primaryDepotId: null }));
    expect(tie.operators.every((o) => !o.majority)).toBe(true);
    expect(tie.note).toBe('equal split, no majority');
    const loose = operatorsView(route('U', [{ depotId: 'unassigned', depotName: 'No home depot', buses: 1 }]));
    expect(loose.operators[0]?.linked).toBe(false);
    expect(loose.operators[0]?.majority).toBe(false);
  });

  it('words delay figures with their coverage', () => {
    expect(delayWords({ medianMin: 4.46, lateShare: 0.3333, coverage: { n: 6, of: 8 } })).toEqual({
      median: '+4.5 min', late: '33%', basis: 'based on 6 of 8 buses',
    });
    expect(delayWords({ medianMin: -1, lateShare: 0, coverage: { n: 1, of: 1 } })).toEqual({
      median: '−1.0 min', late: '0%', basis: 'based on 1 of 1 bus',
    });
    expect(delayWords({ medianMin: null, lateShare: null, coverage: { n: 0, of: 3 } })).toEqual({
      median: '—', late: '—', basis: 'based on 0 of 3 buses',
    });
  });

  it('says why a dead-kilometre figure is missing or approximate', () => {
    expect(deadKmWords(route('R', [AGRA]))).toEqual({ value: '—', note: 'no known profile' });
    expect(deadKmWords(route('R', [AGRA], { profiled: true, primaryDepotId: null }))).toEqual({
      value: '—', note: 'no single operating depot',
    });
    expect(deadKmWords(route('R', [AGRA], { profiled: true }))).toEqual({
      value: '—', note: 'cannot be measured from its depot',
    });
    const deadKm = {
      outKm: 4, inKm: 8.25, perTripKm: 12.25, firstStopUsed: 'A', lastStopUsed: 'B', approximated: true,
      depotId: '1', depotPosition: 'median' as const, provenance: 'derived' as const,
    };
    expect(deadKmWords(route('R', [AGRA], { profiled: true, deadKm }))).toEqual({
      value: '12.3',
      note: 'nearest located stop stood in for a terminal; depot position approximate',
    });
    expect(
      deadKmWords(route('R', [AGRA], { profiled: true, deadKm: { ...deadKm, approximated: false, depotPosition: 'yard' } })),
    ).toEqual({ value: '12.3', note: null });
  });
});
