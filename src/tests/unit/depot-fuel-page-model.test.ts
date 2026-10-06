import { describe, it, expect } from 'vitest';
import type { FuelGroupRow } from '@/lib/depot/fuel/types';
import {
  COST_NOTE,
  emptyText,
  formatCostPerKm,
  formatKmPerLitre,
  groupLabel,
  modelledStatement,
  noComparisonNote,
  noDistanceNote,
  peersDifferNote,
  routeCell,
  routeLabel,
  routeRows,
  ruleSentence,
} from '@/lib/depot/fuel/fuelPageModel';

const row = (over: Partial<FuelGroupRow> = {}): FuelGroupRow => ({
  key: 'ordinary',
  distanceKm: 460,
  fuelLitres: 100,
  cost: 9200,
  kmPerLitre: 4.6,
  costPerKm: 20,
  busCount: 2,
  ...over,
});

describe('formatters', () => {
  it('writes one decimal for km/litre and two for cost per km, a dash for null', () => {
    expect(formatKmPerLitre(4.6)).toBe('4.6');
    expect(formatKmPerLitre(null)).toBe('—');
    expect(formatCostPerKm(20)).toBe('₹20.00');
    expect(formatCostPerKm(null)).toBe('—');
  });
  it('labels the null key as no route', () => {
    expect(groupLabel(null)).toBe('No route');
    expect(groupLabel('12A')).toBe('12A');
  });
});


describe('routeRows', () => {
  it('adds a label and does not mutate', () => {
    const input = [row({ key: null })];
    expect(routeRows(input)[0]?.label).toBe('No route');
    expect(input[0]?.key).toBeNull();
  });
});

describe('sentences', () => {
  it('states the rule from the constants', () => {
    const s = ruleSentence(15, 2);
    expect(s).toContain('15%');
    expect(s).toContain('fewer than 2 peers has no comparison');
    expect(s).toContain('only when');
    expect(s).toContain('at least 2 of those peers lie within 15% of that median');
  });
  it('words the buses left unlisted', () => {
    expect(peersDifferNote(0, 15)).toBeNull();
    expect(peersDifferNote(1, 15)).toBe(
      '1 bus is above the 15% threshold but is not listed, because its peers differ too much to give a reliable median.',
    );
    expect(peersDifferNote(3, 15)).toBe(
      '3 buses are above the 15% threshold but are not listed, because their peers differ too much to give a reliable median.',
    );
    expect(noComparisonNote(0)).toBeNull();
    expect(noComparisonNote(2)).toBe(
      '2 buses have too few similar buses to compare and are not listed.',
    );
    expect(noComparisonNote(1)).toBe(
      '1 bus has too few similar buses to compare and is not listed.',
    );
  });
  it('words the no-distance note', () => {
    expect(noDistanceNote(0)).toBeNull();
    expect(noDistanceNote(1)).toBe(
      '1 bus has no distance in the modelled day and is not compared.',
    );
    expect(noDistanceNote(4)).toBe(
      '4 buses have no distance in the modelled day and are not compared.',
    );
  });
  it('explains an empty day', () => {
    // S41: an empty fuel page is a depot with no modelled duties, or one with no bus to run them.
    expect(emptyText()).toContain('No duties are modelled for this depot (no route');
    expect(emptyText()).not.toMatch(/today|\bran\b/);
    expect(
      emptyText({ duties: 3, routes: 1, busesRan: 0, buses: 2, dutiesWithoutBus: 3 }),
    ).toContain('no bus is available');
  });
});

describe('cost note', () => {
  it('says the cost is summed from each bus to the nearest rupee', () => {
    expect(COST_NOTE).toBe(
      'Fuel cost is summed from each bus’s fuel cost, each to the nearest rupee.',
    );
  });
});

describe('route rows with no distance and the Other row', () => {
  it('says No distance rather than listing zeros', () => {
    const none = row({ distanceKm: 0, fuelLitres: 0, cost: 0, kmPerLitre: null, costPerKm: null });
    for (const field of ['distance', 'litres', 'cost', 'kmpl', 'cpk'] as const) {
      expect(routeCell(none, field)).toBe('No distance');
    }
    const fuelOnly = row({
      distanceKm: 0,
      fuelLitres: 12,
      cost: 1104,
      kmPerLitre: null,
      costPerKm: null,
    });
    expect(routeCell(fuelOnly, 'distance')).toBe('No distance');
    expect(routeCell(fuelOnly, 'kmpl')).toBe('No distance');
    expect(routeCell(fuelOnly, 'litres')).toBe('12');
    expect(routeCell(row({ distanceKm: 300, fuelLitres: 60 }), 'distance')).toBe('300');
  });

  it('adds one Other routes row with its own key after the listed routes', () => {
    const other = { routeCount: 7, totals: row({ key: null, busCount: 9 }) };
    const rows = routeRows([row({ key: 'R1' })], other);
    expect(rows.map((r) => r.label)).toEqual(['R1', 'Other routes (7)']);
    expect(rows[1]?.busCount).toBe(9);
    expect(new Set(rows.map((r) => r.rowKey)).size).toBe(2);
    expect(routeRows([row({ key: 'R1' })], null)).toHaveLength(1);
  });
});

describe('route labels and row keys', () => {
  it('labels a route as it is named and a null route as No route', () => {
    expect(routeLabel(null)).toBe('No route');
    expect(routeLabel('ORD_1')).toBe('ORD_1');
    // A route named like a class is a route, not a class.
    expect(routeLabel('ac')).toBe('ac');
    expect(routeLabel('express')).toBe('express');
    expect(groupLabel('ac')).toBe('AC');
  });

  it('keys rows apart even when a route is literally named No route or like a class', () => {
    const rows = routeRows([
      row({ key: null }),
      row({ key: 'No route' }),
      row({ key: 'ac' }),
      row({ key: 'AC' }),
    ]);
    expect(new Set(rows.map((r) => r.rowKey)).size).toBe(4);
    expect(rows.map((r) => r.label)).toEqual(['No route', 'No route', 'ac', 'AC']);
  });
});

describe('wording rule', () => {
  it('never names a person, a cause or misconduct', () => {
    const banned =
      /theft|pilfer|misuse|driver|conductor|driving|engine|tyre|\bload\b|traffic|simulated/i;
    const all = [
      ruleSentence(15, 2),
      emptyText(),
      modelledStatement(),
      peersDifferNote(1, 15) ?? '',
      peersDifferNote(4, 15) ?? '',
      noComparisonNote(1) ?? '',
      noComparisonNote(3) ?? '',
      peersDifferNote(1, 15) ?? '',
      peersDifferNote(4, 15) ?? '',
      noComparisonNote(1) ?? '',
      noComparisonNote(3) ?? '',
      noDistanceNote(1) ?? '',
      noDistanceNote(3) ?? '',
    ];
    for (const text of all) expect(text).not.toMatch(banned);
  });
  it('states what is modelled and what real feeds replace it', () => {
    const s = modelledStatement();
    expect(s).toContain('MODELLED');
    expect(s).toContain('fuel issue records');
    expect(s).toContain('odometer readings');
  });
});
