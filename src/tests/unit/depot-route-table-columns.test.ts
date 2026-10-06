import { describe, expect, it } from 'vitest';
import {
  ROUTE_COLUMNS,
  ROUTE_TABLE_FRAME_1440_PX,
  frozenLeft,
  routeTableWidth,
  visibleRouteColumns,
} from '@/lib/depot/routes/routeTableColumns';
import { ROUTE_FIXTURE } from './depot-routes.fixtures';

const WITH_DEAD_KM = {
  ...ROUTE_FIXTURE,
  deadKm: {
    depotId: '1', depotPosition: 'yard' as const, provenance: 'derived' as const, outKm: 6, inKm: 6,
    perTripKm: 12, firstStopUsed: 'A', lastStopUsed: 'B', approximated: false,
  },
} as typeof ROUTE_FIXTURE;

describe('the route table columns', () => {
  it('uses the short headers, the unit in the header and no delay-basis column', () => {
    expect(ROUTE_COLUMNS.map((c) => (c.unit ? `${c.header} ${c.unit}` : c.header))).toEqual([
      'Route', 'Depots', 'Buses', 'Class', 'Trips/day', 'Dead km/trip', 'Delay min', 'Late %', 'Profile',
    ]);
  });

  it('tags trips MODELLED and dead km a trip DERIVED, and nothing else on this MIXED page', () => {
    expect(ROUTE_COLUMNS.filter((c) => c.tag).map((c) => [c.key, c.tag])).toEqual([
      ['trips', 'modelled'],
      ['deadKm', 'derived'],
    ]);
  });

  it('hides dead km a trip until a row has a figure', () => {
    expect(visibleRouteColumns([ROUTE_FIXTURE]).map((c) => c.key)).not.toContain('deadKm');
    expect(visibleRouteColumns([]).map((c) => c.key)).not.toContain('deadKm');
    expect(visibleRouteColumns([ROUTE_FIXTURE, WITH_DEAD_KM]).map((c) => c.key)).toContain('deadKm');
  });

  it('fits every column in the 1440 frame, with and without dead km', () => {
    expect(routeTableWidth(visibleRouteColumns([ROUTE_FIXTURE]))).toBe(944);
    expect(routeTableWidth(ROUTE_COLUMNS)).toBe(1156);
    expect(routeTableWidth(ROUTE_COLUMNS)).toBeLessThanOrEqual(ROUTE_TABLE_FRAME_1440_PX);
  });

  it('places the frozen Depots column after the frozen Route column', () => {
    expect(frozenLeft(ROUTE_COLUMNS, 'route')).toBe(0);
    expect(frozenLeft(ROUTE_COLUMNS, 'depot')).toBe(152);
  });
});
