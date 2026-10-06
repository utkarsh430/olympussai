import { describe, it, expect } from 'vitest';
import {
  formatSignedDifference,
  leagueSectionNote,
  metricCellWording,
  peerRankPhrase,
  windowMark,
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

describe('leagueSectionNote', () => {
  it('counts ranked of operating depots and says the index cell opens the breakdown, once', () => {
    const depots = [depot('a', 'depot'), depot('b', 'depot'), depot('h', 'hired')];
    const scores = [score('a', 'ok'), score('b', 'fleet_too_small'), score('h', 'not_a_depot')];
    expect(leagueSectionNote(depots, scores)).toBe(
      '1 of 2 ranked · the index cell opens how a score is made up',
    );
  });
});

describe('windowMark', () => {
  it('marks a depot scored on fewer snapshots than the window, in words and a title', () => {
    expect(windowMark(1, 8)).toEqual({ word: 'new', title: 'Scored on 1 snapshot so far, of 8 in the window.' });
    expect(windowMark(3, 8)?.title).toBe('Scored on 3 snapshots so far, of 8 in the window.');
  });

  it('leaves a depot scored on the whole window, or with no counts, unmarked', () => {
    expect(windowMark(8, 8)).toBeNull();
    expect(windowMark(undefined, 8)).toBeNull();
    expect(windowMark(1, undefined)).toBeNull();
  });
});
