import { describe, it, expect } from 'vitest';
import {
  computedStamp,
  formatSignedDifference,
  leagueStatusLine,
  metricCellWording,
  peerRankPhrase,
} from '@/lib/depot/league/leagueWording';
import {
  DEFAULT_LEAGUE_FILTERS,
  selectedRowIn,
  showsPeerGroupColumn,
  unrankedSentence,
  type LeagueRow,
} from '@/lib/depot/league/leagueModel';
import { RANK_REASON_LABEL } from '@/lib/depot/labels';
import type { DepotKind } from '@/lib/depot/types';
import type { RankReason } from '@/lib/depot/score/types';

function depot(id: string, kind: DepotKind): { id: string; kind: DepotKind } {
  return { id, kind };
}

function score(depotId: string, reason: RankReason): {
  depotId: string;
  ranked: boolean;
  reason: RankReason;
} {
  return { depotId, ranked: reason === 'ok', reason };
}

describe('leagueStatusLine', () => {
  it('says the ruling sentence, built from the data', () => {
    const depots = [
      ...Array.from({ length: 118 }, (_, i) => depot(`r${i}`, 'depot')),
      depot('tiny', 'depot'),
      ...Array.from({ length: 20 }, (_, i) => depot(`h${i}`, 'hired')),
      depot('e', 'electric'),
      depot('f', 'enforcement'),
      depot('g', 'enforcement'),
      depot('unassigned', 'unassigned'),
    ];
    const scores = [
      ...Array.from({ length: 118 }, (_, i) => score(`r${i}`, 'ok')),
      score('tiny', 'fleet_too_small'),
      ...depots.filter((d) => d.kind !== 'depot').map((d) => score(d.id, 'not_a_depot')),
    ];
    expect(leagueStatusLine(depots, scores, 10)).toBe(
      '118 ranked of 119 operating depots · 1 not ranked (fewer than 10 buses) · ' +
        '24 other units not ranked',
    );
  });

  it('drops a clause whose count is zero and says one unit in the singular', () => {
    const depots = [depot('a', 'depot'), depot('b', 'hired')];
    const scores = [score('a', 'ok'), score('b', 'not_a_depot')];
    expect(leagueStatusLine(depots, scores, 10)).toBe(
      '1 ranked of 1 operating depot · 1 other unit not ranked',
    );
  });

  it('counts an operating depot with no score as not ranked', () => {
    expect(leagueStatusLine([depot('a', 'depot')], [], 10)).toBe(
      '0 ranked of 1 operating depot · 1 not ranked (fewer than 10 buses)',
    );
  });
});

describe('peerRankPhrase', () => {
  it('names the peer group so the count is not read as a depot total', () => {
    expect(peerRankPhrase(1, 41, 'Small fleets')).toBe(
      'rank 1 of 41 in its peer group (Small fleets)',
    );
  });
});

describe('formatSignedDifference', () => {
  it('signs with a real minus and a plus, one decimal, with the unit', () => {
    expect(formatSignedDifference(22.54, 'pp')).toBe('+22.5 pp');
    expect(formatSignedDifference(-5, 'pp')).toBe('−5.0 pp');
    expect(formatSignedDifference(3.25, 'pts')).toBe('+3.3 pts');
  });

  it('shows level as 0.0 and unknown as a dash', () => {
    expect(formatSignedDifference(0.04, 'pp')).toBe('0.0 pp');
    expect(formatSignedDifference(-0.04, 'pp')).toBe('0.0 pp');
    expect(formatSignedDifference(null, 'pp')).toBe('—');
  });
});

describe('metricCellWording', () => {
  const base = { label: 'On-road share', value: 0.924, peerMedian: 0.699, higherIsBetter: true };

  it('keeps the raw sign and says better when higher is better', () => {
    const cell = metricCellWording({ ...base, deltaPoints: 22.5 });
    expect(cell).toEqual({
      value: '92.4%',
      difference: '+22.5 pp',
      direction: 'better',
      description: 'On-road share 92.4%, 22.5 pp better than the peer median of 69.9%',
    });
  });

  it('says worse for a positive difference when lower is better (dark rate)', () => {
    const cell = metricCellWording({
      label: 'Dark rate',
      value: 0.2,
      peerMedian: 0.1,
      higherIsBetter: false,
      deltaPoints: 10,
    });
    expect(cell.difference).toBe('+10.0 pp');
    expect(cell.direction).toBe('worse');
    expect(cell.description).toBe('Dark rate 20.0%, 10.0 pp worse than the peer median of 10.0%');
  });

  it('says level for a difference that rounds to zero', () => {
    const cell = metricCellWording({ ...base, value: 0.5, peerMedian: 0.5, deltaPoints: 0 });
    expect(cell.difference).toBe('0.0 pp');
    expect(cell.direction).toBe('level');
    expect(cell.description).toBe('On-road share 50.0%, level with the peer median of 50.0%');
  });

  it('says when there is no peer median', () => {
    const cell = metricCellWording({ ...base, peerMedian: null, deltaPoints: null });
    expect(cell.difference).toBe('—');
    expect(cell.direction).toBe('unknown');
    expect(cell.description).toBe('On-road share 92.4%, no peer median to compare with');
  });
});

describe('league selection and columns', () => {
  const rows = [
    { depotId: 'a', name: 'A' },
    { depotId: 'b', name: 'B' },
  ] as unknown as readonly LeagueRow[];

  it('finds the selected row again once a filter that hid it is relaxed', () => {
    expect(selectedRowIn(rows.slice(0, 1), 'b')).toBeNull();
    expect(selectedRowIn(rows, 'b')?.depotId).toBe('b');
    expect(selectedRowIn(rows, null)).toBeNull();
  });

  it('shows the peer group column only when every peer group is shown', () => {
    expect(showsPeerGroupColumn({ ...DEFAULT_LEAGUE_FILTERS, peerGroup: 'any' })).toBe(true);
    expect(showsPeerGroupColumn({ ...DEFAULT_LEAGUE_FILTERS, peerGroup: 'small' })).toBe(false);
  });

  it('words a unit that is not an operating depot with the shared label', () => {
    const row = { ranked: false, kind: 'hired', fleet: 50 } as unknown as LeagueRow;
    expect(unrankedSentence(row)).toBe(RANK_REASON_LABEL.not_a_depot);
  });
});

describe('computedStamp', () => {
  it('reads the feed clock as HH:MM', () => {
    expect(computedStamp('2026-10-06T12:37:10+05:30')).toBe('Computed 12:37');
  });

  it('says the time is unknown when the feed carries none', () => {
    expect(computedStamp(null)).toBe('Computed at an unknown time');
  });
});
