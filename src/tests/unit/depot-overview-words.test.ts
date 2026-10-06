import { describe, expect, it } from 'vitest';
import {
  KIND_FILTER_OPTIONS,
  figureTag,
  kpiLayout,
  tableColumnKeys,
  tableHeading,
  unrankedSentence,
} from '@/lib/depot/network/overviewWords';
import { UNITS_PAGE_ROWS, pageOfKey } from '@/lib/depot/network/unitsTable';
import type { DepotKind, DepotSummary, NetworkKpis } from '@/lib/depot/types';

function unit(id: string, kind: DepotKind): Pick<DepotSummary, 'id' | 'kind'> {
  return { id, kind };
}

/** 143 units: 119 operating depots and 24 others, as on the captured snapshot. */
const UNITS = [
  ...Array.from({ length: 119 }, (_, i) => unit(`d${i}`, 'depot')),
  ...Array.from({ length: 20 }, (_, i) => unit(`e${i}`, 'enforcement')),
  unit('h', 'hired'),
  unit('el', 'electric'),
  unit('el2', 'electric'),
  unit('unassigned', 'unassigned'),
];

const FLEET = 9989;
const of = (n: number) => ({ n, of: FLEET });
const KPIS: NetworkKpis = {
  fleet: { value: FLEET, provenance: 'live', coverage: of(FLEET) },
  depots: { value: 119, provenance: 'derived', coverage: of(119) },
  reporting: { value: 2662, provenance: 'derived', coverage: of(2662) },
  onRoad: { value: 4122, provenance: 'live', coverage: of(4122) },
  stationary: { value: 4120, provenance: 'live', coverage: of(4120) },
  noSignal: { value: 1470, provenance: 'live', coverage: of(1470) },
  underMaintenance: { value: 277, provenance: 'live', coverage: of(277) },
  assigned: { value: 2204, provenance: 'derived', coverage: { n: 2204, of: 9000 } },
};

describe('kpiLayout', () => {
  const layout = kpiLayout(KPIS, UNITS);

  it('makes one band of five: the fleet and the four states that partition it, in order', () => {
    expect(layout.figures.map((f) => f.label)).toEqual([
      'Fleet',
      'On road',
      'Standing',
      'Dark',
      'Off road',
    ]);
    const states = layout.figures.slice(1).reduce((sum, f) => sum + f.value, 0);
    // The captured snapshot's four states sum to 9,989 exactly; this fixture's to 9,989 too.
    expect(states).toBe(layout.figures[0]!.value);
  });

  it('carries reporting and route assigned as the fleet\'s caption, both shares of it', () => {
    const fleet = layout.figures[0]!;
    expect(fleet.note).toBe('27% reporting · 22% assigned');
    expect(fleet.detail).toBe('2,662 reporting; 2,204 route assigned · 2,204 of 9,000');
  });

  it('counts operating depots against units in the feed, never against buses, on the map label', () => {
    expect(layout.unitsLine).toBe('143 units, 119 of them operating depots');
    const all = layout.figures.map((f) => `${f.note ?? ''} ${f.detail ?? ''}`).join(' ');
    expect(all).not.toMatch(/119/);
  });

  it('gives each state its share of the fleet and no repeated figure', () => {
    expect(layout.figures[1]?.note).toBe('41% of fleet');
    expect(layout.figures[4]?.note).toBe('3% of fleet');
    expect(layout.figures[1]?.note).not.toContain('4122');
  });

  it('says "1 unit" for a single unit, and "all" when every unit is a depot', () => {
    const one = { ...KPIS, depots: { ...KPIS.depots, value: 1 } };
    expect(kpiLayout(one, [unit('a', 'depot')]).unitsLine).toBe('1 unit, an operating depot');
    const none = { ...KPIS, depots: { ...KPIS.depots, value: 0 } };
    expect(kpiLayout(none, [unit('a', 'hired'), unit('b', 'hired')]).unitsLine).toBe(
      '2 units, none of them an operating depot',
    );
    const all = { ...KPIS, depots: { ...KPIS.depots, value: 2 } };
    expect(kpiLayout(all, [unit('a', 'depot'), unit('b', 'depot')]).unitsLine).toBe(
      '2 units, all operating depots',
    );
  });
});

describe('figure tags', () => {
  it('tags only a figure whose provenance differs from the page default', () => {
    expect(figureTag('live')).toBeUndefined();
    expect(figureTag('derived')).toBeUndefined();
    expect(figureTag('modelled')).toBe('modelled');
  });
});

describe('table wording', () => {
  it('names the table after the kind filter, with no count (the pager is the only count)', () => {
    expect(tableHeading('all')).toBe('All units');
    expect(tableHeading('depot')).toBe('Operating depots');
    expect(tableHeading('other')).toBe('Other units');
    expect(KIND_FILTER_OPTIONS.map((o) => o.label)).toEqual([
      'All',
      'Operating depots',
      'Other units',
    ]);
  });

  it('puts Reporting and Assigned ahead of the status mix', () => {
    const keys = tableColumnKeys('full');
    expect(keys.indexOf('reporting')).toBeLessThan(keys.indexOf('mix'));
    expect(keys.indexOf('assigned')).toBeLessThan(keys.indexOf('mix'));
    expect(keys[0]).toBe('name');
  });

  // KIND is never a column now (a muted suffix on a non-depot name); the tier sets are pinned
  // in depot-overview-round2-words.test.ts.

  it('finds the page that holds a selected unit, in the sorted order', () => {
    const keys = Array.from({ length: 60 }, (_, i) => `u${i}`);
    expect(UNITS_PAGE_ROWS).toBe(25);
    expect(pageOfKey(keys, 'u0')).toBe(0);
    expect(pageOfKey(keys, 'u24')).toBe(0);
    expect(pageOfKey(keys, 'u25')).toBe(1);
    expect(pageOfKey(keys, 'u59')).toBe(2);
    expect(pageOfKey(keys, 'gone')).toBeNull();
    expect(pageOfKey(keys, null)).toBeNull();
  });
});

describe('unrankedSentence', () => {
  it('says which units are not ranked, in the shared terms', () => {
    expect(unrankedSentence({ total: 25, fleetTooSmall: 1, notADepot: 24, unscored: 0 })).toBe(
      '25 units are not ranked: 1 operating depot with fewer than 10 buses, 24 other units.',
    );
    expect(unrankedSentence({ total: 1, fleetTooSmall: 0, notADepot: 1, unscored: 0 })).toBe(
      '1 unit is not ranked: 1 other unit.',
    );
    expect(unrankedSentence({ total: 3, fleetTooSmall: 3, notADepot: 0, unscored: 0 })).toBe(
      '3 units are not ranked: 3 operating depots with fewer than 10 buses.',
    );
    expect(unrankedSentence({ total: 2, fleetTooSmall: 0, notADepot: 0, unscored: 2 })).toBe(
      '2 units are not ranked: 2 without a score.',
    );
  });
});
