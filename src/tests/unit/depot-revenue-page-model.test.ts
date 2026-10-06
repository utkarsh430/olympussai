import { describe, it, expect } from 'vitest';
import type { DepotRevenueTotals, RouteRevenueFigure } from '@/lib/depot/revenue/types';
import { REVENUE_MODEL_PARAMS } from '@/lib/depot/sim/revenueConfig';
import {
  HERO_CAP,
  buildRouteRows,
  coverageSentence,
  formatLoadFactor,
  formatRupeesPerKm,
  DERIVED_LENGTH_HEADER,
  heroBars,
  modelledHeader,
  modelledStatement,
  summaryTiles,
  withheldSentence,
} from '@/lib/depot/revenue/revenuePageModel';

function route(over: Partial<RouteRevenueFigure> & { routeName: string }): RouteRevenueFigure {
  return {
    serviceClass: 'ordinary',
    trips: 10,
    seatsPerTrip: 40,
    seatCapacity: 400,
    loadFactor: 0.5,
    boardings: 200,
    revenue: 1000,
    lengthKm: null,
    revenueBasis: 'flat_fare_unknown_length',
    provenance: 'modelled',
    serviceKm: null,
    earningsPerKm: null,
    earningsWithheld: 'unknown_length',
    lengthProvenance: null,
    ...over,
  };
}

const TOTALS: DepotRevenueTotals = {
  routes: 2,
  trips: 20,
  boardings: 1234567,
  revenue: 1234567,
  loadFactor: 0.6123,
  flatFareRevenueShare: 0.25,
  flatFareRouteShare: 0.5,
  earningsPerKm: 12.345,
  earningsCoverage: { n: 1, of: 2 },
  provenance: 'modelled',
};

describe('formatting', () => {
  it('formats a rate per kilometre with a rupee sign and two decimals', () => {
    expect(formatRupeesPerKm(12.345)).toBe('₹12.35 per km');
    expect(formatRupeesPerKm(null)).toBe('—');
  });
  it('formats a load factor ratio as a percentage with one decimal', () => {
    expect(formatLoadFactor(0.6123)).toBe('61.2%');
    expect(formatLoadFactor(null)).toBe('—');
  });
  it('words the earnings coverage in singular and plural', () => {
    expect(coverageSentence({ n: 1, of: 2 })).toBe('Based on 1 of 2 routes with kilometres run and a known length');
    expect(coverageSentence({ n: 1, of: 1 })).toBe('Based on 1 of 1 route with kilometres run and a known length');
    expect(coverageSentence({ n: 0, of: 0 })).toBe('No routes to base it on');
  });
  it('says why earnings are withheld', () => {
    expect(withheldSentence('unknown_length')).toMatch(/length is not known/i);
    expect(withheldSentence('unknown_length')).toMatch(/opened on the Routes page/i);
    expect(withheldSentence('no_service_km')).toMatch(/no kilometres/i);
  });
});

describe('summaryTiles', () => {
  it('lists trips, boardings, load factor, revenue and earnings, each with its note', () => {
    const tiles = summaryTiles(TOTALS);
    expect(tiles.map((t) => t.key)).toEqual([
      'trips',
      'boardings',
      'loadFactor',
      'revenue',
      'earningsPerKm',
    ]);
    const value = (key: string) => tiles.find((t) => t.key === key)?.value;
    expect(value('boardings')).toBe('12,34,567');
    expect(value('revenue')).toBe('₹12,34,567');
    expect(value('loadFactor')).toBe('61.2%');
    expect(value('earningsPerKm')).toBe('₹12.35 per km');
    expect(tiles.find((t) => t.key === 'earningsPerKm')?.note).toBe(
      'Based on 1 of 2 routes with kilometres run and a known length',
    );
  });
  it('states the share of revenue and of routes that rests on the flat fare, on the revenue tile', () => {
    const tiles = summaryTiles(TOTALS);
    expect(tiles.find((t) => t.key === 'revenue')?.note).toBe(
      'Flat fare, length not known: 25.0% of revenue, 50.0% of routes',
    );
    expect(tiles.find((t) => t.key === 'loadFactor')?.note).toBe('Occupied seats over seats offered, weighted by trips');
    const none = summaryTiles({ ...TOTALS, flatFareRevenueShare: null, flatFareRouteShare: null });
    expect(none.find((t) => t.key === 'revenue')?.note).toBeNull();
  });
  it('shows a withheld earnings tile as length not known, with its coverage', () => {
    const tile = summaryTiles({ ...TOTALS, earningsPerKm: null, earningsCoverage: { n: 0, of: 2 } }).find(
      (t) => t.key === 'earningsPerKm',
    );
    expect(tile?.value).toBe('length not known');
    expect(tile?.note).toBe('Based on 0 of 2 routes with kilometres run and a known length');
  });
});

