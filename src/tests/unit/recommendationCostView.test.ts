// How the console reads the engine's cost figures to a dispatcher.
//
// These are about the WORDS, because the words are the product here: an
// operator approves or declines a hold on the strength of this sentence.
// The console used to render `objectiveCost` as "distance from the ideal
// hold", which explained the controller's own rounding to someone who has
// no use for it; the value now means net passenger-seconds and has to read
// as a trade-off with a direction.
import { describe, it, expect } from 'vitest';
import { describeClampResidual, describeObjectiveCost } from '@/lib/ops/recommendationView';

describe('describeObjectiveCost', () => {
  it('reads a negative cost as a saving, in passenger-seconds', () => {
    const text = describeObjectiveCost(-158);
    expect(text).toContain('save');
    expect(text).toContain('158 passenger-seconds');
    expect(text).not.toContain('ideal hold');
  });

  it('says plainly when a hold costs more than it saves, rather than hiding the sign', () => {
    const text = describeObjectiveCost(42);
    expect(text).toContain('COST');
    expect(text).toContain('42 passenger-seconds');
  });

  it('has a distinct reading for break-even instead of calling it a saving of zero', () => {
    expect(describeObjectiveCost(0)).toContain('break even');
  });

  // The in-vehicle term is what makes this a trade rather than a headway
  // score, and a dispatcher deciding whether to hold a full bus needs to
  // know it was counted.
  it('says the delay to passengers on board was charged against the saving', () => {
    expect(describeObjectiveCost(-158)).toContain('already on board');
  });
});

describe('describeClampResidual', () => {
  it('reports an unclamped hold as exactly what the formula asked for', () => {
    expect(describeClampResidual(0)).toContain('nothing rounded it or capped it');
  });

  it('names the hold cap as the reason a hold came out short', () => {
    const text = describeClampResidual(2190);
    expect(text).toContain('2190s shorter');
    expect(text).toContain('hold cap');
  });
});
