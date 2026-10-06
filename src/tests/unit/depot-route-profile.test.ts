import { describe, expect, it } from 'vitest';
import { buildRouteProfile } from '@/lib/depot/routes/routeProfile';
import { terminalsOf } from '@/lib/depot/routes/deadKm';
import { haversineKm } from '@/lib/depot/infer/geo';
import type { CanonicalSchedule, CanonicalStop } from '@/models/canonical';
import { VND_1613_MISLOCATED, VND_1613_SCHEDULE } from './depot-route-vnd-1613.fixtures';

const DATE = '2026-10-06';

function stop(
  sequence: number,
  lat: number | null,
  lng: number | null,
  time: string | null,
  name = `Stop ${sequence}`,
): CanonicalStop {
  return {
    id: `s-${sequence}`,
    name,
    sequence,
    latitude: lat,
    longitude: lng,
    scheduledArrival: time,
    scheduledDeparture: time,
  };
}

function schedule(stops: readonly CanonicalStop[]): CanonicalSchedule {
  return {
    registrationNumber: 'UP78JT4102',
    date: DATE,
    routeId: '4562',
    routeName: 'RKD_4560_ORD_OUT',
    originName: null,
    destinationName: null,
    tripId: '30396',
    scheduledDeparture: null,
    scheduledArrival: null,
    direction: 'OUT',
    tripCount: 1,
    stops: [...stops],
  };
}

