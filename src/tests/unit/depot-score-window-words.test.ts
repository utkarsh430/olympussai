import { describe, it, expect } from 'vitest';
import {
  exceptionWindowNote,
  scoreWindowPhrase,
  scoreWindowSentence,
  scoreWindowShort,
} from '@/lib/depot/network/scoreWindowWords';

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

  it('says a single snapshot plainly', () => {
    expect(scoreWindowPhrase(ONE, FEED)).toBe('from the latest snapshot only');
    expect(scoreWindowShort(ONE, FEED)).toBe('latest snapshot');
  });

  it('falls back to the latest snapshot when the response has no window (an older fixture)', () => {
    expect(scoreWindowPhrase(undefined, FEED)).toBe('from the latest snapshot only');
    expect(scoreWindowShort(undefined, null)).toBe('latest snapshot');
  });

  it('treats a window with no start time as a single snapshot rather than inventing one', () => {
    expect(scoreWindowShort({ lengthMin: 20, since: null, samples: 4 }, FEED)).toBe('latest snapshot');
  });

  it('separates the windowed depot exceptions from bus counts as of the feed time', () => {
    expect(exceptionWindowNote(FULL, FEED)).toBe(
      'Depot exceptions compare rates over the last 20 minutes; bus counts are as of 14:20.',
    );
  });
});
