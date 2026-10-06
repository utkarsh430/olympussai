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

  it('puts four bus figures and operating depots in the band, five at most, in order', () => {
    expect(layout.primary.map((f) => f.label)).toEqual([
      'Fleet',
      'On road',
      'Standing',
      'Dark',
      'Operating depots',
    ]);
  });

  it('puts the three remaining figures in the second row of the band', () => {
    expect(layout.secondary.map((f) => f.label)).toEqual([
      'Reporting',
      'Off road',
      'Route assigned',
    ]);
  });

  it('counts operating depots against units in the feed, never against buses', () => {
    const depots = layout.primary[4]!;
    expect(depots.value).toBe(119);
    expect(depots.provenance).toBe('derived');
    expect(depots.note).toBe('of 143 units in the feed');
    const all = [...layout.primary, ...layout.secondary].map((f) => f.note ?? '').join(' ');
    expect(all).not.toMatch(/119 of 9,?989/);
  });

  it('gives bus counts their share of the fleet and no repeated figure', () => {
    expect(layout.primary[0]?.note).toBe('100% of fleet');
    expect(layout.primary[1]?.note).toBe('41% of fleet');
    expect(layout.secondary[0]?.note).toBe('27% of fleet');
    expect(layout.primary[1]?.note).not.toContain('4122');
  });

  it('states "x of N" only when the denominator is not the whole fleet', () => {
    expect(layout.secondary[2]?.note).toBe('22% of fleet · 2,204 of 9,000');
  });

  it('says "1 unit" for a single unit', () => {
    expect(kpiLayout(KPIS, [unit('a', 'depot')]).primary[4]?.note).toBe('of 1 unit in the feed');
  });
});

describe('figure tags and the quiet line', () => {
  it('tags only a figure whose provenance differs from the page default', () => {
    expect(figureTag('live')).toBeUndefined();
    expect(figureTag('derived')).toBeUndefined();
    expect(figureTag('modelled')).toBe('modelled');
  });

  it('gives a second-row figure its share as the caption, not a free line', () => {
    const reporting = kpiLayout(KPIS, UNITS).secondary[0]!;
    expect(reporting.label).toBe('Reporting');
    expect(reporting.note).toBe('27% of fleet');
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
