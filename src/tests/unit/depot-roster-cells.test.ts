import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import {
  lastHeardCell,
  locationShortText,
  scheduleCell,
  showRunningColumn,
} from '@/lib/depot/roster/rosterCells';
import { buildRosterRows } from '@/lib/depot/roster/rosterModel';
import {
  ROSTER_COLUMN_WIDTHS,
  ROSTER_PHONE_COLUMNS,
  rosterColumnKeys,
  rosterWidthSum,
} from '@/lib/depot/roster/rosterColumns';

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
    expect(cell.text).toBe('Mon 05 Oct, 13:46');
    expect(cell.earlierDay).toBe(true);
    expect(cell.title).toContain('Mon 05 Oct, 13:46');
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

describe('the RUNNING column', () => {
  it('is dropped when no row has a value', () => {
    expect(showRunningColumn(buildRosterRows([bus(), bus({ registrationNumber: 'B' })]))).toBe(false);
  });
  it('stays when any row has one', () => {
    const rows = buildRosterRows([bus(), bus({ registrationNumber: 'B', delayMinutes: 6 })]);
    expect(showRunningColumn(rows)).toBe(true);
  });
});

describe('column widths', () => {
  it('lists the desktop columns, with RUNNING only when shown', () => {
    expect(rosterColumnKeys({ phone: false, running: false })).toEqual([
      'registration',
      'state',
      'location',
      'route',
      'start',
      'heard',
      'flags',
    ]);
    expect(rosterColumnKeys({ phone: false, running: true })).toContain('running');
  });
  it('fits the 1440 frame (1190px of content inside the borders) with every column', () => {
    expect(rosterWidthSum({ phone: false, running: true })).toBeLessThanOrEqual(1176);
  });
  it('gives FLAGS 120px', () => {
    expect(ROSTER_COLUMN_WIDTHS.flags).toBe(120);
  });
  it('keeps the phone set to registration, state and location, inside 358px', () => {
    expect(ROSTER_PHONE_COLUMNS).toEqual(['registration', 'state', 'location']);
    expect(rosterWidthSum({ phone: true, running: true })).toBeLessThanOrEqual(358);
  });
});
