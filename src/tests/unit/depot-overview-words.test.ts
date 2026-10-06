import { describe, expect, it } from 'vitest';
import {
  KIND_FILTER_OPTIONS,
  TABLE_ROW_CAP,
  kpiLayout,
  tableCap,
  tableColumnKeys,
  tableHeading,
  unitCounts,
  unrankedSentence,
} from '@/lib/depot/network/overviewWords';
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

describe('unitCounts', () => {
  it('counts every unit, the operating depots among them, and the rest', () => {
    expect(unitCounts(UNITS)).toEqual({ units: 143, operating: 119, other: 24 });
  });
});

describe('kpiLayout', () => {
  const layout = kpiLayout(KPIS, UNITS);

  it('puts four bus figures in the primary row, in order', () => {
    expect(layout.primary.map((f) => f.label)).toEqual([
      'Fleet',
      'On road',
      'Stationary',
      'No signal',
    ]);
  });

  it('puts operating depots and three more figures in the secondary row', () => {
    expect(layout.secondary.map((f) => f.label)).toEqual([
      'Operating depots',
      'Reporting',
      'Under maintenance',
      'Route assigned',
    ]);
  });

  it('counts operating depots against units in the feed, never against buses', () => {
    const depots = layout.secondary[0]!;
    expect(depots.value).toBe(119);
    expect(depots.provenance).toBe('derived');
    expect(depots.note).toBe('of 143 units in the feed');
    const all = [...layout.primary, ...layout.secondary].map((f) => f.note ?? '').join(' ');
    expect(all).not.toMatch(/119 of 9,?989/);
  });

  it('gives bus counts their share of the fleet and no repeated figure', () => {
    expect(layout.primary[0]?.note).toBe('100% of fleet');
    expect(layout.primary[1]?.note).toBe('41% of fleet');
    expect(layout.secondary[1]?.note).toBe('27% of fleet');
    expect(layout.primary[1]?.note).not.toContain('4122');
  });

  it('states "x of N" only when the denominator is not the whole fleet', () => {
    expect(layout.secondary[3]?.note).toBe('22% of fleet · 2,204 of 9,000');
  });

  it('says "1 unit" for a single unit', () => {
    expect(kpiLayout(KPIS, [unit('a', 'depot')]).secondary[0]?.note).toBe(
      'of 1 unit in the feed',
    );
  });
});

describe('table wording', () => {
  it('names the table after the kind filter, with the count it shows', () => {
    expect(tableHeading('all')).toBe('All units');
    expect(tableHeading('depot')).toBe('Operating depots');
    expect(tableHeading('other')).toBe('Other units');
    expect(KIND_FILTER_OPTIONS.map((o) => o.label)).toEqual(['All', 'Operating depots', 'Other units']);
  });

  it('puts Reporting and Assigned ahead of the status mix', () => {
    const keys = tableColumnKeys('all', false);
    expect(keys.indexOf('reporting')).toBeLessThan(keys.indexOf('mix'));
    expect(keys.indexOf('assigned')).toBeLessThan(keys.indexOf('mix'));
    expect(keys[0]).toBe('name');
  });

  it('drops Kind when only operating depots are shown', () => {
    expect(tableColumnKeys('depot', false)).not.toContain('kind');
    expect(tableColumnKeys('other', false)).toContain('kind');
  });

  it('keeps depot, fleet, reporting, assigned, on road, no signal and index when narrow', () => {
    expect(tableColumnKeys('all', true)).toEqual([
      'name',
      'fleet',
      'reporting',
      'assigned',
      'onRoad',
      'noSignal',
      'index',
    ]);
  });

  it('caps the table and offers to show every row', () => {
    expect(TABLE_ROW_CAP).toBe(25);
    expect(tableCap(143, false)).toEqual({ capped: true, shown: 25, toggle: 'Show all 143' });
    expect(tableCap(143, true)).toEqual({ capped: false, shown: 143, toggle: 'Show first 25' });
    expect(tableCap(24, false)).toEqual({ capped: false, shown: 24, toggle: null });
  });
});

describe('unrankedSentence', () => {
  it('says which units are not ranked, in the shared terms', () => {
    expect(
      unrankedSentence({ total: 25, fleetTooSmall: 1, notADepot: 24, unscored: 0 }),
    ).toBe('25 units are not ranked: 1 operating depot with fewer than 10 buses, 24 other units.');
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
