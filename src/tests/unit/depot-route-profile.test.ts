import { describe, expect, it } from 'vitest';
import { buildRouteProfile } from '@/lib/depot/routes/routeProfile';
import type { CanonicalSchedule, CanonicalStop } from '@/models/canonical';

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
        stop(1, null, null, '09:00:00', 'Unsurveyed start'),
        stop(2, 28.0, 79.0, '09:30:00'),
        stop(3, null, null, '09:45:00'),
        stop(4, 29.0, 79.0, '10:00:00'),
        stop(5, null, null, '10:30:00', 'Unsurveyed end'),
      ]),
      'X',
      DATE,
    );
    expect(profile.unlocatedStops).toBe(3);
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

  it('does not mutate the schedule it reads', () => {
    const input = schedule([stop(2, 29.0, 79.0, null), stop(1, 28.0, 79.0, null)]);
    const before = JSON.stringify(input);
    buildRouteProfile(input, 'X', DATE);
    expect(JSON.stringify(input)).toBe(before);
  });
});
