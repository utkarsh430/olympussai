import { describe, it, expect } from 'vitest';
import { filterFleet, groupByDepot, groupByRoute, deriveStandbyAvailability } from '@/lib/ops/fleetView';
import type { CanonicalLiveBus } from '@/models/canonical';

function bus(overrides: Partial<CanonicalLiveBus> = {}): CanonicalLiveBus {
  return {
    id: 'UP25FT0001',
    registrationNumber: 'UP25FT0001',
    latitude: 28.35,
    longitude: 79.42,
    speedKmph: 12,
    headingDegrees: 90,
    depotName: 'Bareilly',
    routeId: 'RT-1',
    routeName: 'RKD_4560_ORD_OUT',
    serviceNumber: 'RKD0399',
    tripId: 'trip-1',
    vehicleType: 'AC',
    gpsTimestamp: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    ignitionOn: true,
    rawStatus: 'Online',
    tripDate: '2026-08-05',
    dataQuality: 'good',
    ...overrides,
  };
}

describe('filterFleet', () => {
  const buses = [
    bus({ id: 'a', registrationNumber: 'UP25FT4823', routeName: 'Bareilly Express', depotName: 'Bareilly' }),
    bus({ id: 'b', registrationNumber: 'UP32AB1234', routeName: 'Lucknow Local', depotName: 'Lucknow' }),
  ];

  it('returns everything when the query is empty', () => {
    expect(filterFleet(buses, '')).toHaveLength(2);
    expect(filterFleet(buses, null)).toHaveLength(2);
    expect(filterFleet(buses, undefined)).toHaveLength(2);
  });

  it('matches case-insensitively against registration', () => {
    expect(filterFleet(buses, 'up25ft4823')).toEqual([buses[0]]);
  });

  it('matches against route name and depot', () => {
    expect(filterFleet(buses, 'lucknow')).toEqual([buses[1]]);
    expect(filterFleet(buses, 'express')).toEqual([buses[0]]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterFleet(buses, 'no-such-vehicle')).toEqual([]);
  });
});

describe('groupByDepot', () => {
  it('groups vehicles by depot, largest group first', () => {
    const buses = [
      bus({ id: 'a', depotName: 'Bareilly' }),
      bus({ id: 'b', depotName: 'Bareilly' }),
      bus({ id: 'c', depotName: 'Lucknow' }),
    ];
    const groups = groupByDepot(buses);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.key).toBe('Bareilly');
    expect(groups[0]?.buses).toHaveLength(2);
    expect(groups[1]?.key).toBe('Lucknow');
  });

  it('buckets vehicles with no depot under "Unassigned depot"', () => {
    const groups = groupByDepot([bus({ depotName: null })]);
    expect(groups[0]?.key).toBe('Unassigned depot');
  });
});

describe('groupByRoute', () => {
  it('groups vehicles by route id, using route name as the label', () => {
    const buses = [
      bus({ id: 'a', routeId: 'RT-1', routeName: 'Route One' }),
      bus({ id: 'b', routeId: 'RT-1', routeName: 'Route One' }),
      bus({ id: 'c', routeId: 'RT-2', routeName: 'Route Two' }),
    ];
    const groups = groupByRoute(buses);
    expect(groups[0]?.key).toBe('RT-1');
    expect(groups[0]?.label).toBe('Route One');
    expect(groups[0]?.buses).toHaveLength(2);
  });

  it('buckets vehicles with no route under "Unassigned route"', () => {
    const groups = groupByRoute([bus({ routeId: null, routeName: null })]);
    expect(groups[0]?.key).toBe('Unassigned route');
  });
});

describe('deriveStandbyAvailability', () => {
  const now = Date.parse('2026-08-06T12:00:00.000Z');

  it('includes a vehicle with no active trip and ignition on or unknown', () => {
    const buses = [
      bus({ id: 'a', tripId: null, ignitionOn: true }),
      bus({ id: 'b', tripId: null, ignitionOn: null }),
    ];
    const standby = deriveStandbyAvailability(buses, now);
    expect(standby.map((s) => s.bus.id)).toEqual(['a', 'b']);
  });

  it('excludes a vehicle on an active trip', () => {
    const standby = deriveStandbyAvailability([bus({ id: 'a', tripId: 'trip-1' })], now);
    expect(standby).toHaveLength(0);
  });

  it('excludes a vehicle with ignition confirmed off', () => {
    const standby = deriveStandbyAvailability([bus({ id: 'a', tripId: null, ignitionOn: false })], now);
    expect(standby).toHaveLength(0);
  });

  it('computes idleMinutes from lastUpdatedAt and sorts most-recently-reporting first', () => {
    const buses = [
      bus({ id: 'stale', tripId: null, lastUpdatedAt: new Date(now - 30 * 60_000).toISOString() }),
      bus({ id: 'fresh', tripId: null, lastUpdatedAt: new Date(now - 2 * 60_000).toISOString() }),
    ];
    const standby = deriveStandbyAvailability(buses, now);
    expect(standby.map((s) => s.bus.id)).toEqual(['fresh', 'stale']);
    expect(standby[0]?.idleMinutes).toBe(2);
    expect(standby[1]?.idleMinutes).toBe(30);
  });

  it('reports a null idleMinutes for an unparseable lastUpdatedAt rather than throwing', () => {
    const standby = deriveStandbyAvailability([bus({ id: 'a', tripId: null, lastUpdatedAt: 'not-a-date' })], now);
    expect(standby[0]?.idleMinutes).toBeNull();
  });
});
