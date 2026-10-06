import { describe, it, expect } from 'vitest';
import type { EconomicsDepotRow } from '@/lib/depot/revenue/api';
import type { DepotEconomicsScore, EconomicsComponent } from '@/lib/depot/revenue/types';
import {
  breakdownRows,
  buildEconomicsRows,
  BREAKDOWN_NOTE,
  INDEX_SEPARATION,
  describeDifference,
  economicsStatusLine,
  explainEconomics,
  filterEconomicsRows,
  formatComponentDifference,
  formatComponentValue,
} from '@/lib/depot/revenue/economicsPageModel';

function component(
  key: EconomicsComponent['key'],
  value: number | null,
  peerMedian: number | null,
  contribution = 0,
): EconomicsComponent {
  return {
    key,
    value,
    peerMedian,
    coverage: key === 'earningsPerKm' ? { n: 2, of: 4 } : null,
    z: contribution, contribution,
    provenance: 'modelled',
  };
}

function entry(
  id: string,
  over: Partial<DepotEconomicsScore> = {},
  row: Partial<EconomicsDepotRow> = {},
): EconomicsDepotRow {
  const score: DepotEconomicsScore = {
    depotId: id,
    peerGroup: 'all',
    ranked: true,
    reason: 'ok',
    missing: [],
    economicsIndex: 60,
    rank: 1,
    peerCount: 6,
    components: [
      component('earningsPerKm', 30, 25, 0.8),
      component('costPerKm', 20, 22, 0.3),
      component('loadFactor', 0.6, 0.55, -0.4),
    ],
    provenance: 'modelled',
    ...over,
  };
  return {
    depotId: id,
    name: `Depot ${id}`,
    kind: 'depot',
    fleet: 40,
    earningsCoverage: { n: 2, of: 2 },
    score,
    ...row,
  };
}

const UNRANKED_NO_LENGTH = entry('9', {
  ranked: false,
  reason: 'missing_component',
  missing: ['earningsPerKm'],
  economicsIndex: null,
  rank: null,
  peerCount: null,
  peerGroup: 'all',
});
const UNRANKED_SMALL = entry('8', {
  ranked: false,
  reason: 'fleet_too_small',
  economicsIndex: null,
  rank: null,
  peerGroup: null,
}, { fleet: 4 });
const UNRANKED_THIN = entry('6', {
  ranked: false,
  reason: 'thin_route_coverage',
  economicsIndex: null,
  rank: null,
  peerCount: null,
}, { earningsCoverage: { n: 1, of: 9 } });
const UNRANKED_GROUP = entry('5', {
  ranked: false,
  reason: 'peer_group_too_small',
  economicsIndex: null,
  rank: null,
  peerCount: null,
});
const OTHER_UNIT = entry('7', {
  ranked: false,
  reason: 'not_a_depot',
  economicsIndex: null,
  rank: null,
  peerGroup: null,
}, { kind: 'hired' });

describe('formatting', () => {
  it('formats rupee and share components in their own units', () => {
    expect(formatComponentValue('earningsPerKm', 30.456)).toBe('₹30.46 per km');
    expect(formatComponentValue('costPerKm', null)).toBe('—');
    expect(formatComponentValue('loadFactor', 0.6123)).toBe('61.2%');
  });
  it('signs a difference with a real minus and the unit', () => {
    expect(formatComponentDifference('earningsPerKm', 5)).toBe('+₹5.00 per km');
    expect(formatComponentDifference('costPerKm', -2)).toBe('−₹2.00 per km');
    expect(formatComponentDifference('loadFactor', 0.05)).toBe('+5.0 pp');
    expect(formatComponentDifference('loadFactor', 0.0001)).toBe('0.0 pp');
    expect(formatComponentDifference('costPerKm', null)).toBe('—');
  });
});

describe('describeDifference', () => {
  it('derives better or worse from whether higher is better, not from the sign', () => {
    expect(describeDifference('costPerKm', -2, false).direction).toBe('better');
    expect(describeDifference('costPerKm', 2, false).direction).toBe('worse');
    expect(describeDifference('earningsPerKm', 5, true).direction).toBe('better');
    expect(describeDifference('earningsPerKm', 0.001, true).direction).toBe('level');
    expect(describeDifference('loadFactor', null, true).direction).toBe('unknown');
  });
  it('writes the size and the word', () => {
    expect(describeDifference('costPerKm', 2, false).text).toBe('₹2.00 per km worse than peers');
  });
});

describe('buildEconomicsRows', () => {
  const rows = buildEconomicsRows([OTHER_UNIT, UNRANKED_SMALL, entry('2', { rank: 2 }), entry('1'), UNRANKED_NO_LENGTH]);
  it('orders ranked depots by peer group and rank, unranked after, biggest fleet first', () => {
    expect(rows.map((r) => r.depotId)).toEqual(['1', '2', '9', '7', '8']);
  });
  it('carries the index under its own name, never as an efficiency value', () => {
    expect(rows[0]?.economicsIndex).toBe(60);
    expect(Object.keys(rows[0] ?? {})).not.toContain('index');
  });
  it('says why a depot is not ranked', () => {
    expect(rows.find((r) => r.depotId === '9')?.reasonText).toBe(
      'No route has a known length, so earnings per kilometre cannot be modelled for this depot.',
    );
    expect(rows.find((r) => r.depotId === '8')?.reasonText).toMatch(/at least 10 buses/);
    expect(rows.find((r) => r.depotId === '7')?.reasonText).toMatch(/not an operating depot/i);
    expect(rows[0]?.reasonText).toBeNull();
  });
  it('gives each component a value, a signed difference and a word', () => {
    const cost = rows[0]?.cells.find((c) => c.key === 'costPerKm');
    expect(cost).toMatchObject({
      valueText: '₹20.00 per km',
      differenceText: '−₹2.00 per km',
      direction: 'better',
      higherIsBetter: false,
    });
  });
});

