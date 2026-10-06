import { describe, expect, it } from 'vitest';
import {
  exceptionRows,
  selectionStatus,
  severityTotals,
  formatIndex,
  joinScores,
  kpiRows,
  rankedExtremes,
  unpositionedCount,
  unrankedSummary,
  type DepotRow,
} from '@/lib/depot/network/overviewModel';
import type { DepotSummary, NetworkKpis } from '@/lib/depot/types';
import type { DepotScore, RankReason } from '@/lib/depot/score/types';
import type { ExceptionKind } from '@/lib/depot/exceptions/types';

function depot(id: string, overrides: Partial<DepotSummary> = {}): DepotSummary {
  return {
    id,
    name: `Depot ${id}`,
    kind: 'depot',
    fleet: 40,
    status: { live: 20, stationary: 10, noSignal: 5, underMaintenance: 5, unknown: 0 },
    states: { inService: 15, onRoad: 5, standing: 10, dark: 5, offRoad: 5 },
    reporting: 35,
    positioned: 35,
    assigned: 20,
    powerCut: 0,
    tamperFlagged: 0,
    centroid: { lat: 26.8, lng: 80.9 },
    ...overrides,
  };
}

function score(depotId: string, index: number | null, reason: RankReason = 'ok'): DepotScore {
  const ranked = reason === 'ok' && index !== null;
  return {
    depotId,
    peerGroup: ranked ? 'medium' : null,
    ranked,
    reason,
    index,
    rank: ranked ? 1 : null,
    peerCount: ranked ? 12 : null,
    components: [],
  };
}

function rowsFor(entries: ReadonlyArray<[string, number | null, RankReason?]>): DepotRow[] {
  const depots = entries.map(([id]) => depot(id));
  const scores = entries.map(([id, index, reason]) => score(id, index, reason));
  return joinScores(depots, scores);
}

describe('joinScores', () => {
  it('pairs each depot with its score by id, keeping depot order', () => {
    const depots = [depot('b'), depot('a'), depot('c')];
    const scores = [score('a', 50), score('b', 60)];
    const rows = joinScores(depots, scores);
    expect(rows.map((row) => row.depot.id)).toEqual(['b', 'a', 'c']);
    expect(rows[0]?.score?.index).toBe(60);
    expect(rows[1]?.score?.index).toBe(50);
    expect(rows[2]?.score).toBeNull();
  });

  it('does not mutate its inputs', () => {
    const depots = Object.freeze([depot('a')]);
    const scores = Object.freeze([score('a', 10)]);
    expect(() => joinScores(depots, scores)).not.toThrow();
  });
});

describe('rankedExtremes', () => {
  it('returns the top five by index descending and the bottom five ascending', () => {
    const rows = rowsFor(
      Array.from({ length: 12 }, (_, i): [string, number] => [
        `d${String(i).padStart(2, '0')}`,
        i * 8,
      ]),
    );
    const { top, bottom } = rankedExtremes(rows);
    expect(top.map((row) => row.score?.index)).toEqual([88, 80, 72, 64, 56]);
    expect(bottom.map((row) => row.score?.index)).toEqual([0, 8, 16, 24, 32]);
  });

  it('breaks ties by depot id in both lists', () => {
    const rows = rowsFor([
      ['z', 50],
      ['a', 50],
      ['m', 50],
    ]);
    const { top } = rankedExtremes(rows);
    expect(top.map((row) => row.depot.id)).toEqual(['a', 'm', 'z']);
  });

  it('never lists a depot in both strips when few are ranked', () => {
    const rows = rowsFor([
      ['a', 10],
      ['b', 20],
      ['c', 30],
      ['d', 40],
      ['e', 50],
      ['f', 60],
      ['g', 70],
    ]);
    const { top, bottom } = rankedExtremes(rows);
    expect(top).toHaveLength(5);
    expect(bottom.map((row) => row.depot.id)).toEqual(['a', 'b']);
  });

  it('leaves out unranked depots and null indexes', () => {
    const rows = rowsFor([
      ['a', null, 'fleet_too_small'],
      ['b', null, 'not_a_depot'],
      ['c', 40],
    ]);
    const { top, bottom } = rankedExtremes(rows);
    expect(top.map((row) => row.depot.id)).toEqual(['c']);
    expect(bottom).toEqual([]);
  });

  it('is deterministic whatever the input order', () => {
    const entries: Array<[string, number]> = [
      ['a', 30],
      ['b', 30],
      ['c', 90],
      ['d', 10],
    ];
    const forward = rankedExtremes(rowsFor(entries));
    const reversed = rankedExtremes(rowsFor([...entries].reverse()));
    expect(forward.top.map((row) => row.depot.id)).toEqual(reversed.top.map((row) => row.depot.id));
  });
});

