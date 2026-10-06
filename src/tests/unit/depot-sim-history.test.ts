import { describe, expect, it } from 'vitest';
import { modelSeries } from '@/lib/depot/sim/history';
import type { HistoryScope, MetricKey, SeriesPoint } from '@/lib/depot/sim/types';

const METRICS: readonly MetricKey[] = ['onRoadShare', 'offRoadRate', 'darkRate', 'index', 'available'];
const DEPOT: HistoryScope = { kind: 'depot', depotId: 'PUNE-1' };
const NETWORK: HistoryScope = { kind: 'network' };
const TYPICAL: Record<MetricKey, number> = {
  onRoadShare: 0.82,
  offRoadRate: 0.06,
  darkRate: 0.03,
  index: 71.4,
  available: 120,
};
const RANGE: Record<MetricKey, readonly [number, number]> = {
  onRoadShare: [0, 1],
  offRoadRate: [0, 1],
  darkRate: [0, 1],
  index: [0, 100],
  available: [0, Number.POSITIVE_INFINITY],
};

function dayDiff(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}

function expectConsecutive(series: readonly SeriesPoint[]): void {
  series.slice(1).forEach((p, i) => {
    const prev = series[i] as SeriesPoint;
    expect(dayDiff(prev.date, p.date)).toBe(1);
  });
}

describe('modelSeries shape', () => {
  it('returns exactly `days` points and clamps days to 7..180', () => {
    const anchor = { date: '2026-10-06', value: 0.8 };
    expect(modelSeries('onRoadShare', DEPOT, 30, anchor)).toHaveLength(30);
    expect(modelSeries('onRoadShare', DEPOT, 1, anchor)).toHaveLength(7);
    expect(modelSeries('onRoadShare', DEPOT, 9999, anchor)).toHaveLength(180);
    expect(modelSeries('onRoadShare', DEPOT, 7, anchor)).toHaveLength(7);
    expect(modelSeries('onRoadShare', DEPOT, 180, anchor)).toHaveLength(180);
  });

  it('steps one calendar day at a time across a month end', () => {
    const s = modelSeries('index', DEPOT, 10, { date: '2026-03-04', value: 60 });
    expect(s[0]?.date).toBe('2026-02-23');
    expect(s.map((p) => p.date)).toContain('2026-02-28');
    expect(s.map((p) => p.date)).toContain('2026-03-01');
    expect(s.at(-1)?.date).toBe('2026-03-04');
    expectConsecutive(s);
  });

  it('includes 29 February in a leap year and not otherwise', () => {
    const leap = modelSeries('index', DEPOT, 10, { date: '2028-03-04', value: 60 });
    expect(leap.map((p) => p.date)).toContain('2028-02-29');
    expectConsecutive(leap);
    const plain = modelSeries('index', DEPOT, 10, { date: '2027-03-04', value: 60 });
    expect(plain.map((p) => p.date)).not.toContain('2027-02-29');
  });

  it('ends exactly on the anchor', () => {
    for (const metric of METRICS) {
      const anchor = { date: '2026-10-06', value: TYPICAL[metric] };
      const s = modelSeries(metric, DEPOT, 60, anchor);
      expect(s.at(-1)).toEqual(anchor);
    }
  });
});

describe('modelSeries determinism and variety', () => {
  it('gives identical output for identical calls', () => {
    const anchor = { date: '2026-10-06', value: 71.4 };
    expect(modelSeries('index', DEPOT, 90, anchor)).toEqual(modelSeries('index', DEPOT, 90, anchor));
  });

  it('differs between depots, metrics, scopes and anchor dates', () => {
    const anchor = { date: '2026-10-06', value: 0.5 };
    const values = (s: readonly SeriesPoint[]): number[] => s.map((p) => p.value);
    const base = values(modelSeries('onRoadShare', DEPOT, 60, anchor));
    const other = { kind: 'depot', depotId: 'NASHIK-2' } as const;
    expect(values(modelSeries('onRoadShare', other, 60, anchor))).not.toEqual(base);
    expect(values(modelSeries('offRoadRate', DEPOT, 60, anchor))).not.toEqual(base);
    expect(values(modelSeries('onRoadShare', NETWORK, 60, anchor))).not.toEqual(base);
    const later = { ...anchor, date: '2026-10-20' };
    expect(values(modelSeries('onRoadShare', DEPOT, 60, later))).not.toEqual(base);
  });

  it('actually varies and keeps day-to-day moves small relative to the range', () => {
    const s = modelSeries('index', DEPOT, 180, { date: '2026-10-06', value: 70 });
    expect(new Set(s.map((p) => p.value)).size).toBeGreaterThan(30);
    s.slice(1).forEach((p, i) => {
      const prev = s[i] as SeriesPoint;
      expect(Math.abs(p.value - prev.value)).toBeLessThan(15);
    });
  });

  it('stays near the anchor level instead of wandering', () => {
    const s = modelSeries('index', DEPOT, 180, { date: '2026-10-06', value: 70 });
    s.forEach((p) => expect(Math.abs(p.value - 70)).toBeLessThan(25));
  });

  it('has a consistent weekday/weekend difference', () => {
    const s = modelSeries('index', DEPOT, 180, { date: '2026-10-06', value: 50 });
    const isWeekend = (d: string): boolean => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const we = mean(s.filter((p) => isWeekend(p.date)).map((p) => p.value));
    const wd = mean(s.filter((p) => !isWeekend(p.date)).map((p) => p.value));
    expect(Math.abs(we - wd)).toBeGreaterThan(0.5);
  });
});

