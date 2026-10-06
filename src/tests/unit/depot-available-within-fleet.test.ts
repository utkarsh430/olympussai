import { describe, expect, it } from 'vitest';
import { bandPoint } from '@/lib/depot/forecast/band';
import { forecastSeries } from '@/lib/depot/forecast/forecast';
import { MAX_HORIZON_DAYS } from '@/lib/depot/forecast/config';
import { modelSeries } from '@/lib/depot/sim/history';
import type { HistoryScope, SeriesPoint } from '@/lib/depot/sim/types';

/**
 * A modelled count of available buses can never exceed the fleet it is modelled
 * for: not on any day of the history, and not in any forecast value or band edge.
 */

const DATE = '2026-10-06';
const HISTORY_DAYS = 90;
const DEPOTS = 143;

interface Unit {
  readonly scope: HistoryScope;
  readonly fleet: number;
  readonly available: number;
}

/** Fleets of 20 to 170 buses with up to a tenth off the road, spread deterministically. */
function depotUnits(): readonly Unit[] {
  return Array.from({ length: DEPOTS }, (_, i) => {
    const fleet = 20 + ((i * 37) % 151);
    const offRoad = Math.floor(fleet * 0.1 * (((i * 13) % 11) / 10));
    return { scope: { kind: 'depot', depotId: String(i + 1) }, fleet, available: fleet - offRoad };
  });
}

function historyOf(unit: Unit, days: number = HISTORY_DAYS): SeriesPoint[] {
  return modelSeries('available', unit.scope, days, {
    date: DATE,
    value: unit.available,
    ceiling: unit.fleet,
  });
}

function outside(values: readonly number[], fleet: number): readonly number[] {
  return values.filter((v) => v < 0 || v > fleet);
}

describe('modelled available buses stay within the fleet', () => {
  it('keeps every day of every depot history between 0 and the fleet', () => {
    const breaches = depotUnits().flatMap((unit) =>
      outside(historyOf(unit).map((p) => p.value), unit.fleet).map((v) => `fleet ${unit.fleet}: ${v}`),
    );
    expect(breaches).toEqual([]);
  });

  it('keeps the network history at or below the network fleet', () => {
    const network: Unit = { scope: { kind: 'network' }, fleet: 10_005, available: 9_800 };
    const values = historyOf(network, 30).map((p) => p.value);
    expect(Math.max(...values)).toBeLessThanOrEqual(network.fleet);
    expect(values.at(-1)).toBe(network.available);
  });

  it('still ends on the live value and still varies below the fleet', () => {
    const unit: Unit = { scope: { kind: 'depot', depotId: '42' }, fleet: 80, available: 78 };
    const values = historyOf(unit, 30).map((p) => p.value);
    expect(values.at(-1)).toBe(78);
    expect(Math.max(...values)).toBeLessThanOrEqual(80);
    expect(new Set(values).size).toBeGreaterThan(3);
  });

  it('clamps an anchor above its own ceiling to the ceiling', () => {
    const series = modelSeries('available', { kind: 'network' }, 7, {
      date: DATE,
      value: 120,
      ceiling: 100,
    });
    expect(series.at(-1)?.value).toBe(100);
  });

  it('keeps every forecast value and band edge between 0 and the fleet, at every horizon', () => {
    const breaches: string[] = [];
    for (const unit of depotUnits()) {
      const history = historyOf(unit);
      for (const horizon of [1, 7, 14, MAX_HORIZON_DAYS]) {
        const result = forecastSeries(history, 'available', horizon);
        if (result.status !== 'ok') throw new Error(`no forecast for depot ${unit.fleet}`);
        for (const p of result.forecast.points) {
          const edges = outside([p.value, p.low, p.high], unit.fleet);
          if (edges.length > 0) breaches.push(`fleet ${unit.fleet} h${horizon} ${p.date}: ${edges}`);
        }
      }
    }
    expect(breaches).toEqual([]);
  });

  it('keeps a one-bus band on the inner side when the forecast sits at the fleet', () => {
    const unit: Unit = { scope: { kind: 'depot', depotId: '7' }, fleet: 40, available: 40 };
    const result = forecastSeries(historyOf(unit), 'available', 14);
    if (result.status !== 'ok') throw new Error('expected a forecast');
    for (const p of result.forecast.points) {
      expect(p.high).toBeLessThanOrEqual(40);
      expect(p.low).toBeLessThanOrEqual(p.value);
      expect(p.value).toBeLessThanOrEqual(p.high);
    }
  });

  it('refuses a series with a day above its own ceiling', () => {
    const unit: Unit = { scope: { kind: 'depot', depotId: '9' }, fleet: 50, available: 45 };
    const history = historyOf(unit);
    const broken = [...history.slice(0, -1), { ...(history.at(-1) as SeriesPoint), value: 51 }];
    expect(forecastSeries(broken, 'available', 14)).toEqual({
      status: 'invalid_input',
      reason: 'out_of_range',
    });
  });

  it('draws no band outside a range that holds a single value', () => {
    expect(bandPoint('2026-10-07', 0.2, 0.3, { min: 0, max: 0 }, true)).toEqual({
      date: '2026-10-07',
      value: 0,
      low: 0,
      high: 0,
    });
  });
});