describe('unrankedSummary', () => {
  it('counts unranked depots by reason, and depots with no score at all', () => {
    const rows = [
      ...rowsFor([
        ['a', null, 'fleet_too_small'],
        ['b', null, 'fleet_too_small'],
        ['c', null, 'not_a_depot'],
        ['d', 55],
      ]),
      { depot: depot('e'), score: null },
    ];
    expect(unrankedSummary(rows)).toEqual({
      total: 4,
      fleetTooSmall: 2,
      notADepot: 1,
      unscored: 1,
    });
  });
});

describe('unpositionedCount', () => {
  it('counts depots without a centroid', () => {
    const depots = [depot('a'), depot('b', { centroid: null }), depot('c', { centroid: null })];
    expect(unpositionedCount(depots)).toBe(2);
  });
});

describe('kpiRows', () => {
  const kpis: NetworkKpis = {
    fleet: { value: 200, provenance: 'live' },
    depots: { value: 12, provenance: 'live' },
    reporting: { value: 150, provenance: 'derived' },
    onRoad: { value: 100, provenance: 'derived' },
    stationary: { value: 50, provenance: 'live' },
    noSignal: { value: 25, provenance: 'live' },
    underMaintenance: { value: 10, provenance: 'live' },
    assigned: { value: 120, provenance: 'live' },
  };

  it('returns the eight figures in a fixed order with labels', () => {
    const rows = kpiRows(kpis);
    expect(rows.map((row) => row.key)).toEqual([
      'fleet',
      'depots',
      'reporting',
      'onRoad',
      'stationary',
      'noSignal',
      'underMaintenance',
      'assigned',
    ]);
    rows.forEach((row) => expect(row.label.length).toBeGreaterThan(0));
  });

  it('gives a share of fleet for bus counts only', () => {
    const rows = kpiRows(kpis);
    const byKey = new Map(rows.map((row) => [row.key, row.share]));
    expect(byKey.get('fleet')).toBeNull();
    expect(byKey.get('depots')).toBeNull();
    expect(byKey.get('reporting')).toBe('75%');
    expect(byKey.get('noSignal')).toBe('13%');
  });

  it('shows a dash, not NaN, when the fleet is zero', () => {
    const rows = kpiRows({ ...kpis, fleet: { value: 0, provenance: 'live' } });
    rows.forEach((row) => expect(row.share ?? '').not.toContain('NaN'));
    expect(rows.find((row) => row.key === 'onRoad')?.share).toBe('—');
  });
});

describe('exception summaries', () => {
  const counts: Record<ExceptionKind, number> = {
    dark_share_high: 2,
    off_road_high: 1,
    on_road_low: 0,
    power_cut_cluster: 3,
    long_dark: 40,
    power_cut: 7,
    tamper_code: 5,
    emergency: 1,
  };

  it('lists every kind with its count and severity word', () => {
    const rows = exceptionRows(counts);
    expect(rows).toHaveLength(8);
    const emergency = rows.find((row) => row.kind === 'emergency');
    expect(emergency).toMatchObject({ count: 1, severity: 'critical' });
    const dark = rows.find((row) => row.kind === 'dark_share_high');
    expect(dark?.severity).toBe('variable');
  });
});

describe('severityTotals', () => {
  it('totals the severity counts the server sends', () => {
    expect(severityTotals({ critical: 2, warning: 41, info: 12 })).toEqual({
      critical: 2,
      warning: 41,
      info: 12,
      total: 55,
    });
  });

  it('can differ from the sum of the kind counts, because depot-rate kinds split by z', () => {
    const counts: Record<ExceptionKind, number> = {
      dark_share_high: 2,
      off_road_high: 1,
      on_road_low: 0,
      power_cut_cluster: 3,
      long_dark: 40,
      power_cut: 7,
      tamper_code: 5,
      emergency: 1,
    };
    const kindSum = exceptionRows(counts).reduce((sum, row) => sum + row.count, 0);
    const totals = severityTotals({ critical: 3, warning: 44, info: 12 });
    expect(kindSum).toBe(59);
    expect(totals.total).toBe(59);
    expect(totals.critical).not.toBe(1);
  });

  it('treats an invalid count as zero', () => {
    expect(severityTotals({ critical: Number.NaN, warning: -2, info: 4.4 })).toEqual({
      critical: 0,
      warning: 0,
      info: 4,
      total: 4,
    });
  });
});

describe('formatIndex', () => {
  it('shows one decimal, and a dash for a missing or invalid index', () => {
    expect(formatIndex(72)).toBe('72.0');
    expect(formatIndex(null)).toBe('—');
    expect(formatIndex(Number.NaN)).toBe('—');
  });
});

describe('selectionStatus', () => {
  it('names the depot and its index, or why it is unranked', () => {
    const [ranked, small] = rowsFor([
      ['a', 62.4],
      ['b', null, 'fleet_too_small'],
    ]);
    expect(selectionStatus(ranked ?? null)).toBe('Selected Depot a, index 62.4');
    expect(selectionStatus(small ?? null)).toBe(
      'Selected Depot b, not ranked: Fewer than 10 buses',
    );
    expect(selectionStatus(null)).toBe('');
  });
});
