import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import {
  DEFAULT_ROSTER_FILTERS,
  buildRosterRows,
  countByState,
  deviceFlags,
  delayText,
  filterRosterRows,
  lastHeardText,
} from '@/lib/depot/roster/rosterModel';

function bus(overrides: Partial<DepotBusView> = {}): DepotBusView {
  return {
    registrationNumber: 'MH12AB1000',
    state: 'in_service',
    location: 'away',
    otherDepotId: null,
    distanceFromYardKm: 12,
    latitude: 19,
    longitude: 73,
    speedKmph: 30,
    gpsAgeMin: 1,
    vehicleStatus: 'moving',
    tripStatus: null,
    routeName: 'Pune - Satara',
    routeDescription: null,
    journeyId: null,
    journeyCode: null,
    scheduledStart: null,
    scheduledEnd: null,
    tripDate: null,
    delayMinutes: null,
    mainPowerOn: true,
    tamperCode: null,
    ...overrides,
  } as DepotBusView;
}

const FLEET: readonly DepotBusView[] = [
  bus({ registrationNumber: 'MH12CC3', state: 'dark', location: 'in_yard', routeName: null }),
  bus({ registrationNumber: 'MH12BB2', state: 'in_service', location: 'away' }),
  bus({ registrationNumber: 'MH12AA1', state: 'in_service', location: 'in_yard' }),
  bus({ registrationNumber: 'MH12DD4', state: 'off_road', location: 'unknown', routeName: null }),
  bus({ registrationNumber: 'MH12EE5', state: 'standing', location: 'in_yard', routeName: null }),
  bus({ registrationNumber: 'MH12FF6', state: 'on_road', location: 'away', routeName: 'Mumbai' }),
];

describe('buildRosterRows order', () => {
  it('orders by state, then registration', () => {
    const order = buildRosterRows(FLEET).map((row) => row.bus.registrationNumber);
    expect(order).toEqual(['MH12AA1', 'MH12BB2', 'MH12FF6', 'MH12EE5', 'MH12CC3', 'MH12DD4']);
  });
  it('does not mutate its input', () => {
    const input = Object.freeze([...FLEET]);
    buildRosterRows(input);
    expect(input.map((b) => b.registrationNumber)).toEqual(FLEET.map((b) => b.registrationNumber));
  });
  it('is empty for an empty roster', () => {
    expect(buildRosterRows([])).toEqual([]);
    expect(countByState([])).toEqual({
      in_service: 0,
      on_road: 0,
      standing: 0,
      dark: 0,
      off_road: 0,
    });
  });
});

describe('countByState', () => {
  it('counts every state on the unfiltered list', () => {
    expect(countByState(FLEET)).toEqual({
      in_service: 2,
      on_road: 1,
      standing: 1,
      dark: 1,
      off_road: 1,
    });
  });
});

describe('filterRosterRows', () => {
  const rows = buildRosterRows(FLEET);
  const regs = (filters: Partial<typeof DEFAULT_ROSTER_FILTERS>): string[] =>
    filterRosterRows(rows, { ...DEFAULT_ROSTER_FILTERS, ...filters }).map(
      (row) => row.bus.registrationNumber,
    );

  it('keeps everything by default', () => {
    expect(regs({})).toHaveLength(6);
  });
  it('filters by any of several states', () => {
    expect(regs({ states: ['dark', 'off_road'] })).toEqual(['MH12CC3', 'MH12DD4']);
  });
  it('filters by location', () => {
    expect(regs({ location: 'in_yard' })).toEqual(['MH12AA1', 'MH12EE5', 'MH12CC3']);
  });
  it('filters to buses that have a route', () => {
    expect(regs({ hasRouteOnly: true })).toEqual(['MH12AA1', 'MH12BB2', 'MH12FF6']);
  });
  it('searches registration case-insensitively', () => {
    expect(regs({ search: 'mh12bb' })).toEqual(['MH12BB2']);
  });
  it('searches route name case-insensitively', () => {
    expect(regs({ search: 'MUMBAI' })).toEqual(['MH12FF6']);
  });
  it('ignores surrounding whitespace in the search', () => {
    expect(regs({ search: '  mumbai ' })).toEqual(['MH12FF6']);
  });
  it('combines filters', () => {
    expect(regs({ states: ['in_service'], location: 'away', search: 'pune' })).toEqual([
      'MH12BB2',
    ]);
  });
  it('can yield nothing', () => {
    expect(regs({ search: 'zzz' })).toEqual([]);
  });
});

describe('lastHeardText', () => {
  it.each([
    [null, 'unknown'],
    [0, 'just now'],
    [0.9, 'just now'],
    [1, '1 min ago'],
    [119, '119 min ago'],
    [120, '2 h ago'],
    [2879, '47 h ago'],
    [2880, '2 days ago'],
    [14400, '10 days ago'],
  ])('%s -> %s', (age, text) => {
    expect(lastHeardText(age)).toBe(text);
  });
  it('treats a non-finite age as unknown', () => {
    expect(lastHeardText(Number.NaN)).toBe('unknown');
  });
});

describe('deviceFlags', () => {
  it('is empty for a healthy device', () => {
    expect(deviceFlags(bus())).toEqual([]);
  });
  it('flags main power off, not an unknown power state', () => {
    expect(deviceFlags(bus({ mainPowerOn: false }))).toEqual(['Main power off']);
    expect(deviceFlags(bus({ mainPowerOn: null }))).toEqual([]);
  });
  it('shows a tamper code raw, with no meaning claimed', () => {
    expect(deviceFlags(bus({ tamperCode: 'T7' }))).toEqual(['Tamper code T7']);
  });
  it('omits the feed code for a normal device', () => {
    expect(deviceFlags(bus({ tamperCode: 'C' }))).toEqual([]);
  });
  it('lists both', () => {
    expect(deviceFlags(bus({ mainPowerOn: false, tamperCode: 'X' }))).toEqual([
      'Main power off',
      'Tamper code X',
    ]);
  });
});

describe('delayText', () => {
  it.each([
    [null, null],
    [4, '4 min late'],
    [2, '2 min late'],
    [1, 'on time'],
    [0, 'on time'],
    [-1, 'on time'],
    [-2, '2 min early'],
  ])('%s -> %s', (delay, text) => {
    expect(delayText(delay)).toBe(text);
  });
});
