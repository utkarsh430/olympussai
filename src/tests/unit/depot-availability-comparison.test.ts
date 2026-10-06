import { describe, expect, it } from 'vitest';
import {
  BOTH_MODELLED_NOTE,
  compareAvailability,
} from '@/lib/depot/forecast/availabilityComparison';
import type { Forecast, ForecastPoint, ForecastResult } from '@/lib/depot/forecast/types';

const REQUIREMENT = { required: 40, peakRequirement: 34, spareTarget: 6 };

function points(values: readonly (readonly [number, number, number])[]): ForecastPoint[] {
  return values.map(([value, low, high], i) => ({
    date: `2026-10-${String(7 + i).padStart(2, '0')}`,
    value,
    low,
    high,
  }));
}

function ok(drawn: readonly (readonly [number, number, number])[]): ForecastResult {
  const forecast: Forecast = {
    method: 'seasonal_naive',
    reason: 'short_history',
    horizonDays: drawn.length,
    points: points(drawn),
    error: {
      overHorizon: 1,
      byDaysAhead: drawn.map(() => 1),
      unit: 'buses',
      statedAsFraction: false,
    },
    backtestDays: 28,
    seasonalNaiveError: 1,
    holtWintersError: null,
    historyDays: 90,
  };
  return { status: 'ok', forecast };
}

describe('available buses against the modelled requirement', () => {
  it('says the requirement is covered on every day', () => {
    const result = compareAvailability(
      ok([
        [44, 42, 46],
        [41, 40, 43],
        [47, 45, 49],
      ]),
      REQUIREMENT,
      null,
    );
    expect(result).toMatchObject({
      status: 'ok',
      lowest: 41,
      highest: 47,
      daysBelow: 0,
      daysBandBelow: 0,
      horizonDays: 3,
    });
    expect(result.sentence).toBe(
      'MODELLED: available buses are forecast at 41 to 47 over the next 3 days, at or above the ' +
        'modelled requirement of 40 (34 at peak plus 6 spare) on every day, so the depot is ' +
        'forecast to cover its own requirement.',
    );
  });

  it('says when the band, but not the forecast, reaches below the requirement', () => {
    const result = compareAvailability(
      ok([
        [42, 38, 45],
        [41, 39, 43],
      ]),
      REQUIREMENT,
      null,
    );
    expect(result).toMatchObject({ daysBelow: 0, daysBandBelow: 2 });
    expect(result.sentence).toContain(
      'on every day, though the band reaches below it on 2 of 2 days, so a shortfall is possible.',
    );
  });

  it('counts the days below the requirement and says what that means', () => {
    const result = compareAvailability(
      ok([
        [38, 36, 40],
        [41, 39, 43],
        [39, 37, 41],
      ]),
      REQUIREMENT,
      null,
    );
    expect(result).toMatchObject({ daysBelow: 2 });
    expect(result.sentence).toBe(
      'MODELLED: available buses are forecast at 38 to 41 over the next 3 days, below the ' +
        'modelled requirement of 40 (34 at peak plus 6 spare) on 2 of 3 days, so the depot may ' +
        'need buses lent from a neighbour on those days.',
    );
  });

  it('says plainly that both sides are modelled', () => {
    expect(BOTH_MODELLED_NOTE).toBe(
      'Both sides are MODELLED: the forecast rests on a generated history, and the requirement ' +
        'stands in for a network timetable that has not been supplied.',
    );
  });

  it('passes on why there is no forecast', () => {
    const why = 'No forecast: it needs at least 28 days of history and this series has 20.';
    const result = compareAvailability(
      {
        status: 'insufficient_history',
        historyDays: 20,
        required: 28,
        cause: 'short_record',
        missingDate: null,
      },
      REQUIREMENT,
      why,
    );
    expect(result).toEqual({ status: 'no_forecast', sentence: why });
  });

  it('says when the unit has no modelled requirement', () => {
    const result = compareAvailability(ok([[44, 42, 46]]), null, null);
    expect(result).toEqual({
      status: 'no_requirement',
      sentence:
        'No modelled requirement for this unit: the fleet distribution sets one only for operating depots.',
    });
  });
});
