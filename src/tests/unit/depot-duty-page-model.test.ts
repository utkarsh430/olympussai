import { describe, expect, it } from 'vitest';
import type { DutyBoardCounts } from '@/lib/depot/duties/api';
import {
  duplicateRowsSentence,
  dutyFigures,
  locationIgnoredSentence,
  unmatchedLine,
} from '@/lib/depot/duties/dutyPageModel';

const counts = (over: Partial<DutyBoardCounts> = {}): DutyBoardCounts => ({
  duties: 160,
  assigned: 44,
  unassigned: 116,
  spare: 16,
  excluded: { notInYard: 66, offRoad: 8, dark: 34 },
  ...over,
});

describe('dutyFigures', () => {
  it('gives the four figures in order', () => {
    const figures = dutyFigures({ counts: counts(), spareBuses: new Array(16).fill('X') });
    expect(figures.map((f) => [f.label, f.value])).toEqual([
      ['Duties', '160'],
      ['Matched', '44'],
      ['Unmatched', '116'],
      ['Spare buses', '16'],
    ]);
  });

  it('never calls an ineligible fleet "spare"', () => {
    const none = dutyFigures({ counts: counts({ assigned: 0 }), spareBuses: [] });
    expect(none[3]?.caption).toBe('none eligible');
  });
});

describe('unmatchedLine', () => {
  it('states the reason once, as counts', () => {
    expect(unmatchedLine({ counts: counts() })).toBe(
      'No bus for 116 duties. Held out of the matching: 66 not in the yard · 8 off the road · 34 dark.',
    );
  });

  it('never says "not in the yard" when location was ignored', () => {
    const line = unmatchedLine({ counts: counts(), eligibilityIgnoredLocation: true }) ?? '';
    expect(line).toContain('66 not standing on a recent report');
    expect(line).not.toContain('not in the yard');
  });

  it('is absent when every duty has a bus, and plain when nothing was held out', () => {
    expect(unmatchedLine({ counts: counts({ unassigned: 0 }) })).toBeNull();
    expect(
      unmatchedLine({
        counts: counts({ unassigned: 1, excluded: { notInYard: 0, offRoad: 0, dark: 0 } }),
      }),
    ).toBe('No bus for 1 duty. Every eligible bus of the class is on another duty.');
  });
});

describe('server context sentences', () => {
  it('says location was not used only when it was not', () => {
    expect(locationIgnoredSentence(true)).toContain('so location was not used');
    expect(locationIgnoredSentence(false)).toBeNull();
    expect(locationIgnoredSentence(undefined)).toBeNull();
  });

  it('counts repeated registrations left out', () => {
    expect(duplicateRowsSentence(2)).toBe('2 feed rows repeated a registration and were left out.');
    expect(duplicateRowsSentence(1)).toBe('1 feed row repeated a registration and was left out.');
    expect(duplicateRowsSentence(0)).toBeNull();
  });
});
