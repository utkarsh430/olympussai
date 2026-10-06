import { describe, expect, it } from 'vitest';
import type { RouteProfile, RouteStop } from '@/lib/depot/routes/types';
import { deadKmFor, terminalsOf } from '@/lib/depot/routes/deadKm';
import { haversineKm } from '@/lib/depot/infer/geo';

function stop(sequence: number, lat: number | null, lng: number | null, name = `S${sequence}`) {
  return { name, sequence, lat, lng, scheduled: null } satisfies RouteStop;
}

function profile(stops: readonly RouteStop[], confirmed = true): RouteProfile {
  return {
    routeName: 'ORD_A_B',
    routeNameConfirmed: confirmed,
    routeId: null,
    description: null,
    direction: null,
    origin: stops[0] ?? null,
    destination: stops[stops.length - 1] ?? null,
    stops,
    unlocatedStops: stops.filter((s) => s.lat === null).length,
    scheduledDurationMin: null,
    lengthKm: null,
    sampledFrom: 'UP00',
    operatingDate: '2026-10-06',
  };
}

const YARD = { lat: 26.8, lng: 80.9 };

describe('terminalsOf', () => {
  it('uses first and last by sequence when both are located, whatever the array order', () => {
    const stops = [stop(3, 26.9, 81.0), stop(1, 26.8, 80.8), stop(2, 26.85, 80.9)];
    const t = terminalsOf(profile(stops));
    expect(t).toMatchObject({ approximated: false });
    expect(t?.first.name).toBe('S1');
    expect(t?.last.name).toBe('S3');
  });

  it('steps inward from an unlocated end and says so', () => {
    const stops = [
      stop(1, null, null),
      stop(2, 26.8, 80.8),
      stop(3, 26.9, 81.0),
      stop(4, 26.95, 81.1),
      stop(5, null, null),
    ];
    const t = terminalsOf(profile(stops));
    expect(t?.first.name).toBe('S2');
    expect(t?.last.name).toBe('S4');
    expect(t?.approximated).toBe(true);
  });

  it('treats a (0, 0) stop as unlocated', () => {
    const stops = [stop(1, 0, 0), stop(2, 26.8, 80.8), stop(3, 26.9, 81.0)];
    const t = terminalsOf(profile(stops));
    expect(t?.first.name).toBe('S2');
    expect(t?.approximated).toBe(true);
  });

  it('is null with fewer than two located stops', () => {
    expect(terminalsOf(profile([]))).toBeNull();
    expect(terminalsOf(profile([stop(1, 26.8, 80.8)]))).toBeNull();
    expect(terminalsOf(profile([stop(1, 26.8, 80.8), stop(2, null, null)]))).toBeNull();
  });

  it('is null when both terminals would be the same stop', () => {
    const stops = [stop(1, null, null), stop(2, 26.8, 80.8), stop(3, null, null)];
    expect(terminalsOf(profile(stops))).toBeNull();
  });

  it('does not mutate the profile', () => {
    const stops = Object.freeze([stop(2, 26.9, 81.0), stop(1, 26.8, 80.8)]);
    expect(() => terminalsOf(Object.freeze(profile(stops)))).not.toThrow();
  });
});

describe('deadKmFor', () => {
  const stops = [stop(1, 26.9, 80.9, 'North'), stop(2, 26.85, 80.95), stop(3, 26.8, 81.1, 'East')];

  it('measures yard to first stop and last stop to yard in whole metres, then to 0.1 km', () => {
    const detour = 1.3;
    const dead = deadKmFor(YARD, profile(stops), detour);
    const outM = Math.round(haversineKm(YARD.lat, YARD.lng, 26.9, 80.9) * 1000 * detour);
    const inM = Math.round(haversineKm(26.8, 81.1, YARD.lat, YARD.lng) * 1000 * detour);
    expect(dead).not.toBeNull();
    expect(dead!.outKm).toBe(Math.round(outM / 100) / 10);
    expect(dead!.inKm).toBe(Math.round(inM / 100) / 10);
    expect(dead!.perTripKm).toBe((Math.round(outM / 100) + Math.round(inM / 100)) / 10);
    expect(dead!.firstStopUsed).toBe('North');
    expect(dead!.lastStopUsed).toBe('East');
    expect(dead!.approximated).toBe(false);
  });

  it('carries no float residue: every figure is a multiple of 0.1 that prints cleanly', () => {
    const dead = deadKmFor(YARD, profile(stops), 1.3)!;
    for (const km of [dead.outKm, dead.inKm, dead.perTripKm]) {
      expect(String(km)).toBe(km.toFixed(1).replace(/\.0$/, ''));
    }
  });

  it('is zero out when the yard sits on the first stop', () => {
    const dead = deadKmFor({ lat: 26.9, lng: 80.9 }, profile(stops), 1.3)!;
    expect(dead.outKm).toBe(0);
  });

  it('flags approximation when a nearest located stop stood in', () => {
    const withGap = [stop(1, null, null), ...stops.map((s) => ({ ...s, sequence: s.sequence + 1 }))];
    expect(deadKmFor(YARD, profile(withGap), 1.3)?.approximated).toBe(true);
  });

  it('still computes for an unconfirmed route name', () => {
    expect(deadKmFor(YARD, profile(stops, false), 1.3)).not.toBeNull();
  });

  it('is null without two usable terminals or with an unusable yard or factor', () => {
    expect(deadKmFor(YARD, profile([stop(1, 26.9, 80.9)]), 1.3)).toBeNull();
    expect(deadKmFor({ lat: NaN, lng: 80.9 }, profile(stops), 1.3)).toBeNull();
    expect(deadKmFor(YARD, profile(stops), NaN)).toBeNull();
    expect(deadKmFor(YARD, profile(stops), 0)).toBeNull();
    expect(deadKmFor(YARD, profile(stops), Infinity)).toBeNull();
  });

  it('shows figures that add up: perTripKm is outKm plus inKm to one decimal', () => {
    let seed = 12345;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 300; i += 1) {
      const yard = { lat: 20 + rand() * 10, lng: 75 + rand() * 10 };
      const a = stop(1, 20 + rand() * 10, 75 + rand() * 10);
      const b = stop(2, 20 + rand() * 10, 75 + rand() * 10);
      const detour = 1 + rand();
      const dead = deadKmFor(yard, profile([a, b]), detour)!;
      expect(Math.round(dead.perTripKm * 10)).toBe(
        Math.round(dead.outKm * 10) + Math.round(dead.inKm * 10),
      );
      const outM = Math.round(haversineKm(yard.lat, yard.lng, a.lat!, a.lng!) * 1000 * detour);
      const inM = Math.round(haversineKm(b.lat!, b.lng!, yard.lat, yard.lng) * 1000 * detour);
      expect(Math.abs(dead.perTripKm - (outM + inM) / 1000)).toBeLessThanOrEqual(0.1 + 1e-9);
    }
  });

  it('scales with the detour factor', () => {
    const a = deadKmFor(YARD, profile(stops), 1)!;
    const b = deadKmFor(YARD, profile(stops), 2)!;
    expect(b.perTripKm).toBeGreaterThan(a.perTripKm * 1.9);
  });
});
