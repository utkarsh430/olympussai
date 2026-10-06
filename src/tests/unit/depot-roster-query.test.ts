import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import {
  DEFAULT_ROSTER_FILTERS,
  buildRosterRows,
  filterRosterRows,
  notHeardText,
  scheduleText,
} from '@/lib/depot/roster/rosterModel';
import { busLocationText } from '@/lib/depot/infer/locationText';
import { drawerFacts } from '@/lib/depot/roster/drawerFacts';
import {
  parseRosterQuery,
  rosterFilterHref,
  rosterQueryString,
} from '@/lib/depot/roster/rosterQuery';

function params(query: string): (key: string) => string | null {
  const search = new URLSearchParams(query);
  return (key) => search.get(key);
}

function bus(overrides: Partial<DepotBusView>): DepotBusView {
  return {
    registrationNumber: 'UP1',
    state: 'standing',
    location: 'in_yard',
    otherDepotId: null,
    distanceFromYardKm: null,
    latitude: null,
    longitude: null,
    speedKmph: 0,
    gpsAgeMin: 1,
    vehicleStatus: 'stationary',
    tripStatus: null,
    routeName: null,
    routeDescription: null,
    journeyId: null,
    journeyCode: null,
    scheduledStart: null,
    scheduledEnd: null,
    tripDate: null,
    delayMinutes: null,
    mainPowerOn: true,
    tamperCode: null,
    notHeardMin: null,
    ...overrides,
  } as DepotBusView;
}

describe('parseRosterQuery', () => {
  it('gives the defaults for an empty query', () => {
    expect(parseRosterQuery(params(''))).toEqual(DEFAULT_ROSTER_FILTERS);
  });

  it('reads every filter', () => {
    expect(parseRosterQuery(params('state=dark,off_road&location=away&route=1&q=UP13&flag=power_off'))).toEqual({
      states: ['dark', 'off_road'],
      location: 'away',
      hasRouteOnly: true,
      search: 'UP13',
      flag: 'power_off',
    });
  });

  it('drops unknown values instead of trusting them', () => {
    expect(parseRosterQuery(params('state=dark,flying,dark&location=moon&route=yes&flag=x'))).toEqual({
      ...DEFAULT_ROSTER_FILTERS,
      states: ['dark'],
    });
  });

  it('keeps the states in display order and caps a long search', () => {
    const filters = parseRosterQuery(params(`state=off_road,in_service&q=${'a'.repeat(200)}`));
    expect(filters.states).toEqual(['in_service', 'off_road']);
    expect(filters.search.length).toBe(64);
  });
});

describe('rosterQueryString', () => {
  it('is empty for the defaults', () => {
    expect(rosterQueryString(DEFAULT_ROSTER_FILTERS, null)).toBe('');
  });

  it('round-trips through the parser, keeping an open bus', () => {
    const filters = { ...DEFAULT_ROSTER_FILTERS, states: ['dark' as const], flag: 'not_heard' as const, search: 'up 1' };
    const query = rosterQueryString(filters, 'UP 1');
    expect(query.startsWith('?')).toBe(true);
    expect(parseRosterQuery(params(query.slice(1)))).toEqual(filters);
    expect(new URLSearchParams(query.slice(1)).get('bus')).toBe('UP 1');
  });

  it('builds a link to a filtered roster', () => {
    expect(rosterFilterHref('49', { states: ['off_road'] })).toBe('/project/depots/d/49/roster?state=off_road');
    expect(rosterFilterHref('49', { flag: 'power_off' })).toBe('/project/depots/d/49/roster?flag=power_off');
  });
});

describe('roster flag filter', () => {
  const rows = buildRosterRows([
    bus({ registrationNumber: 'A', mainPowerOn: false }),
    bus({ registrationNumber: 'B', notHeardMin: 87 }),
    bus({ registrationNumber: 'C', tamperCode: '7' }),
    bus({ registrationNumber: 'D' }),
  ]);
  const only = (flag: 'power_off' | 'not_heard' | 'tamper'): string[] =>
    filterRosterRows(rows, { ...DEFAULT_ROSTER_FILTERS, flag }).map((r) => r.bus.registrationNumber);

  it('keeps only the buses carrying the flag', () => {
    expect(only('power_off')).toEqual(['A']);
    expect(only('not_heard')).toEqual(['B']);
    expect(only('tamper')).toEqual(['C']);
  });
});

describe('drawerFacts', () => {
  it('words location as the row does, formats times and carries no tag', () => {
    const [row] = buildRosterRows([
      bus({ location: 'away', distanceFromYardKm: 14.2, scheduledStart: '2026-10-05T08:51:00.000Z', notHeardMin: 87 }),
    ]);
    const facts = drawerFacts(row!);
    const value = (label: string): string | undefined => facts.find((f) => f.label === label)?.value;
    expect(value('Location')).toBe(busLocationText(row!.bus));
    expect(value('Location')).toBe('Away, 14 km from yard');
    expect(value('Scheduled start')).toBe('Mon 05 Oct, 08:51');
    expect(value('State')).toBe('Standing; not heard 87 min');
    expect(JSON.stringify(facts)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(facts.every((f) => !('provenance' in f))).toBe(true);
  });
});

describe('roster times and words', () => {
  const FEED_NOW = '2026-10-05T14:00:00.000Z';

  it('shows a schedule on the feed date as a time, another day with its date, never ISO', () => {
    expect(scheduleText('2026-10-05T08:51:00.000Z', FEED_NOW)).toBe('08:51');
    expect(scheduleText('2026-10-04T08:51:00.000Z', FEED_NOW)).toBe('Sun 04 Oct, 08:51');
    expect(scheduleText(null, FEED_NOW)).toBe('—');
  });

  it('words a bus not heard for a while', () => {
    expect(notHeardText(bus({ notHeardMin: 87 }))).toBe('not heard 87 min');
    expect(notHeardText(bus({ notHeardMin: 200 }))).toBe('not heard 3 h');
    expect(notHeardText(bus({ notHeardMin: null }))).toBeNull();
    expect(notHeardText(bus({ notHeardMin: undefined }))).toBeNull();
  });
});
