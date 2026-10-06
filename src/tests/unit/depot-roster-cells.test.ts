import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import {
  lastHeardCell,
  locationShortText,
  scheduleCell,
} from '@/lib/depot/roster/rosterCells';
import {
  ROSTER_TIER_FRAME_PX,
  ROSTER_TIER_WIDTHS,
  rosterColumnKeys,
  rosterColumnWidth,
  rosterShortLocation,
  rosterTier,
  type RosterTier,
} from '@/lib/depot/roster/rosterColumns';
import { tableWidth } from '@/lib/depot/shell/tableWidth';

const rosterWidthSum = (tier: RosterTier): number =>
  tableWidth(ROSTER_TIER_WIDTHS[tier], rosterColumnKeys(tier));

const FEED_NOW = '2026-10-06T09:30:00.000Z';

function bus(overrides: Partial<DepotBusView> = {}): DepotBusView {
  return {
    registrationNumber: 'UP14AB1000',
    state: 'on_road',
    location: 'away',
    otherDepotId: null,
    distanceFromYardKm: 34.4,
    latitude: null,
    longitude: null,
    speedKmph: null,
    gpsAgeMin: 2,
    vehicleStatus: 'moving',
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
    ...overrides,
  } as DepotBusView;
}

describe('lastHeardCell', () => {
  it('never prints raw minutes above an hour', () => {
    expect(lastHeardCell(bus({ gpsAgeMin: 87 })).text).toBe('1 h 27 min ago');
    expect(lastHeardCell(bus({ gpsAgeMin: 59 })).text).toBe('59 min ago');
    expect(lastHeardCell(bus({ gpsAgeMin: 0.4 })).text).toBe('just now');
    expect(lastHeardCell(bus({ gpsAgeMin: 19920 })).text).toBe('13 d 20 h ago');
    expect(lastHeardCell(bus({ gpsAgeMin: null })).text).toBe('unknown');
  });
  it('words an on-road bus unheard past the recency rule, in the warning tone', () => {
    const cell = lastHeardCell(bus({ state: 'on_road', gpsAgeMin: 192, notHeardMin: 192 }));
    expect(cell).toEqual({ text: 'not heard 3 h 12 min', warning: true });
  });
  it('is quiet for a bus heard recently', () => {
    expect(lastHeardCell(bus({ notHeardMin: null })).warning).toBe(false);
  });
});

describe('scheduleCell', () => {
  it('shows the time alone for the feed date', () => {
    const cell = scheduleCell('2026-10-06T08:51:00.000Z', FEED_NOW);
    expect(cell).toMatchObject({ text: '08:51', earlierDay: false });
  });
  it('keeps an earlier day, with its date, muted, and says why in the title', () => {
    const cell = scheduleCell('2026-10-05T13:46:00.000Z', FEED_NOW);
    expect(cell.text).toBe('5 Oct 2026, 13:46');
    expect(cell.earlierDay).toBe(true);
    expect(cell.title).toContain('5 Oct 2026, 13:46');
    expect(cell.title).toContain("earlier day's schedule for this bus");
  });
  it('is a dash with no schedule', () => {
    expect(scheduleCell(null, FEED_NOW)).toMatchObject({ text: '—', earlierDay: false });
  });
});

describe('locationShortText', () => {
  it.each([
    [{ location: 'in_yard', distanceFromYardKm: null }, 'Yard'],
    [{ location: 'at_other_yard', distanceFromYardKm: null }, 'Other depot'],
    [{ location: 'away', distanceFromYardKm: 34.4 }, '34 km'],
    [{ location: 'away', distanceFromYardKm: null }, 'Away'],
    [{ location: 'unknown', distanceFromYardKm: null }, 'Unknown'],
  ] as const)('%j -> %s', (partial, text) => {
    expect(locationShortText(bus(partial))).toBe(text);
  });
});

describe('column sets and widths per tier', () => {
  const tiers: readonly RosterTier[] = ['wide', 'desk', 'medium', 'narrow', 'phone'];

  it.each(tiers)("%s: the widths sum inside the frame at the tier's narrowest viewport", (tier) => {
    expect(rosterWidthSum(tier)).toBeLessThanOrEqual(ROSTER_TIER_FRAME_PX[tier]);
  });
  it('pins the sums written in the report', () => {
    expect(tiers.map((tier) => rosterWidthSum(tier))).toEqual([1048, 888, 880, 516, 324]);
  });
  it('leaves room to spare at 1440 (it overflowed by 10px)', () => {
    expect(ROSTER_TIER_FRAME_PX.wide - rosterWidthSum('wide')).toBeGreaterThanOrEqual(100);
  });
  it('never shows RUNNING, and gives FLAGS 120px at 1440', () => {
    for (const tier of tiers) expect(rosterColumnKeys(tier)).not.toContain('running');
    expect(rosterColumnWidth('flags', 'wide')).toBe(120);
  });
  it('gives every column at 1280 the width it has at 1440, so a typical value is not cut', () => {
    for (const key of rosterColumnKeys('desk')) {
      expect(rosterColumnWidth(key, 'desk')).toBeGreaterThanOrEqual(rosterColumnWidth(key, 'wide'));
    }
  });
  it('shows every column from 1440, and moves SCHEDULED START to the drawer below it', () => {
    const all = ['registration', 'state', 'location', 'route', 'start', 'heard', 'flags'];
    expect(rosterColumnKeys('wide')).toEqual(all);
    expect(rosterColumnKeys('desk')).toEqual(rosterColumnKeys('medium'));
    expect(rosterColumnKeys('medium')).toEqual([
      'registration',
      'state',
      'location',
      'route',
      'heard',
      'flags',
    ]);
  });
  it('keeps LAST HEARD at 1024 and 800, with LOCATION short below 1024', () => {
    expect(rosterColumnKeys('narrow')).toEqual(['registration', 'state', 'location', 'heard']);
    expect(rosterShortLocation('medium')).toBe(false);
    expect(rosterShortLocation('narrow')).toBe(true);
    expect(rosterShortLocation('phone')).toBe(true);
  });
  it('keeps the phone set to registration, state and short location', () => {
    expect(rosterColumnKeys('phone')).toEqual(['registration', 'state', 'location']);
  });
  it.each([
    [1440, 'wide'],
    [1439, 'desk'],
    [1280, 'desk'],
    [1279, 'medium'],
    [1024, 'medium'],
    [1023, 'narrow'],
    [800, 'narrow'],
    [640, 'narrow'],
    [639, 'phone'],
    [390, 'phone'],
  ] as const)('a %ipx viewport is the %s tier', (px, tier) => {
    expect(rosterTier(px)).toBe(tier);
  });
});

