// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hourShapeFor, modelHourlyDemand } from '@/lib/depot/sim/hourlyDemand';
import {
  DEMAND_BAND_SHARE,
  DEMAND_BASIS,
  HOUR_SHAPE_BY_CLASS,
  LONG_ROUTE_DEPARTURE_SHAPE,
} from '@/lib/depot/sim/hourlyDemandConfig';
import type { ServiceClass } from '@/lib/depot/sim/types';

const CLASSES: readonly ServiceClass[] = ['ordinary', 'express', 'ac', 'premium'];
const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);

const base = {
  routeName: 'LKO_KNP_ORD',
  operatingDate: '2026-10-06',
  serviceClass: 'ordinary' as ServiceClass,
  journeyMinutes: 120,
  dayBoardings: 2400,
  activeHours: [] as readonly number[],
};

describe('the hour-of-day shapes', () => {
  it.each(CLASSES)('%s has 24 positive weights summing to 1', (c) => {
    const shape = HOUR_SHAPE_BY_CLASS[c];
    expect(shape).toHaveLength(24);
    expect(shape.every((w) => w > 0)).toBe(true);
    expect(sum(shape)).toBeCloseTo(1, 12);
  });

  it('the departure shape sums to 1', () => {
    expect(sum(LONG_ROUTE_DEPARTURE_SHAPE)).toBeCloseTo(1, 12);
  });

  it('ordinary peaks in the morning and the evening, with a lull between', () => {
    const s = HOUR_SHAPE_BY_CLASS.ordinary;
    expect(s[8]).toBeGreaterThan(s[12] as number);
    expect(s[18]).toBeGreaterThan(s[12] as number);
  });

  it('a long journey leans the shape toward departure hours and still sums to 1', () => {
    const short = hourShapeFor('ordinary', 120);
    const long = hourShapeFor('ordinary', 300);
    expect(sum(long)).toBeCloseTo(1, 12);
    expect(long[5]).toBeGreaterThan(short[5] as number);
    expect(hourShapeFor('ordinary', null)).toEqual(HOUR_SHAPE_BY_CLASS.ordinary);
  });
});

describe('modelHourlyDemand', () => {
  it('answers 24 hours that sum to the day total, zero outside the default daytime', () => {
    const hours = modelHourlyDemand(base);
    expect(hours.map((h) => h.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(sum(hours.map((h) => h.boardings))).toBe(2400);
    expect(hours.filter((h) => h.hour < 5 || h.hour > 22).every((h) => h.boardings === 0)).toBe(
      true,
    );
    expect(hours.every((h) => Number.isInteger(h.boardings))).toBe(true);
  });

  it('keeps demand to the active hours and still sums to the day total', () => {
    const active = [6, 7, 8, 9, 10, 16, 17, 18];
    const hours = modelHourlyDemand({ ...base, activeHours: active });
    expect(sum(hours.map((h) => h.boardings))).toBe(2400);
    for (const h of hours) {
      if (active.includes(h.hour)) expect(h.boardings).toBeGreaterThan(0);
      else expect(h.boardings).toBe(0);
    }
  });

  it('treats too few active hours as unknown and uses the default daytime', () => {
    const hours = modelHourlyDemand({ ...base, activeHours: [8, 9] });
    expect(hours.filter((h) => h.boardings > 0).length).toBeGreaterThan(10);
    expect(sum(hours.map((h) => h.boardings))).toBe(2400);
  });

  it('is repeatable for the same route and date, and jitters differently on another date', () => {
    expect(modelHourlyDemand(base)).toEqual(modelHourlyDemand(base));
    const other = modelHourlyDemand({ ...base, operatingDate: '2026-10-07' });
    expect(other.map((h) => h.boardings)).not.toEqual(modelHourlyDemand(base).map((h) => h.boardings));
    expect(sum(other.map((h) => h.boardings))).toBe(2400);
  });

  it('draws a band of a quarter either side of each hour and states its basis', () => {
    for (const h of modelHourlyDemand(base)) {
      expect(h.band.low).toBe(Math.round(h.boardings * (1 - DEMAND_BAND_SHARE)));
      expect(h.band.high).toBe(Math.round(h.boardings * (1 + DEMAND_BAND_SHARE)));
      expect(h.provenance).toBe('modelled');
      expect(h.basis).toBe(DEMAND_BASIS);
      expect(h.routeName).toBe(base.routeName);
      expect(h.operatingDate).toBe(base.operatingDate);
    }
  });

  it('answers zeros for a day with no boardings or a corrupt total', () => {
    for (const dayBoardings of [0, -5, Number.NaN]) {
      const hours = modelHourlyDemand({ ...base, dayBoardings });
      expect(hours.every((h) => h.boardings === 0 && h.band.high === 0)).toBe(true);
    }
  });

  it('never lets an active hour outside 0 to 23 break the day', () => {
    const hours = modelHourlyDemand({ ...base, activeHours: [-1, 24, 7, 8, 9, 10] });
    expect(sum(hours.map((h) => h.boardings))).toBe(2400);
    expect(hours.filter((h) => h.boardings > 0).map((h) => h.hour)).toEqual([7, 8, 9, 10]);
  });
});
