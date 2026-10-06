import { describe, it, expect } from 'vitest';
import { modelTripsPerDay } from '@/lib/depot/sim/tripFrequency';
import {
  LONG_ROUTE_MIN,
  MAX_BUSES_PER_ROUTE,
  SHORT_ROUTE_MIN,
  TRIP_FACTOR_RANGE,
  TRIP_MODEL_PARAMS,
} from '@/lib/depot/sim/tripFrequencyConfig';

const DATE = '2026-10-06';
const names = Array.from({ length: 200 }, (_, i) => `RKD_${4000 + i}_ORD_OUT`);

describe('modelTripsPerDay', () => {
  it('is deterministic for a route name and operating date', () => {
    const input = { routeName: 'RKD_4560_ORD_OUT', buses: 7, scheduledDurationMin: 150 };
    expect(modelTripsPerDay(input, DATE)).toEqual(modelTripsPerDay({ ...input }, DATE));
  });

  it('varies with the route name and the operating date', () => {
    const counts = (date: string): number[] =>
      names.map((routeName) =>
        modelTripsPerDay({ routeName, buses: 40, scheduledDurationMin: null }, date).tripsPerDay,
      );
    expect(new Set(counts(DATE)).size).toBeGreaterThan(1);
    expect(counts('2026-10-07')).not.toEqual(counts(DATE));
  });

  it('always returns a whole number of at least one trip per bus', () => {
    for (const routeName of names) {
      for (const buses of [1, 2, 5, 13, 60]) {
        for (const duration of [null, 30, 120, 300, 600]) {
          const { tripsPerDay } = modelTripsPerDay(
            { routeName, buses, scheduledDurationMin: duration },
            DATE,
          );
          expect(Number.isInteger(tripsPerDay)).toBe(true);
          expect(tripsPerDay).toBeGreaterThanOrEqual(buses);
          expect(tripsPerDay).toBeLessThanOrEqual(Math.round(buses * TRIP_FACTOR_RANGE.max));
        }
      }
    }
  });

  it('anchors on the buses seen: more buses never means fewer trips', () => {
    for (const routeName of names.slice(0, 50)) {
      let previous = 0;
      for (let buses = 1; buses <= 30; buses += 1) {
        const { tripsPerDay } = modelTripsPerDay({ routeName, buses, scheduledDurationMin: 200 }, DATE);
        expect(tripsPerDay).toBeGreaterThanOrEqual(previous);
        previous = tripsPerDay;
      }
    }
  });

  it('anchors on the scheduled duration: short routes run more trips per bus than long ones', () => {
    const total = (duration: number): number =>
      names.reduce(
        (sum, routeName) =>
          sum + modelTripsPerDay({ routeName, buses: 10, scheduledDurationMin: duration }, DATE).tripsPerDay,
        0,
      );
    expect(total(SHORT_ROUTE_MIN)).toBeGreaterThan(total(LONG_ROUTE_MIN));
    const long = modelTripsPerDay({ routeName: names[0]!, buses: 10, scheduledDurationMin: 900 }, DATE);
    expect(long.basis).toBe('buses_and_duration');
    expect(long.tripsPerDay).toBeLessThanOrEqual(Math.round(10 * (1 + TRIP_MODEL_PARAMS.noise)));
  });

  it('says which anchors it used', () => {
    const known = modelTripsPerDay({ routeName: 'A', buses: 3, scheduledDurationMin: 120 }, DATE);
    const unknown = modelTripsPerDay({ routeName: 'A', buses: 3, scheduledDurationMin: null }, DATE);
    expect(known.basis).toBe('buses_and_duration');
    expect(unknown.basis).toBe('buses_only');
  });

  it('gives no trips to a route with no buses', () => {
    const none = modelTripsPerDay({ routeName: 'A', buses: 0, scheduledDurationMin: 120 }, DATE);
    expect(none.tripsPerDay).toBe(0);
  });

  it('survives hostile inputs with a finite whole number', () => {
    const hostile = [
      { routeName: '', buses: Number.NaN, scheduledDurationMin: Number.NaN },
      { routeName: 'A', buses: Number.POSITIVE_INFINITY, scheduledDurationMin: 120 },
      { routeName: 'A', buses: -4, scheduledDurationMin: -60 },
      { routeName: 'A', buses: 2.7, scheduledDurationMin: Number.POSITIVE_INFINITY },
      { routeName: 'A', buses: 1e12, scheduledDurationMin: 1e12 },
      { routeName: 'A'.repeat(10_000), buses: 3, scheduledDurationMin: 0 },
    ];
    for (const input of hostile) {
      const { tripsPerDay, perBus } = modelTripsPerDay(input, 'not a date');
      expect(Number.isInteger(tripsPerDay)).toBe(true);
      expect(tripsPerDay).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(perBus)).toBe(true);
    }
    const huge = modelTripsPerDay({ routeName: 'A', buses: 1e12, scheduledDurationMin: 60 }, DATE);
    expect(huge.tripsPerDay).toBeLessThanOrEqual(MAX_BUSES_PER_ROUTE * TRIP_FACTOR_RANGE.max);
    const fractional = modelTripsPerDay({ routeName: 'A', buses: 2.7, scheduledDurationMin: null }, DATE);
    expect(fractional.tripsPerDay).toBeGreaterThanOrEqual(2);
    const badDuration = modelTripsPerDay({ routeName: 'A', buses: 3, scheduledDurationMin: -60 }, DATE);
    expect(badDuration.basis).toBe('buses_only');
  });
});
