import { describe, expect, it } from 'vitest';
import { DEI_COMPONENTS } from '@/lib/depot/score/config';
import { strongestAndWeakest } from '@/lib/depot/score/explain';
import type { DeiComponent, DepotScore } from '@/lib/depot/score/types';

function score(contributions: readonly number[], ranked = true): DepotScore {
  const components: DeiComponent[] = DEI_COMPONENTS.map((c, i) => ({
    key: c.key,
    value: 0.5,
    peerMedian: 0.5,
    z: ranked ? contributions[i] : null,
    contribution: ranked ? contributions[i] : 0,
  }));
  return {
    depotId: 'a',
    peerGroup: ranked ? 'all' : null,
    ranked,
    reason: ranked ? 'ok' : 'fleet_too_small',
    index: ranked ? 50 : null,
    rank: ranked ? 1 : null,
    peerCount: ranked ? 12 : null,
    components,
  };
}

describe('strongestAndWeakest', () => {
  it('picks the highest and lowest contribution', () => {
    const result = strongestAndWeakest(score([0.1, -0.4, 0.5, 0, 0.2]));
    expect(result.strongest?.key).toBe('dark');
    expect(result.weakest?.key).toBe('offRoad');
  });

  it('returns nulls for an unranked score', () => {
    expect(strongestAndWeakest(score([0, 0, 0, 0, 0], false))).toEqual({
      strongest: null,
      weakest: null,
    });
  });

  it('returns nulls when every contribution is equal', () => {
    expect(strongestAndWeakest(score([0.2, 0.2, 0.2, 0.2, 0.2]))).toEqual({
      strongest: null,
      weakest: null,
    });
  });

  it('breaks ties by the order of DEI_COMPONENTS', () => {
    const result = strongestAndWeakest(score([0.5, 0.5, -0.5, -0.5, 0]));
    expect(result.strongest?.key).toBe('onRoad');
    expect(result.weakest?.key).toBe('dark');
  });

  it('does not depend on the order of the components array', () => {
    const base = score([0.5, 0.5, -0.5, -0.5, 0]);
    const reversed = { ...base, components: [...base.components].reverse() };
    expect(strongestAndWeakest(reversed)).toEqual(strongestAndWeakest(base));
  });

  it('does not mutate its input', () => {
    const base = score([0.1, -0.4, 0.5, 0, 0.2]);
    const before = JSON.stringify(base);
    strongestAndWeakest(base);
    expect(JSON.stringify(base)).toBe(before);
  });
});
