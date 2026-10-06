import { describe, expect, it } from 'vitest';
import type { OffRoadBus } from '@/lib/depot/maintenance/api';
import {
  bandFigures,
  disclosureItems,
  lastHeardIso,
  sharedOffRoad,
  workshopRows,
} from '@/lib/depot/maintenance/pageModel';
import { workshopLoad } from '@/lib/depot/maintenance/workshop';

const COUNTS = { overdue: 22, due_soon: 10, not_due: 208 };
const bus = (over: Partial<OffRoadBus> = {}): OffRoadBus => ({
  registrationNumber: 'UP1',
  vehicleStatus: 'under_maintenance',
  tripStatus: 'unknown',
  gpsAgeMin: 30,
  flags: [],
  ...over,
});

describe('bandFigures', () => {
  it('is the live figure alone until the model has answered', () => {
    const figures = bandFigures(10, null);
    expect(figures.map((f) => f.label)).toEqual(['Off the road now']);
    expect(figures[0]?.tag).toBeUndefined();
  });

  it('adds overdue and due soon, each tagged MODELLED, the live figure untagged', () => {
    const figures = bandFigures(10, { counts: COUNTS, dueSoonWithinKm: 1500 });
    expect(figures.map((f) => [f.label, f.value, f.tag])).toEqual([
      ['Off the road now', '10', undefined],
      ['Overdue', '22', 'modelled'],
      ['Due soon', '10', 'modelled'],
    ]);
    expect(figures[1]?.caption).toBe('of 240 buses');
    expect(figures[2]?.caption).toBe('within 1,500 km');
  });

  it('never lets a figure that says overdue or due soon go without the tag', () => {
    for (const f of bandFigures(3, { counts: COUNTS, dueSoonWithinKm: 1500 })) {
      if (/overdue|due soon/i.test(f.label)) expect(f.tag).toBe('modelled');
    }
  });
});

describe('sharedOffRoad', () => {
  it('states once what every row shares and drops those columns', () => {
    const shared = sharedOffRoad([bus(), bus({ registrationNumber: 'UP2' })]);
    expect(shared.statement).toBe(
      'Every bus here has feed status Under maintenance and trip status unknown. ' +
        'None reports a device flag.',
    );
    expect(shared.showTripStatus).toBe(false);
    expect(shared.showFlags).toBe(false);
  });

  it('keeps the trip status and flag columns when the rows differ', () => {
    const shared = sharedOffRoad([
      bus(),
      bus({ tripStatus: 'Stationary', flags: ['main power off'] }),
    ]);
    expect(shared.showTripStatus).toBe(true);
    expect(shared.showFlags).toBe(true);
    expect(shared.statement).toBe('Every bus here has feed status Under maintenance.');
  });

  it('says nothing for an empty list', () => {
    expect(sharedOffRoad([]).statement).toBeNull();
  });
});

describe('lastHeardIso', () => {
  it('is the feed clock less the silence, for the shared formatters', () => {
    expect(lastHeardIso('2026-10-06T10:00:00Z', 90)).toBe('2026-10-06T08:30:00.000Z');
  });
  it('is null when either is unknown', () => {
    expect(lastHeardIso(null, 5)).toBeNull();
    expect(lastHeardIso('2026-10-06T10:00:00Z', null)).toBeNull();
    expect(lastHeardIso('not a time', 5)).toBeNull();
  });
});

describe('workshopRows', () => {
  it('uses the live off-road count and tags only the modelled rows', () => {
    const rows = workshopRows(workshopLoad(7, 4));
    expect(rows.map((r) => [r.label, r.value, r.tag])).toEqual([
      ['Bays', '4', 'modelled'],
      ['Off the road', '7', undefined],
      ['Would wait for a bay', '3', 'modelled'],
    ]);
  });
});

describe('disclosureItems', () => {
  it('keeps every truthfulness statement the page used to print before its table', () => {
    const lines = disclosureItems(
      { counts: COUNTS, dueSoonWithinKm: 1500, intervals: ['Ordinary: every 10,000 km'] },
      { n: 31, of: 70 },
    ).flatMap((item) => item.lines);
    const all = lines.join(' ');
    expect(all).toContain("share of buses modelled as overdue is set by the model's assumptions");
    expect(all).toContain('not derived from any record');
    expect(all).toContain('does not advance with the date');
    expect(all).toContain('follow its current route, so re-routing a bus can change its group');
    expect(all).toContain('not for planning services');
    expect(all).toContain('Ordinary: every 10,000 km');
    expect(all).toContain("The feed's distance field is not used on this page");
    expect(all).toContain('only 31 of 70 buses');
    expect(all).toContain('Nothing here is written back to any system');
  });
});