describe('buildRouteProfile', () => {
  it('takes origin and destination by sequence and records provenance', () => {
    const profile = buildRouteProfile(
      schedule([
        stop(3, 28.5, 79.5, '12:00:00', 'C'),
        stop(1, 28.0, 79.0, '10:00:00', 'A'),
        stop(2, 28.2, 79.2, '11:00:00', 'B'),
      ]),
      'UP78JT4102',
      DATE,
    );
    expect(profile.origin?.name).toBe('A');
    expect(profile.destination?.name).toBe('C');
    expect(profile.stops.map((s) => s.sequence)).toEqual([1, 2, 3]);
    expect(profile.sampledFrom).toBe('UP78JT4102');
    expect(profile.operatingDate).toBe(DATE);
    expect(profile.routeId).toBe('4562');
    expect(profile.direction).toBe('OUT');
    expect(profile.scheduledDurationMin).toBe(120);
  });

  it('sums straight-line legs rounded to one decimal', () => {
    // One degree of latitude is about 111.2 km.
    const profile = buildRouteProfile(
      schedule([stop(1, 28.0, 79.0, null), stop(2, 29.0, 79.0, null)]),
      'X',
      DATE,
    );
    expect(profile.lengthKm).toBeCloseTo(111.2, 1);
    expect(Number.isInteger((profile.lengthKm ?? 0) * 10)).toBe(true);
  });

  it('skips unlocated stops for length but counts them and keeps them as terminals', () => {
    const profile = buildRouteProfile(
      schedule([
        // 111 km between the located stops in 90 minutes: a pace the timetable allows.
        stop(1, null, null, '09:00:00', 'Unsurveyed start'),
        stop(2, 28.0, 79.0, '09:30:00'),
        stop(3, null, null, '10:15:00'),
        stop(4, 29.0, 79.0, '11:00:00'),
        stop(5, null, null, '11:30:00', 'Unsurveyed end'),
      ]),
      'X',
      DATE,
    );
    expect(profile.unlocatedStops).toBe(3);
    expect(profile.mislocatedStops).toBe(0);
    expect(profile.origin?.name).toBe('Unsurveyed start');
    expect(profile.destination?.name).toBe('Unsurveyed end');
    expect(profile.lengthKm).toBeCloseTo(111.2, 1);
    expect(profile.stops).toHaveLength(5);
  });

  it('gives a null length, never zero or NaN, with fewer than two located stops', () => {
    const none = buildRouteProfile(
      schedule([stop(1, null, null, null), stop(2, null, null, null)]),
      'X',
      DATE,
    );
    expect(none.lengthKm).toBeNull();
    expect(none.unlocatedStops).toBe(2);
    const one = buildRouteProfile(
      schedule([stop(1, 28.0, 79.0, null), stop(2, null, null, null)]),
      'X',
      DATE,
    );
    expect(one.lengthKm).toBeNull();
  });

  it('treats a half-located stop as unlocated', () => {
    const profile = buildRouteProfile(
      schedule([stop(1, 28.0, null, null), stop(2, 29.0, 79.0, null)]),
      'X',
      DATE,
    );
    expect(profile.unlocatedStops).toBe(1);
    expect(profile.lengthKm).toBeNull();
    expect(profile.stops[0]?.lat).toBeNull();
  });

  it('adds a day to an overnight duration so it is positive', () => {
    const profile = buildRouteProfile(
      schedule([stop(1, 28.0, 79.0, '22:30:00'), stop(2, 29.0, 79.0, '05:15:00')]),
      'X',
      DATE,
    );
    expect(profile.scheduledDurationMin).toBe(6 * 60 + 45);
  });

  it('gives a null duration when either end time is missing or unparsable', () => {
    for (const [a, b] of [
      [null, '10:00:00'],
      ['10:00:00', null],
      ['soon', '10:00:00'],
      ['25:00:00', '10:00:00'],
    ] as const) {
      const profile = buildRouteProfile(
        schedule([stop(1, 28.0, 79.0, a), stop(2, 29.0, 79.0, b)]),
        'X',
        DATE,
      );
      expect(profile.scheduledDurationMin).toBeNull();
    }
  });

  it('yields an empty, NaN-free profile for a schedule with no stops', () => {
    const profile = buildRouteProfile(schedule([]), 'X', DATE);
    expect(profile.origin).toBeNull();
    expect(profile.destination).toBeNull();
    expect(profile.stops).toEqual([]);
    expect(profile.lengthKm).toBeNull();
    expect(profile.scheduledDurationMin).toBeNull();
    expect(profile.unlocatedStops).toBe(0);
  });

  it('leaves the four far-off stops of the recorded route out of its length and terminals', () => {
    const profile = buildRouteProfile(VND_1613_SCHEDULE, 'UP64AT0001', DATE);
    // Before the timetable check the straight lines through them summed to 1,697.5 km.
    expect(profile.mislocatedStops).toBe(4);
    expect(profile.unlocatedStops).toBe(8);
    expect(profile.lengthKm).toBe(195.6);
    expect(profile.lengthKm).toBeGreaterThan(150);
    expect(profile.lengthKm).toBeLessThan(250);
    expect(profile.origin?.name).toBe('VINDHYANAGAR');
    expect(profile.destination?.name).toBe('VARANASI CANT');
    const terminals = terminalsOf(profile);
    expect(terminals?.first.name).toBe('VINDHYANAGAR');
    expect(terminals?.last.name).toBe('VARANASI CANT');
    expect(terminals?.approximated).toBe(false);
    // Every stop stays in the list with its name and time; a far-off one has no position.
    expect(profile.stops).toHaveLength(37);
    const far = profile.stops.filter((s) => VND_1613_MISLOCATED.includes(s.name));
    expect(far.map((s) => [s.lat, s.lng])).toEqual(far.map(() => [null, null]));
    expect(far.map((s) => s.scheduled)).toEqual(['13:05:59', '18:00:13', '18:29:02', '20:09:52']);
    expect(profile.stops.filter((s) => s.lat !== null)).toHaveLength(25);
  });

  it('moves a terminal to the nearest kept stop when the first or last stop is far off', () => {
    const line = [
      stop(2, 25.1, 82, '10:10', 'Second'),
      stop(3, 25.2, 82, '10:20', 'Third'),
      stop(4, 25.3, 82, '10:30', 'Fourth'),
    ];
    const farFirst = buildRouteProfile(
      schedule([stop(1, 27.5, 79.0, '10:00', 'Same name elsewhere'), ...line]),
      'X',
      DATE,
    );
    expect(farFirst.mislocatedStops).toBe(1);
    expect(farFirst.unlocatedStops).toBe(0);
    expect(farFirst.origin?.name).toBe('Same name elsewhere');
    expect(farFirst.origin?.lat).toBeNull();
    expect(terminalsOf(farFirst)?.first.name).toBe('Second');
    expect(farFirst.lengthKm).toBeCloseTo(22.2, 1);
    const farLast = buildRouteProfile(
      schedule([...line, stop(5, 27.5, 79.0, '10:40', 'Same name elsewhere')]),
      'X',
      DATE,
    );
    expect(farLast.mislocatedStops).toBe(1);
    expect(terminalsOf(farLast)?.last.name).toBe('Fourth');
    expect(farLast.lengthKm).toBeCloseTo(22.2, 1);
  });

  it('keeps a good stop between two far-off ones', () => {
    const profile = buildRouteProfile(
      schedule([
        stop(1, 25.0, 82, '10:00'),
        stop(2, 27.5, 79, '10:05'),
        stop(3, 25.1, 82, '10:10', 'Good'),
        stop(4, 23.0, 85, '10:15'),
        stop(5, 25.2, 82, '10:20'),
      ]),
      'X',
      DATE,
    );
    expect(profile.mislocatedStops).toBe(2);
    expect(profile.stops.find((s) => s.name === 'Good')?.lat).toBe(25.1);
    expect(profile.lengthKm).toBeCloseTo(22.2, 1);
  });

  it('gives exactly the plain straight-line length and terminals when every stop fits', () => {
    const stops = [
      stop(1, 28.0, 79.0, '10:00:00', 'A'),
      stop(2, 28.2, 79.2, '11:00:00', 'B'),
      stop(3, 28.5, 79.5, '12:00:00', 'C'),
    ];
    const profile = buildRouteProfile(schedule(stops), 'X', DATE);
    const plain = haversineKm(28.0, 79.0, 28.2, 79.2) + haversineKm(28.2, 79.2, 28.5, 79.5);
    expect(profile.mislocatedStops).toBe(0);
    expect(profile.lengthKm).toBe(Math.round(plain * 10) / 10);
    expect(profile.stops.map((s) => [s.lat, s.lng])).toEqual([
      [28.0, 79.0],
      [28.2, 79.2],
      [28.5, 79.5],
    ]);
    expect(terminalsOf(profile)).toMatchObject({ approximated: false });
  });

  it('falls back to too few located stops when no two positions fit together', () => {
    const profile = buildRouteProfile(
      schedule([stop(1, 25, 80, '10:00'), stop(2, 25, 82.5, '10:05'), stop(3, 25, 85, '10:10')]),
      'X',
      DATE,
    );
    expect(profile.mislocatedStops).toBe(3);
    expect(profile.lengthKm).toBeNull();
    expect(terminalsOf(profile)).toBeNull();
    expect(profile.stops).toHaveLength(3);
  });

  it('does not mutate the schedule it reads', () => {
    const input = schedule([stop(2, 29.0, 79.0, null), stop(1, 28.0, 79.0, null)]);
    const before = JSON.stringify(input);
    buildRouteProfile(input, 'X', DATE);
    expect(JSON.stringify(input)).toBe(before);
  });
});
