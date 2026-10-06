import { describe, it, expect } from 'vitest';
import type { FuelGroupRow, FuelTotals } from '@/lib/depot/fuel/types';
import {
  classBars,
  emptyText,
  flaggedHeadline,
  formatCostPerKm,
  formatKmPerLitre,
  groupLabel,
  modelledStatement,
  noComparisonNote,
  noDistanceNote,
  peersDifferNote,
  routeLabel,
  routeRows,
  ruleSentence,
  summarySentence,
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

const totals = (over: Partial<FuelTotals> = {}): FuelTotals => ({
  distanceKm: 1,
  fuelLitres: 1,
  cost: 1,
  kmPerLitre: 1,
  costPerKm: 1,
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

describe('classBars', () => {
  it('scales widths against the longest bar and says so when a class has no distance', () => {
    const bars = classBars([
      row({ key: 'ordinary', kmPerLitre: 4.8 }),
      row({ key: 'ac', kmPerLitre: 2.4, busCount: 1 }),
      row({ key: 'premium', kmPerLitre: null, distanceKm: 0, busCount: 1 }),
    ]);
    expect(bars.map((b) => b.widthPct)).toEqual([100, 50, 0]);
    expect(bars[0]?.valueText).toBe('4.8 km/L');
    expect(bars[1]?.detail).toBe('1 bus, 460 km');
    expect(bars[2]?.valueText).toBe('No distance');
    expect(bars[2]?.detail).toBe('1 bus, no distance');
  });
  it('keeps near-equal values equal by comparing tenths', () => {
    const bars = classBars([row({ kmPerLitre: 4.04 }), row({ key: 'ac', kmPerLitre: 4.0 })]);
    expect(bars[0]?.widthPct).toBe(bars[1]?.widthPct);
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
  it('states the summary with Indian grouping, singular and plural', () => {
    const s = summarySentence(
      totals({ distanceKm: 12345.6, fuelLitres: 2500, cost: 230000, busCount: 1 }),
    );
    expect(s).toContain('1 bus');
    expect(s).toContain('₹2,30,000');
    expect(s).toContain('12,345.6 km');
    expect(summarySentence(totals({ busCount: 3 }))).toContain('3 buses');
  });
  it('names a defaulted price', () => {
    expect(summarySentence(totals(), { price: 92, defaulted: true })).toContain(
      'Cost uses a planning price of ₹92 per litre, not a quoted price',
    );
    expect(summarySentence(totals(), { price: 92, defaulted: false })).toContain(
      'Cost uses ₹92 per litre.',
    );
    expect(summarySentence(totals(), { price: 92, defaulted: false })).not.toContain('planning');
  });
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
    expect(noComparisonNote(2)).toBe('2 buses have too few similar buses to compare and are not listed.');
    expect(noComparisonNote(1)).toBe('1 bus has too few similar buses to compare and is not listed.');
  });
  it('never says no bus stands out without the sentence for an unlisted bus', () => {
    const none = { peersDiffer: 0, noComparison: 0, thresholdPct: 15 };
    expect(flaggedHeadline(0, 0, none)).toBe('No bus stands out from its peers today.');
    const some = flaggedHeadline(0, 0, { ...none, peersDiffer: 2 });
    expect(some).not.toBe('No bus stands out from its peers today.');
    expect(some).toContain('No bus is listed as standing out from its peers today.');
    expect(some).toContain('2 buses are above the 15% threshold');
    const other = flaggedHeadline(0, 0, { ...none, noComparison: 1 });
    expect(other).toContain('1 bus has too few similar buses to compare');
    expect(flaggedHeadline(2, 2, { ...none, peersDiffer: 2 })).toBe('2 buses stand out from their peers.');
  });
  it('words the flagged headline and the no-distance note', () => {
    expect(flaggedHeadline(0, 0)).toBe('No bus stands out from its peers today.');
    expect(flaggedHeadline(1, 1)).toBe('1 bus stands out from its peers.');
    expect(flaggedHeadline(60, 50)).toBe(
      '60 buses stand out from their peers; the 50 with the largest variance are listed.',
    );
    expect(noDistanceNote(0)).toBeNull();
    expect(noDistanceNote(1)).toBe('1 bus has no distance today and is not compared.');
    expect(noDistanceNote(4)).toBe('4 buses have no distance today and are not compared.');
  });
  it('explains an empty day', () => {
    expect(emptyText()).toContain('no bus has modelled distance');
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
    const banned = /theft|pilfer|misuse|driver|conductor|driving|engine|tyre|\bload\b|traffic|simulated/i;
    const all = [
      summarySentence(totals()),
      summarySentence(totals({ busCount: 1 }), { price: 90, defaulted: true }),
      ruleSentence(15, 2),
      emptyText(),
      modelledStatement(),
      flaggedHeadline(0, 0),
      flaggedHeadline(1, 1),
      flaggedHeadline(9, 5),
      flaggedHeadline(0, 0, { peersDiffer: 2, noComparison: 1, thresholdPct: 15 }),
      peersDifferNote(1, 15) ?? '',
      peersDifferNote(4, 15) ?? '',
      noComparisonNote(1) ?? '',
      noComparisonNote(3) ?? '',
      flaggedHeadline(0, 0, { peersDiffer: 2, noComparison: 1, thresholdPct: 15 }),
      peersDifferNote(1, 15) ?? '',
      peersDifferNote(4, 15) ?? '',
      noComparisonNote(1) ?? '',
      noComparisonNote(3) ?? '',
      noDistanceNote(1) ?? '',
      noDistanceNote(3) ?? '',
      ...classBars([row(), row({ distanceKm: 0, kmPerLitre: null })]).flatMap((b) => [
        b.valueText,
        b.detail,
        b.label,
      ]),
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