describe('modelSeries ranges', () => {
  it('keeps every value valid for each metric over 180 days and extreme anchors', () => {
    for (const metric of METRICS) {
      const [lo, hi] = RANGE[metric];
      const extremes = metric === 'index' ? [0, 1, 100] : metric === 'available' ? [0, 1, 400] : [0, 0.5, 1];
      for (const value of extremes) {
        const s = modelSeries(metric, DEPOT, 180, { date: '2026-10-06', value });
        expect(s).toHaveLength(180);
        s.forEach((p) => {
          expect(Number.isFinite(p.value)).toBe(true);
          expect(p.value).toBeGreaterThanOrEqual(lo);
          expect(p.value).toBeLessThanOrEqual(hi);
        });
      }
    }
  });

  it('keeps available a non-negative integer', () => {
    const s = modelSeries('available', DEPOT, 180, { date: '2026-10-06', value: 37 });
    s.forEach((p) => {
      expect(Number.isInteger(p.value)).toBe(true);
      expect(p.value).toBeGreaterThanOrEqual(0);
    });
  });

  it('rounds rates to four decimals and the index to one', () => {
    const rate = modelSeries('onRoadShare', DEPOT, 60, { date: '2026-10-06', value: 0.8123 });
    rate.forEach((p) => expect(Math.round(p.value * 1e4) / 1e4).toBe(p.value));
    const index = modelSeries('index', DEPOT, 60, { date: '2026-10-06', value: 71.4 });
    index.forEach((p) => expect(Math.round(p.value * 10) / 10).toBe(p.value));
  });

  it('clamps out-of-range anchors and ends on the clamped value', () => {
    const at = (metric: MetricKey, value: number): number | undefined =>
      modelSeries(metric, DEPOT, 20, { date: '2026-10-06', value }).at(-1)?.value;
    expect(at('onRoadShare', 1.7)).toBe(1);
    expect(at('darkRate', -0.2)).toBe(0);
    expect(at('index', 140)).toBe(100);
    expect(at('available', -5)).toBe(0);
    expect(at('available', 12.6)).toBe(13);
  });

  it('throws RangeError for non-finite anchors or an invalid date', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => modelSeries('index', DEPOT, 20, { date: '2026-10-06', value })).toThrow(RangeError);
    }
    expect(() => modelSeries('index', DEPOT, 20, { date: 'nope', value: 1 })).toThrow(RangeError);
  });
});

describe('modelSeries stability when the anchor moves a day', () => {
  // Same anchor value, anchor date one day later. Each day's variation is seeded from its own
  // date, so the only differences are the walk's starting point (which decays by the reversion
  // factor) and the weekly offset re-referenced to the new anchor weekday. Both are a few
  // percent of the metric's span; we assert 12% as a generous but meaningful ceiling.
  const TOLERANCE_SHARE_OF_SPAN = 0.12;
  const SPAN: Record<MetricKey, number> = {
    onRoadShare: 1,
    offRoadRate: 1,
    darkRate: 1,
    index: 100,
    available: 120,
  };

  it.each(METRICS)('overlaps closely for %s', (metric) => {
    const value = TYPICAL[metric];
    const a = modelSeries(metric, DEPOT, 120, { date: '2026-10-05', value });
    const b = modelSeries(metric, DEPOT, 120, { date: '2026-10-06', value });
    const byDate = new Map(b.map((p) => [p.date, p.value]));
    let overlap = 0;
    a.forEach((p) => {
      const other = byDate.get(p.date);
      if (other === undefined) return;
      overlap += 1;
      expect(Math.abs(other - p.value)).toBeLessThanOrEqual(SPAN[metric] * TOLERANCE_SHARE_OF_SPAN);
    });
    expect(overlap).toBe(119);
  });
});
