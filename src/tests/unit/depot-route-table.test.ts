import { describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import type { BusOpState } from '@/lib/depot/types';
import { buildRouteTable, LATE_AFTER_MIN } from '@/lib/depot/routes/routeTable';

const FEED_NOW = '2026-10-06T10:00:00Z';

function bus(overrides: Partial<DepotBusRow> & { registrationNumber: string }): DepotBusRow {
  return {
    latitude: 26.8,
    longitude: 80.9,
    speedKmph: 0,
    ignitionOn: null,
    gpsTimestamp: null,
    receivedAt: null,
    depotId: '1',
    depotName: 'Alambagh',
    vehicleStatus: 'live',
    tripStatus: null,
    routeId: null,
    routeName: 'ORD_LKO-KNP_IN',
    routeDescription: null,
    journeyId: null,
    journeyCode: null,
    scheduledStart: '2026-10-06T06:00:00Z',
    scheduledEnd: null,
    actualStart: null,
    delayMinutes: 0,
    odometerRaw: null,
    mainPowerOn: null,
    mainVoltage: null,
    tamperCode: null,
    emergency: null,
    ...overrides,
  };
}

const stateOf = (row: DepotBusRow): BusOpState =>
  row.vehicleStatus === 'live' ? 'on_road' : 'off_road';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as object).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('buildRouteTable', () => {
  it('ignores rows without a route name and groups the rest', () => {
    const rows = [
      bus({ registrationNumber: 'A' }),
      bus({ registrationNumber: 'B' }),
      bus({ registrationNumber: 'C', routeName: null }),
      bus({ registrationNumber: 'D', routeName: '  ' }),
    ];
    const table = buildRouteTable(rows, stateOf, FEED_NOW);
    expect(table).toHaveLength(1);
    expect(table[0]!.buses).toBe(2);
  });

  it('parses service token and direction from the name', () => {
    const rows = [
      bus({ registrationNumber: 'A', routeName: 'exp_LKO-DEL_OUT' }),
      bus({ registrationNumber: 'B', routeName: 'LKO-DEL' }),
      bus({ registrationNumber: 'C', routeName: 'AC_X_Y_IN' }),
    ];
    const byName = new Map(buildRouteTable(rows, stateOf, FEED_NOW).map((r) => [r.routeName, r]));
    expect(byName.get('exp_LKO-DEL_OUT')).toMatchObject({ serviceToken: 'EXP', direction: 'OUT' });
    expect(byName.get('LKO-DEL')).toMatchObject({ serviceToken: null, direction: null });
    expect(byName.get('AC_X_Y_IN')).toMatchObject({ serviceToken: 'AC', direction: 'IN' });
  });

  it('reads the most specific class token, as duties and buses do', () => {
    const rows = [
      bus({ registrationNumber: 'A', routeName: 'X_ORD_AC_out' }),
      bus({ registrationNumber: 'B', routeName: 'X_EXP_ORD_out' }),
      bus({ registrationNumber: 'C', routeName: 'ORD_VOLVO_AC_IN' }),
    ];
    const byName = new Map(buildRouteTable(rows, stateOf, FEED_NOW).map((r) => [r.routeName, r]));
    expect(byName.get('X_ORD_AC_out')?.serviceToken).toBe('AC');
    expect(byName.get('X_EXP_ORD_out')?.serviceToken).toBe('EXP');
    expect(byName.get('ORD_VOLVO_AC_IN')?.serviceToken).toBe('VOLVO');
  });

  it('lists operators by buses then depot id and names the strict majority', () => {
    const rows = [
      bus({ registrationNumber: 'A', depotId: '7', depotName: 'Seven' }),
      bus({ registrationNumber: 'B', depotId: '7', depotName: 'Seven' }),
      bus({ registrationNumber: 'C', depotId: '3', depotName: 'Three' }),
      bus({ registrationNumber: 'D', depotId: null, depotName: null }),
    ];
    const [row] = buildRouteTable(rows, stateOf, FEED_NOW);
    expect(row!.operators.map((o) => [o.depotId, o.buses])).toEqual([
      ['7', 2],
      ['3', 1],
    ]);
    expect(row!.primaryDepotId).toBe('7');
    expect(row!.buses).toBe(4);
  });

  it('has no primary depot on an exact tie for first, or when no bus has a depot', () => {
    const tie = [
      bus({ registrationNumber: 'A', depotId: '9', depotName: 'Nine' }),
      bus({ registrationNumber: 'B', depotId: '2', depotName: 'Two' }),
    ];
    const tied = buildRouteTable(tie, stateOf, FEED_NOW)[0]!;
    expect(tied.primaryDepotId).toBeNull();
    expect(tied.operators.map((o) => o.depotId)).toEqual(['2', '9']);
    const none = buildRouteTable(
      [bus({ registrationNumber: 'A', depotId: null })],
      stateOf,
      FEED_NOW,
    )[0]!;
    expect(none.primaryDepotId).toBeNull();
    expect(none.operators).toEqual([]);
  });

  it('uses the most frequent depot name, ties broken alphabetically', () => {
    const rows = [
      bus({ registrationNumber: 'A', depotName: 'Beta' }),
      bus({ registrationNumber: 'B', depotName: 'Alpha' }),
      bus({ registrationNumber: 'C', depotName: 'Alpha' }),
    ];
    expect(buildRouteTable(rows, stateOf, FEED_NOW)[0]!.operators[0]!.depotName).toBe('Alpha');
  });

  it('counts states with the injected classifier', () => {
    const rows = [
      bus({ registrationNumber: 'A' }),
      bus({ registrationNumber: 'B', vehicleStatus: 'no_signal' }),
    ];
    expect(buildRouteTable(rows, stateOf, FEED_NOW)[0]!.states).toEqual({
      inService: 0,
      onRoad: 1,
      standing: 0,
      dark: 0,
      offRoad: 1,
    });
  });

  it('computes delay statistics only from scheduled, plausible, non-null delays', () => {
    const rows = [
      bus({ registrationNumber: 'A', delayMinutes: 2 }),
      bus({ registrationNumber: 'B', delayMinutes: 5 }),
      bus({ registrationNumber: 'C', delayMinutes: 11 }),
      bus({ registrationNumber: 'D', delayMinutes: LATE_AFTER_MIN }),
      bus({ registrationNumber: 'E', delayMinutes: 9999 }),
      bus({ registrationNumber: 'F', delayMinutes: null }),
      bus({ registrationNumber: 'G', delayMinutes: 50, scheduledStart: '2026-10-05T06:00:00Z' }),
      bus({ registrationNumber: 'H', delayMinutes: -300 }),
    ];
    const { delay } = buildRouteTable(rows, stateOf, FEED_NOW)[0]!;
    expect(delay.coverage).toEqual({ n: 4, of: 8 });
    expect(delay.medianMin).toBe(7.5);
    expect(delay.lateShare).toBe(0.25);
  });

  it('rounds the median to one decimal and the late share to four', () => {
    const rows = [1, 2, 20].map((d, i) => bus({ registrationNumber: `R${i}`, delayMinutes: d }));
    rows.push(bus({ registrationNumber: 'X', delayMinutes: 2.34 }));
    const { delay } = buildRouteTable(rows, stateOf, FEED_NOW)[0]!;
    expect(delay.medianMin).toBe(2.2);
    const three = [0, 0, 30].map((d, i) => bus({ registrationNumber: `T${i}`, delayMinutes: d }));
    expect(buildRouteTable(three, stateOf, FEED_NOW)[0]!.delay.lateShare).toBe(0.3333);
  });

  it('reports null statistics, never NaN, when no delay is usable', () => {
    const rows = [bus({ registrationNumber: 'A', delayMinutes: null })];
    const [row] = buildRouteTable(rows, stateOf, null);
    expect(row!.delay).toEqual({ medianMin: null, lateShare: null, coverage: { n: 0, of: 1 } });
  });

  it('sorts by buses descending then route name, and does not mutate input', () => {
    const rows = deepFreeze([
      bus({ registrationNumber: 'A', routeName: 'B_ROUTE' }),
      bus({ registrationNumber: 'B', routeName: 'A_ROUTE' }),
      bus({ registrationNumber: 'C', routeName: 'C_ROUTE' }),
      bus({ registrationNumber: 'D', routeName: 'C_ROUTE' }),
    ]);
    const table = buildRouteTable(rows, stateOf, FEED_NOW);
    expect(table.map((r) => r.routeName)).toEqual(['C_ROUTE', 'A_ROUTE', 'B_ROUTE']);
  });

  it('is independent of input order', () => {
    const rows = [
      bus({ registrationNumber: 'A', depotId: '1', routeId: 'r2', delayMinutes: 3 }),
      bus({ registrationNumber: 'B', depotId: '2', routeId: 'r1', delayMinutes: 30 }),
      bus({ registrationNumber: 'C', depotId: '2', routeId: null, delayMinutes: 4 }),
    ];
    const a = buildRouteTable(rows, stateOf, FEED_NOW);
    const b = buildRouteTable([...rows].reverse(), stateOf, FEED_NOW);
    expect(b).toEqual(a);
    expect(a[0]!.routeId).toBe('r1');
  });
});