describe('filterEconomicsRows', () => {
  const rows = buildEconomicsRows([entry('1'), UNRANKED_NO_LENGTH]);
  it('hides unranked depots unless asked', () => {
    expect(filterEconomicsRows(rows, { showUnranked: false, search: '' })).toHaveLength(1);
    expect(filterEconomicsRows(rows, { showUnranked: true, search: '' })).toHaveLength(2);
  });
  it('searches names without regard to case', () => {
    expect(filterEconomicsRows(rows, { showUnranked: true, search: 'depot 9' })).toHaveLength(1);
  });
});

describe('economicsStatusLine', () => {
  it('counts ranked depots and each reason for the rest', () => {
    const line = economicsStatusLine([
      entry('1'),
      entry('2', { rank: 2 }),
      UNRANKED_NO_LENGTH,
      UNRANKED_SMALL,
      OTHER_UNIT,
    ]);
    expect(line).toBe(
      '2 ranked of 4 operating depots (MODELLED) · 1 not ranked: no route with a known length · 1 not ranked: fewer than 10 buses · 1 other unit is not an operating depot',
    );
  });
  it('counts the two coverage and group reasons on their own', () => {
    expect(economicsStatusLine([UNRANKED_THIN, UNRANKED_GROUP, UNRANKED_GROUP])).toBe(
      '0 ranked of 3 operating depots (MODELLED) · 1 not ranked: too few routes with a known length · 2 not ranked: its peer group has too few depots with complete figures',
    );
  });
  it('uses the singular for one operating depot and omits empty reasons', () => {
    expect(economicsStatusLine([entry('1', { peerCount: 1 })])).toBe(
      '1 ranked of 1 operating depot (MODELLED)',
    );
  });
});

describe('explainEconomics', () => {
  it('names the component that helped most and the one that held back most', () => {
    const [row] = buildEconomicsRows([entry('1')]);
    expect(row && explainEconomics(row)).toBe(
      'Helped most by Earnings per km; held back most by Load factor.',
    );
  });
  it('gives the reason for an unranked depot', () => {
    const [row] = buildEconomicsRows([UNRANKED_SMALL]);
    expect(row && explainEconomics(row)).toMatch(/at least 10 buses/);
  });
  it('words the two new reasons in plain terms', () => {
    const [thin] = buildEconomicsRows([UNRANKED_THIN]);
    const [group] = buildEconomicsRows([UNRANKED_GROUP]);
    expect(thin?.reasonText).toBe(
      'Not ranked: too few of its routes have a known length (1 of 9), so its earnings per kilometre are not used.',
    );
    expect(group?.reasonText).toBe(
      'Not ranked: its peer group has too few depots with complete figures to compare.',
    );
    expect(thin && explainEconomics(thin)).toBe(thin?.reasonText);
  });
  it('says nothing stands out when every contribution is level', () => {
    const level = entry('1', {
      components: [component('earningsPerKm', 1, 1), component('costPerKm', 1, 1), component('loadFactor', 1, 1)],
    });
    const [row] = buildEconomicsRows([level]);
    expect(row && explainEconomics(row)).toMatch(/no single measure stands out/i);
  });
});

describe('the two indices', () => {
  it('keeps them apart in one sentence that names each and the data behind it', () => {
    const sentence = `${INDEX_SEPARATION.lead}${INDEX_SEPARATION.linkText}${INDEX_SEPARATION.tail}`;
    expect(sentence).toContain('Depot Economics Index is MODELLED');
    expect(sentence).toContain('separate from the Depot Efficiency Index, which is built from live data');
    expect(sentence).not.toMatch(/\d/);
    expect(BREAKDOWN_NOTE.toLowerCase()).not.toContain('efficiency');
  });
});

describe('breakdownRows', () => {
  it('lists value, peer median, z, weight and contribution per component', () => {
    const [row] = buildEconomicsRows([entry('1')]);
    const rows = row ? breakdownRows(row, { earningsPerKm: 0.4, costPerKm: 0.35, loadFactor: 0.25 }) : [];
    expect(rows.map((r) => r.label)).toEqual(['Earnings per km', 'Cost per km', 'Load factor']);
    expect(rows[0]).toMatchObject({
      valueText: '₹30.00 per km',
      peerMedianText: '₹25.00 per km',
      zText: '+0.80',
      weightText: '40%',
      contributionText: '+0.80',
    });
    expect(rows[2]?.contributionText).toBe('−0.40');
    expect(rows[0]?.coverageText).toBe('2 of 4 routes');
    expect(rows[1]?.coverageText).toBeNull();
  });
});
