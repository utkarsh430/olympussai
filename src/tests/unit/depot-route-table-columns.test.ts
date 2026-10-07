import { describe, expect, it } from 'vitest';
import {
  ROUTE_COLUMNS,
  ROUTE_TABLE_FRAME_1440_PX,
  frozenLeft,
  isSortColumn,
  ROUTE_TABLE_FRAME_PX,
  columnsAtWidth,
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
      'Day',
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

  it('hides PROFILE while every row has the same profile state (a constant column)', () => {
    const known = { ...ROUTE_FIXTURE, profiled: true };
    const unknown = { ...ROUTE_FIXTURE, profiled: false };
    expect(visibleRouteColumns([unknown, unknown]).map((c) => c.key)).not.toContain('profile');
    expect(visibleRouteColumns([known, known]).map((c) => c.key)).not.toContain('profile');
    expect(visibleRouteColumns([unknown, known]).map((c) => c.key)).toContain('profile');
  });

  it('draws the reduced sets at 1024 and 800', () => {
    const keys = (rows: readonly (typeof ROUTE_FIXTURE)[], width: 'wide' | 'lg' | 'base') =>
      columnsAtWidth(visibleRouteColumns(rows), width).map((c) => c.key);
    expect(keys([ROUTE_FIXTURE], 'base')).toEqual(['route', 'depot', 'buses', 'trips', 'median', 'hourly']);
    expect(keys([ROUTE_FIXTURE], 'lg')).toEqual([
      'route', 'depot', 'buses', 'class', 'trips', 'median', 'late', 'hourly',
    ]);
    // With dead km at 1024, CLASS and LATE step aside (both are in the drawer's header).
    expect(keys([WITH_DEAD_KM], 'lg')).toEqual(['route', 'depot', 'buses', 'trips', 'deadKm', 'median', 'hourly']);
  });

  it('ends every row in the hour-by-hour link at every width, never sorted on', () => {
    const last = ROUTE_COLUMNS.at(-1);
    expect(last).toMatchObject({ key: 'hourly', header: 'Day', from: 'base', frozen: false });
    expect(ROUTE_COLUMNS.filter(isSortColumn).map((c) => c.key)).not.toContain('hourly');
    expect(ROUTE_COLUMNS.filter(isSortColumn)).toHaveLength(ROUTE_COLUMNS.length - 1);
  });

  it('draws PROFILE from 1440 only, and leaves CLASS (it is in the route name) when dead km and PROFILE both show', () => {
    const mixed = [{ ...ROUTE_FIXTURE, profiled: false }, { ...WITH_DEAD_KM, profiled: true }];
    const noDeadKm = [{ ...ROUTE_FIXTURE, profiled: false }, { ...ROUTE_FIXTURE, profiled: true }];
    expect(columnsAtWidth(visibleRouteColumns(noDeadKm), 'lg').map((c) => c.key)).not.toContain('profile');
    expect(columnsAtWidth(visibleRouteColumns(noDeadKm), 'wide').map((c) => c.key)).toContain('profile');
    expect(visibleRouteColumns(mixed).map((c) => c.key)).not.toContain('class');
    expect(visibleRouteColumns([WITH_DEAD_KM]).map((c) => c.key)).toContain('class');
  });

  it('fits every column set in its frame at 1440, 1024 and 800, with and without dead km', () => {
    const mixed = [{ ...ROUTE_FIXTURE, profiled: false }, { ...WITH_DEAD_KM, profiled: true }];
    const profiledOnly = [{ ...ROUTE_FIXTURE, profiled: false }, { ...ROUTE_FIXTURE, profiled: true }];
    for (const rows of [[ROUTE_FIXTURE], [WITH_DEAD_KM], mixed, profiledOnly]) {
      const cols = visibleRouteColumns(rows);
      expect(routeTableWidth(columnsAtWidth(cols, 'wide'))).toBeLessThanOrEqual(ROUTE_TABLE_FRAME_PX.wide);
      expect(routeTableWidth(columnsAtWidth(cols, 'lg'))).toBeLessThanOrEqual(ROUTE_TABLE_FRAME_PX.lg);
      expect(routeTableWidth(columnsAtWidth(cols, 'base'))).toBeLessThanOrEqual(ROUTE_TABLE_FRAME_PX.base);
    }
    expect(routeTableWidth(columnsAtWidth(visibleRouteColumns(mixed), 'wide'))).toBe(1129);
    expect(routeTableWidth(columnsAtWidth(visibleRouteColumns([WITH_DEAD_KM]), 'wide'))).toBe(1109);
    expect(routeTableWidth(columnsAtWidth(visibleRouteColumns([WITH_DEAD_KM]), 'lg'))).toBe(949);
    expect(routeTableWidth(columnsAtWidth(visibleRouteColumns([ROUTE_FIXTURE]), 'base'))).toBe(748);
    expect(ROUTE_TABLE_FRAME_PX.wide).toBe(ROUTE_TABLE_FRAME_1440_PX);
  });

  it('places the frozen Depots column after the frozen Route column', () => {
    expect(frozenLeft(ROUTE_COLUMNS, 'route')).toBe(0);
    expect(frozenLeft(ROUTE_COLUMNS, 'depot')).toBe(152);
  });
});
