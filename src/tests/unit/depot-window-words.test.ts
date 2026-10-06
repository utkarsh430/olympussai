import { describe, it, expect } from 'vitest';
import {
  exceptionWindowNote,
  scoreWindowPhrase,
  scoreWindowSentence,
  scoreWindowShort,
  depotWindowNote,
} from '@/lib/depot/score/windowWords';

const FEED = '2026-10-06T14:20:00Z';
const FULL = { lengthMin: 20, since: '2026-10-06T14:00:30Z', samples: 30 };
const SHORT = { lengthMin: 20, since: '2026-10-06T14:02:00Z', samples: 3 };
const ONE = { lengthMin: 20, since: '2026-10-06T14:20:00Z', samples: 1 };

describe('score window words', () => {
  it('says the full window when the oldest sample is within a minute of its length', () => {
    expect(scoreWindowPhrase(FULL, FEED)).toBe('over the last 20 minutes');
    expect(scoreWindowSentence(FULL, FEED)).toBe('Efficiency index over the last 20 minutes.');
    expect(scoreWindowShort(FULL, FEED)).toBe('last 20 min');
  });

  it('says since when, and how many snapshots, while the window is still filling', () => {
    expect(scoreWindowPhrase(SHORT, FEED)).toBe('since 14:02, 3 snapshots');
    expect(scoreWindowSentence(SHORT, FEED)).toBe('Efficiency index since 14:02, 3 snapshots.');
    expect(scoreWindowShort(SHORT, FEED)).toBe('since 14:02');
  });

  it('says a single snapshot plainly, with its time', () => {
    expect(scoreWindowPhrase(ONE, FEED)).toBe('from one snapshot at 14:20');
    expect(scoreWindowSentence(ONE, FEED)).toBe('Efficiency index from one snapshot at 14:20.');
    expect(scoreWindowShort(ONE, FEED)).toBe('one snapshot at 14:20');
  });

  it('falls back to one snapshot at the feed time when the response has no window', () => {
    expect(scoreWindowPhrase(undefined, FEED)).toBe('from one snapshot at 14:20');
    expect(scoreWindowShort(undefined, null)).toBe('one snapshot');
  });

  it('treats a window with no start time as a single snapshot rather than inventing one', () => {
    expect(scoreWindowShort({ lengthMin: 20, since: null, samples: 4 }, FEED)).toBe(
      'one snapshot at 14:20',
    );
  });

  it('prefers the minutes the samples cover when the response carries them', () => {
    const covered = { ...SHORT, samples: 4, coveredMin: 6.2 };
    expect(scoreWindowPhrase(covered, FEED)).toBe('over the last 6 minutes');
    expect(scoreWindowShort(covered, FEED)).toBe('last 6 min');
    expect(scoreWindowPhrase({ ...FULL, coveredMin: 19.6 }, FEED)).toBe('over the last 20 minutes');
  });

  it('never says twenty minutes for one sample, whatever the window claims', () => {
    const one = { ...FULL, samples: 1, since: '2026-10-06T14:00:30Z', coveredMin: 0 };
    expect(scoreWindowPhrase(one, FEED)).toBe('from one snapshot at 14:00');
  });

  it('words the exceptions page note from the same phrase', () => {
    expect(depotWindowNote(FULL, FEED)).toBe(
      'Rates are compared with peers over the last 20 minutes; bus counts are as of 14:20.',
    );
    expect(depotWindowNote(ONE, null)).toBe(
      'Rates are compared with peers from one snapshot at 14:20; bus counts are as of the feed time.',
    );
  });

  it('separates the windowed depot exceptions from bus counts as of the feed time', () => {
    expect(exceptionWindowNote(FULL, FEED)).toBe(
      'Depot exceptions compare rates over the last 20 minutes; bus counts are as of 14:20.',
    );
  });
});
