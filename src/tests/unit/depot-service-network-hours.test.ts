import { describe, expect, it } from 'vitest';
import {
  SERVICE_BANDS,
  bandSummaries,
  isServiceBandKey,
  nextPeakBand,
  routeStrip,
  serviceBand,
} from '@/lib/depot/service/networkHours';
import { craftedDay } from './depot-service-network-fixtures';

const SHORT = craftedDay({ routeName: 'R_SHORT', depotId: 'A', deployed: 4, needed: 7, measured: [7, 8] });
const OVER = craftedDay({ routeName: 'R_OVER', depotId: 'A', deployed: 6, needed: 3 });
const EVEN = craftedDay({ routeName: 'R_EVEN', depotId: 'B', deployed: 5, needed: 5 });

describe('the service bands', () => {
  it('are the five fixed bands of the day, in order, hours 00 to 03 in none', () => {
    expect(SERVICE_BANDS.map((b) => [b.key, b.fromHour, b.toHour])).toEqual([
      ['early', 4, 5],
      ['morning_peak', 6, 9],
      ['midday', 10, 15],
      ['evening_peak', 16, 19],
      ['late', 20, 23],
    ]);
    expect(serviceBand('midday').label).toBe('Midday');
    expect(isServiceBandKey('morning_peak')).toBe(true);
    expect(isServiceBandKey('night')).toBe(false);
  });

  it('names the peak now or next by the feed clock', () => {
    expect(nextPeakBand(null)).toBe('morning_peak');
    expect(nextPeakBand(3)).toBe('morning_peak');
    expect(nextPeakBand(9)).toBe('morning_peak');
    expect(nextPeakBand(10)).toBe('evening_peak');
    expect(nextPeakBand(19)).toBe('evening_peak');
    expect(nextPeakBand(20)).toBe('morning_peak');
  });
});

describe('a route strip', () => {
  it('carries the 24 gaps, measured where observed, and the band peak', () => {
    const strip = routeStrip(SHORT, 'morning_peak');
    expect(strip.gaps).toHaveLength(24);
    expect(strip.gaps[8]).toBe(3);
    expect(strip.bases[7]).toBe('measured');
    expect(strip.bases[12]).toBe('modelled');
    expect(strip.bandGap).toBe(3);
    expect(strip.peakGap).toBe(3);
    expect(strip.peakHour).toBe(6);
    expect(strip.depotId).toBe('A');
  });

  it('has no peak hour when nothing in the band is short', () => {
    const strip = routeStrip(OVER, 'midday');
    expect(strip.bandGap).toBe(-3);
    expect(strip.peakHour).toBeNull();
  });
});

describe('the band summaries', () => {
  const summaries = bandSummaries([SHORT, OVER, EVEN]);

  it('count short and over routes and their buses in every band', () => {
    const peak = summaries.find((s) => s.band === 'morning_peak');
    expect(peak).toMatchObject({ shortRoutes: 1, overRoutes: 1, busesShort: 3, busesOver: 3 });
    expect(summaries).toHaveLength(5);
  });

  it('tally per depot, depots in id order, an even depot still listed', () => {
    const peak = summaries.find((s) => s.band === 'morning_peak');
    expect(peak?.byDepot).toEqual([
      { depotId: 'A', depotName: 'Depot A', shortRoutes: 1, overRoutes: 1, busesShort: 3, busesOver: 3 },
      { depotId: 'B', depotName: 'Depot B', shortRoutes: 0, overRoutes: 0, busesShort: 0, busesOver: 0 },
    ]);
  });

  it('leaves a route with no depot out of the depot tally but in the network count', () => {
    const loose = craftedDay({ routeName: 'R_LOOSE', depotId: null, deployed: 1, needed: 4 });
    const peak = bandSummaries([loose]).find((s) => s.band === 'morning_peak');
    expect(peak).toMatchObject({ shortRoutes: 1, busesShort: 3, byDepot: [] });
  });
});
