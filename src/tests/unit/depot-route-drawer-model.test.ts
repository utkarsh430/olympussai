import { describe, expect, it } from 'vitest';
import {
  drawerView,
  rateLimitSentence,
  type DrawerRoute,
} from '@/lib/depot/routes/routeDrawerModel';
import type { RouteProfile, RouteStop } from '@/lib/depot/routes/types';

const stop = (sequence: number, name: string, lat: number | null, scheduled: string | null): RouteStop => ({
  name,
  sequence,
  lat,
  lng: lat === null ? null : 80.9,
  scheduled,
});

const PROFILE: RouteProfile = {
  routeName: 'RKD_4560_ORD_OUT',
  routeNameConfirmed: true,
  routeId: '4562',
  description: 'Lucknow to Sitapur',
  direction: 'OUT',
  origin: stop(1, 'Charbagh', 26.8, '08:00:00'),
  destination: stop(3, 'Sitapur', 27.5, '10:30:00'),
  stops: [stop(1, 'Charbagh', 26.8, '08:00:00'), stop(2, 'Bakshi', null, null), stop(3, 'Sitapur', 27.5, '10:30:00')],
  unlocatedStops: 1,
  scheduledDurationMin: 150,
  lengthKm: 80,
  sampledFrom: 'UP32R1',
  operatingDate: '2026-10-06',
};

const ROUTE: DrawerRoute = {
  routeName: 'RKD_4560_ORD_OUT',
  buses: 3,
  operators: [
    { depotId: '101', depotName: 'Alpha', buses: 2 },
    { depotId: '102', depotName: 'Beta', buses: 1 },
  ],
  deadKm: { depotId: '101', perTripKm: 12.34 },
};

describe('drawerView', () => {
  it('lists the real stops in order with times, terminals, duration and unlocated count', () => {
    const view = drawerView({ status: 'ok', profile: PROFILE }, ROUTE, null);
    if (view.status !== 'ok') throw new Error('expected a profile');
    expect(view.stops.map((s) => [s.sequence, s.name, s.time])).toEqual([
      [1, 'Charbagh', '08:00'],
      [2, 'Bakshi', 'No time'],
      [3, 'Sitapur', '10:30'],
    ]);
    expect([view.firstStop, view.lastStop]).toEqual(['Charbagh', 'Sitapur']);
    expect(view.durationLine).toBe('Scheduled trip duration: 2 h 30 min.');
    expect(view.unlocatedLine).toBe('1 of 3 stops has no usable position, so it is left out of distances.');
    expect(view.operatorsLine).toBe('Operated by Alpha (2 buses) and Beta (1 bus).');
    expect(view.busesLine).toBe('3 buses on this route now.');
    expect(view.deadKmLines).toEqual(['From Alpha, its depot now: 12.3 km a trip.']);
  });

  it('adds the recommended depot when the plan moves the route, compared in tenths', () => {
    const move = { toDepotName: 'Beta', fromDeadKmPerTrip: 12.34, toDeadKmPerTrip: 4.05 };
    const view = drawerView({ status: 'ok', profile: PROFILE }, ROUTE, move);
    if (view.status !== 'ok') throw new Error('expected a profile');
    expect(view.deadKmLines).toEqual([
      'From Alpha, its depot now: 12.3 km a trip.',
      'From Beta, the recommended depot: 4.1 km a trip.',
    ]);
  });

  it('says when no stop lacks a position, and when the duration or dead km is unknown', () => {
    const profile = { ...PROFILE, unlocatedStops: 0, scheduledDurationMin: null };
    const view = drawerView({ status: 'ok', profile }, { ...ROUTE, deadKm: null }, null);
    if (view.status !== 'ok') throw new Error('expected a profile');
    expect(view.unlocatedLine).toBe('Every stop has a usable position.');
    expect(view.durationLine).toBe('The schedule gives no trip duration.');
    expect(view.deadKmLines).toEqual([
      'No dead-kilometre figure for its depot yet: it appears once the route table next refreshes, if the depot and both terminals are located.',
    ]);
  });

  it('says a route with no bus today has no profile, and why', () => {
    const view = drawerView({ status: 'unavailable', reason: 'no_bus_on_route' }, ROUTE, null);
    expect(view).toEqual({
      status: 'unavailable',
      sentence:
        'Its profile is unavailable: no bus is assigned to this route today, and stops are read through a bus running it.',
    });
  });
});

describe('rateLimitSentence', () => {
  it('states the retry time from the Retry-After header', () => {
    expect(rateLimitSentence('42')).toBe('Too many route lookups just now. Try again in 42 seconds.');
    expect(rateLimitSentence('1')).toBe('Too many route lookups just now. Try again in 1 second.');
  });

  it('never prints a header it cannot read', () => {
    expect(rateLimitSentence(null)).toBe('Too many route lookups just now. Try again shortly.');
    expect(rateLimitSentence('<b>soon</b>')).toBe('Too many route lookups just now. Try again shortly.');
  });
});
