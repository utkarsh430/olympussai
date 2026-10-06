import { describe, expect, it } from 'vitest';
import {
  buildLeagueRows,
  explainRow,
  filterLeagueRows,
  formatPoints,
  formatRate,
  describeDifference,
  unrankedSentence,
  type LeagueRow,
} from '@/lib/depot/league/leagueModel';
import type { DepotSummary, DepotKind } from '@/lib/depot/types';
import type { DeiComponent, DepotScore, PeerGroupId } from '@/lib/depot/score/types';

function depot(id: string, name: string, fleet: number, kind: DepotKind = 'depot'): DepotSummary {
  return { id, name, kind, fleet } as unknown as DepotSummary;
}

function components(contributions: readonly number[]): DeiComponent[] {
  const keys = ['onRoad', 'offRoad', 'dark', 'scheduled', 'deviceHealth'] as const;
  return keys.map((key, i) => ({
    key,
    value: 0.5,
    peerMedian: 0.4,
    z: contributions[i] ?? 0,
    contribution: contributions[i] ?? 0,
  }));
}

function score(
  depotId: string,
  peerGroup: PeerGroupId | null,
  rank: number | null,
  contributions: readonly number[] = [0, 0, 0, 0, 0],
): DepotScore {
  const ranked = rank !== null;
  return {
    depotId,
    peerGroup,
    ranked,
    reason: ranked ? 'ok' : 'fleet_too_small',
    index: ranked ? 80 - rank : null,
    rank,
    peerCount: ranked ? 10 : null,
    components: components(contributions),
  };
}

const DEPOTS = [
  depot('1', 'Alpha', 120),
  depot('2', 'Bravo', 40),
  depot('3', 'Charlie', 45),
  depot('4', 'Tiny', 3),
  depot('5', 'Squad', 20, 'enforcement'),
];
const SCORES: DepotScore[] = [
  score('1', 'large', 1),
  score('2', 'small', 2),
  score('3', 'small', 1),
  { ...score('4', null, null), reason: 'fleet_too_small' },
  { ...score('5', null, null), reason: 'not_a_depot' },
];

describe('buildLeagueRows', () => {
  const rows = buildLeagueRows(DEPOTS, SCORES);

  it('orders by peer group then rank, unranked last', () => {
    expect(rows.map((r) => r.name)).toEqual(['Charlie', 'Bravo', 'Alpha', 'Squad', 'Tiny']);
  });

  it('computes the difference from the peer median in percentage points', () => {
    const cell = rows[0]?.components[0];
    expect(cell?.deltaPoints).toBeCloseTo(10);
    expect(cell?.label).toBe('On-road share');
    expect(cell?.weight).toBe(0.35);
  });

  it('gives null difference when the value or the median is missing', () => {
    const missing: DepotScore = {
      ...score('1', 'large', 1),
      components: [{ key: 'onRoad', value: null, peerMedian: 0.4, z: null, contribution: 0 }],
    };
    const [row] = buildLeagueRows([DEPOTS[0] as DepotSummary], [missing]);
    expect(row?.components[0]?.deltaPoints).toBeNull();
  });

  it('keeps a depot with no score as unranked', () => {
    const [row] = buildLeagueRows([depot('9', 'Ghost', 50)], []);
    expect(row?.ranked).toBe(false);
    expect(row?.components).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const copy = [...DEPOTS];
    buildLeagueRows(DEPOTS, SCORES);
    expect(DEPOTS).toEqual(copy);
  });
});

describe('filterLeagueRows', () => {
  const rows = buildLeagueRows(DEPOTS, SCORES);

  it('hides unranked rows unless asked', () => {
    const shown = filterLeagueRows(rows, { peerGroup: 'any', search: '', showUnranked: false });
    expect(shown.map((r) => r.name)).toEqual(['Charlie', 'Bravo', 'Alpha']);
    const all = filterLeagueRows(rows, { peerGroup: 'any', search: '', showUnranked: true });
    expect(all).toHaveLength(5);
  });

  it('filters by peer group', () => {
    const shown = filterLeagueRows(rows, { peerGroup: 'small', search: '', showUnranked: true });
    expect(shown.map((r) => r.name)).toEqual(['Charlie', 'Bravo']);
  });

  it('searches names case-insensitively and trims', () => {
    const shown = filterLeagueRows(rows, {
      peerGroup: 'any',
      search: '  cHAR ',
      showUnranked: true,
    });
    expect(shown.map((r) => r.name)).toEqual(['Charlie']);
  });
});