describe('buildRouteRows', () => {
  const rows = buildRouteRows([
    route({ routeName: 'A', revenue: 5000 }),
    route({
      routeName: 'B',
      lengthKm: 80,
      lengthProvenance: 'derived',
      earningsPerKm: 7.5,
      earningsWithheld: null,
      serviceClass: 'ac',
    }),
  ]);
  it('words a withheld figure and a known one', () => {
    expect(rows[0]).toMatchObject({
      routeName: 'A',
      earningsText: 'length not known',
      lengthText: 'not known',
      revenueText: '₹5,000',
      classLabel: 'Ordinary',
    });
    expect(rows[0]?.withheldText).toMatch(/length is not known/i);
    expect(rows[1]).toMatchObject({
      earningsText: '₹7.50 per km',
      lengthText: '80 km (derived)',
      classLabel: 'AC',
      withheldText: null,
    });
  });
});

describe('heroBars', () => {
  const routes = Array.from({ length: HERO_CAP + 3 }, (_, i) =>
    route({ routeName: `R${i}`, revenue: (HERO_CAP + 3 - i) * 1000 }),
  );
  it('caps at the top routes and offers Show all N', () => {
    const hero = heroBars(routes, false);
    expect(hero.bars).toHaveLength(HERO_CAP);
    expect(hero.total).toBe(HERO_CAP + 3);
    expect(hero.toggleLabel).toBe(`Show all ${HERO_CAP + 3}`);
    expect(hero.bars[0]?.widthPercent).toBe(100);
  });
  it('shows every route when asked, under the same fixed label', () => {
    const hero = heroBars(routes, true);
    expect(hero.bars).toHaveLength(HERO_CAP + 3);
    expect(hero.toggleLabel).toBe(`Show all ${HERO_CAP + 3}`);
  });
  it('says in a flat-fare bar that the length is not known', () => {
    const flat = heroBars([route({ routeName: 'F', revenue: 100 })], false).bars[0];
    expect(flat?.description).toBe('F: ₹100 modelled revenue (flat fare, length not known)');
    const known = heroBars(
      [route({ routeName: 'K', revenue: 100, revenueBasis: 'length_known', lengthKm: 40 })],
      false,
    ).bars[0];
    expect(known?.description).toBe('K: ₹100 modelled revenue');
  });
  it('offers no toggle when every route fits', () => {
    const hero = heroBars(routes.slice(0, 3), false);
    expect(hero.toggleLabel).toBeNull();
  });
  it('sizes bars in proportion to rounded revenue, never below zero', () => {
    const hero = heroBars([route({ routeName: 'X', revenue: 400 }), route({ routeName: 'Y', revenue: 100 })], false);
    expect(hero.bars.map((b) => b.widthPercent)).toEqual([100, 25]);
    expect(heroBars([route({ routeName: 'Z', revenue: 0 })], false).bars[0]?.widthPercent).toBe(0);
  });
  it('gives each bar a text equivalent', () => {
    expect(heroBars(routes, false).bars[0]?.description).toBe(
      'R0: ₹13,000 modelled revenue (flat fare, length not known)',
    );
  });
});

describe('route rows and headers', () => {
  it('carries the numeric length so the column can sort by it', () => {
    const [row] = buildRouteRows([
      route({ routeName: 'L', lengthKm: 41.6, lengthProvenance: 'derived', revenueBasis: 'length_known' }),
    ]);
    expect(row?.lengthKm).toBe(41.6);
    expect(buildRouteRows([route({ routeName: 'N' })])[0]?.lengthKm).toBeNull();
  });
  it('tags a modelled column header and a derived one', () => {
    expect(modelledHeader('Earnings per km')).toBe('Earnings per km (MODELLED)');
    expect(DERIVED_LENGTH_HEADER).toBe('Route length (DERIVED)');
  });
});

describe('modelledStatement', () => {
  const text = modelledStatement(REVENUE_MODEL_PARAMS).join(' ');
  it('says what is modelled, what a trip is and that these are planning assumptions', () => {
    expect(text).toContain('MODELLED');
    expect(text).toMatch(/no ticketing/i);
    expect(text).toMatch(/a trip is a run out and back/i);
    expect(text).toMatch(/for a route, load factor is the share of seats filled/i);
    expect(text).toMatch(/for a depot, occupied seats over seats offered, weighted by trips/i);
    expect(text).not.toMatch(/seat-kilometres over seat-kilometres/i);
    expect(text).toMatch(/earnings per kilometre are seats times load factor times the fare/i);
    expect(text).toMatch(/average boarding rides 45% of the route/i);
    expect(text).toMatch(/planning assumptions/i);
    expect(text).toMatch(/not the corporation's figures/i);
  });
  it('states the parameters from the model, not from a copy', () => {
    expect(text).toContain('ordinary 62%');
    expect(text).toContain('₹1.10');
    expect(text).toContain('₹45');
    expect(text).toContain('25%');
  });
  it('names what replaces it and never says simulated', () => {
    expect(text).toMatch(/ticketing feed and a route master/i);
    expect(text.toLowerCase()).not.toContain('simulated');
  });
});
