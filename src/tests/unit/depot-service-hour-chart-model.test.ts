import { describe, expect, it } from 'vitest';
import { buildHourChartModel, hourTableRows } from '@/lib/depot/service/hourChartModel';
import { routeHourlyFixture } from './depot-service-fixtures';

describe('hour chart model', () => {
  const model = buildHourChartModel(routeHourlyFixture());

  it('has 24 columns labelled HH:00, with ticks every 3 hours', () => {
    expect(model.columns).toHaveLength(24);
    expect(model.columns[7]?.label).toBe('07:00');
    expect(model.xTicks).toEqual(['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00']);
  });

  it('tells observed, current, modelled and not-observed hours apart', () => {
    const kinds = model.columns.map((c) => c.kind);
    expect(kinds.slice(0, 5)).toEqual(Array(5).fill('not_observed'));
    expect(kinds.slice(5, 11)).toEqual(Array(6).fill('observed'));
    expect(kinds[11]).toBe('current');
    expect(kinds.slice(12)).toEqual(Array(12).fill('modelled'));
  });

  it('puts each deployed figure in exactly one bar series by its basis', () => {
    const c8 = model.columns[8];
    expect([c8?.solid, c8?.hatched, c8?.outlined]).toEqual([9, null, null]);
    const c15 = model.columns[15];
    expect([c15?.solid, c15?.hatched, c15?.outlined]).toEqual([null, 9, null]);
    const c4 = model.columns[4];
    expect([c4?.solid, c4?.hatched, c4?.outlined]).toEqual([null, null, 2]);
    expect(model.columns[11]?.solid).toBe(10);
  });

  it('scales the needed band from the demand band', () => {
    const c8 = model.columns[8];
    expect(c8?.neededBand).toEqual([9.8, 16.3]);
  });

  it('signs the gap: positive short, negative over, zero even', () => {
    expect(model.columns[7]?.gapText).toBe('+3');
    expect(model.columns[7]?.gapTone).toBe('short');
    expect(model.columns[12]?.gapText).toBe('−2');
    expect(model.columns[12]?.gapTone).toBe('over');
    expect(model.columns[0]?.gapText).toBe('0');
    expect(model.columns[0]?.gapTone).toBe('even');
  });

  it('counts a gap as seen only where the deployment was seen in the feed', () => {
    const seen = model.columns.map((c) => c.gapSeen);
    expect(seen.slice(0, 5)).toEqual(Array(5).fill(false));
    expect(seen.slice(5, 12)).toEqual(Array(7).fill(true));
    expect(seen.slice(12)).toEqual(Array(12).fill(false));
    const rows = hourTableRows(model);
    expect(rows[8]?.gapTitle).toBeUndefined();
    expect(rows[15]?.gapTitle).toBe('Modelled: the deployment in this hour is modelled.');
    expect(rows[2]?.gapTitle).toBe('Modelled: the deployment in this hour is modelled.');
  });

  it('marks the current hour and builds a y-scale above every figure', () => {
    expect(model.nowLabel).toBe('11:00');
    expect(model.yDomain[0]).toBe(0);
    expect(model.yDomain[1]).toBeGreaterThanOrEqual(17.5);
    expect(model.yTicks[0]).toBe(0);
    expect(model.yTicks.length).toBeLessThanOrEqual(6);
    expect(model.yTicks.at(-1)).toBe(model.yDomain[1]);
  });

  it('keeps a scale when a figure is not a number', () => {
    const body = routeHourlyFixture();
    const hours = body.hours.map((h) => (h.hour === 3 ? { ...h, needed: Number.NaN } : h));
    expect(buildHourChartModel({ hours, currentHour: 11 }).yDomain).toEqual([0, 20]);
  });

  it('has no now marker without a feed clock, and then no hour is "not observed"', () => {
    const cold = buildHourChartModel(routeHourlyFixture({ currentHour: null }));
    expect(cold.nowLabel).toBeNull();
    expect(cold.columns.filter((c) => c.kind === 'not_observed')).toHaveLength(0);
  });

  it('gives a 24-row text table with words for the basis and dashes for the unknown', () => {
    const rows = hourTableRows(model);
    expect(rows).toHaveLength(24);
    expect(rows[8]).toMatchObject({
      hour: '08:00',
      deployed: '9',
      basis: 'Observed',
      scheduled: '6',
      needed: '13',
      gap: '+4 Short by 4',
      neededRange: '9.8 to 16.3',
      delay: '8',
      lateShare: '50%',
    });
    expect(rows[0]).toMatchObject({ basis: 'Not observed', scheduled: '—', delay: '—' });
    expect(rows[11]?.basis).toBe('Current hour');
    expect(rows[12]?.gap).toBe('−2 Over by 2');
    expect(rows[0]?.gap).toBe('0 Even');
    expect(rows[20]?.basis).toBe('Modelled');
  });
});