describe('unrankedSentence', () => {
  const rows = buildLeagueRows(DEPOTS, SCORES);
  const byName = (n: string): LeagueRow => rows.find((r) => r.name === n) as LeagueRow;

  it('states the minimum and the depot fleet', () => {
    expect(unrankedSentence(byName('Tiny'))).toBe(
      'Needs at least 10 buses to be ranked; this depot has 3.',
    );
  });

  it('says so for units that are not operating depots', () => {
    expect(unrankedSentence(byName('Squad'))).toBe('Not an operating depot');
  });

  it('is null for a ranked depot', () => {
    expect(unrankedSentence(byName('Alpha'))).toBeNull();
  });
});

describe('explainRow', () => {
  it('names the strongest and weakest components by label', () => {
    const [row] = buildLeagueRows(
      [DEPOTS[0] as DepotSummary],
      [score('1', 'large', 1, [0.5, -0.4, 0.1, 0, 0])],
    );
    expect(explainRow(row as LeagueRow)).toBe(
      'Helped most by On-road share; held back most by Off-road rate.',
    );
  });

  it('says nothing stands out when contributions are equal', () => {
    const [row] = buildLeagueRows([DEPOTS[0] as DepotSummary], [score('1', 'large', 1)]);
    expect(explainRow(row as LeagueRow)).toBe(
      'No single measure stands out; every component contributes equally.',
    );
  });

  it('uses the unranked sentence for unranked depots', () => {
    const [row] = buildLeagueRows([DEPOTS[3] as DepotSummary], [SCORES[3] as DepotScore]);
    expect(explainRow(row as LeagueRow)).toBe(
      'Needs at least 10 buses to be ranked; this depot has 3.',
    );
  });
});

describe('formatters', () => {
  it('formats rates and signed point differences', () => {
    expect(formatRate(0.3125)).toBe('31.3%');
    expect(formatRate(null)).toBe('—');
    expect(formatPoints(2.04)).toBe('+2.0 pts');
    expect(formatPoints(-3.26)).toBe('−3.3 pts');
    expect(formatPoints(0.01)).toBe('0.0 pts');
    expect(formatPoints(null)).toBe('—');
  });
});

describe('describeDifference', () => {
  it('reads a positive difference as better when higher is better', () => {
    expect(describeDifference(3.04, true)).toEqual({
      text: '3.0 pts better than peers',
      direction: 'better',
    });
  });

  it('reads a positive difference as worse when lower is better', () => {
    expect(describeDifference(3.04, false)).toEqual({
      text: '3.0 pts worse than peers',
      direction: 'worse',
    });
  });

  it('reads a negative difference in the opposite direction', () => {
    expect(describeDifference(-2.26, true)).toEqual({
      text: '2.3 pts worse than peers',
      direction: 'worse',
    });
    expect(describeDifference(-2.26, false)).toEqual({
      text: '2.3 pts better than peers',
      direction: 'better',
    });
  });

  it('says level with peers at zero, including a difference that rounds to zero', () => {
    expect(describeDifference(0, true)).toEqual({ text: 'level with peers', direction: 'level' });
    expect(describeDifference(0.04, false)).toEqual({
      text: 'level with peers',
      direction: 'level',
    });
  });

  it('says there is no comparison when the peer median is unknown', () => {
    expect(describeDifference(null, true)).toEqual({
      text: 'no peer median',
      direction: 'unknown',
    });
  });

  it('carries higherIsBetter on each component cell', () => {
    const [row] = buildLeagueRows([DEPOTS[0] as DepotSummary], [score('1', 'large', 1)]);
    expect(row?.components.map((c) => c.higherIsBetter)).toEqual([true, false, false, true, true]);
  });
});
