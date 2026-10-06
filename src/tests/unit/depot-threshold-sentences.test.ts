import { describe, expect, it } from 'vitest';
import { TREND_TITLE } from '@/lib/depot/league/leagueGridColumns';
import { LEAGUE_HOW_PRODUCED } from '@/lib/depot/network/howProduced';
import { DEFAULT_SPARE_RATIO, MAX_SPARE_RATIO, MIN_SPARE_RATIO } from '@/lib/depot/optimise/config';
import { activeSpare, type ScenarioFormState } from '@/lib/depot/rebalance/scenarioForm';
import { MIN_FLEET_FOR_RANK } from '@/lib/depot/score/config';
import { DEFAULT_HISTORY_DAYS, MIN_PEER_FLEET, SPARE_RATIO_BOUNDS } from '@/lib/depot/sim/config';

/* Each threshold has one definition; every sentence that states one reads it. */

describe('the history length in sentences', () => {
  it('states the default history length from the constant', () => {
    expect(TREND_TITLE).toContain(`over the last ${DEFAULT_HISTORY_DAYS} days`);
    expect(LEAGUE_HOW_PRODUCED.join(' ')).toContain(`a generated ${DEFAULT_HISTORY_DAYS}-day history`);
  });
});

describe('one definition per threshold', () => {
  it('takes the peer fleet floor and the spare bounds from their owners', () => {
    expect(MIN_PEER_FLEET).toBe(MIN_FLEET_FOR_RANK);
    expect(SPARE_RATIO_BOUNDS).toEqual({ min: MIN_SPARE_RATIO, max: MAX_SPARE_RATIO });
  });

  it('treats the default spare as no change even where the percentage is not exact in floating point', () => {
    const at = (sparePercent: number | null) => activeSpare({ sparePercent } as ScenarioFormState);
    expect(at(DEFAULT_SPARE_RATIO * 100)).toBeNull();
    expect(at(Math.round(DEFAULT_SPARE_RATIO * 100))).toBeNull();
    expect(at(DEFAULT_SPARE_RATIO * 100 + 1)).toBe(DEFAULT_SPARE_RATIO * 100 + 1);
    expect(at(null)).toBeNull();
  });
});
