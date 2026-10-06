import { describe, expect, it } from 'vitest';
import { noTrendSentence } from '@/lib/depot/forecast/trendsPageModel';

const GAP = {
  status: 'insufficient_history',
  historyDays: 9,
  required: 8,
  cause: 'gap',
  missingDate: '2026-09-27',
} as const;

describe('noTrendSentence', () => {
  it('names the date of a gap and how many days count since', () => {
    expect(noTrendSentence(GAP)).toBe(
      'No trend yet: the history is missing 27 Sep 2026, so only the 9 days since count, and a trend needs 8.',
    );
  });

  it('says a gap without a date rather than printing a broken one', () => {
    for (const missingDate of ['garbage', '2026-13-45', '']) {
      const sentence = noTrendSentence({ ...GAP, missingDate });
      expect(sentence).not.toMatch(/NaN|undefined|garbage/);
      expect(sentence).toBe(
        'No trend yet: the history has a gap, so only the 9 days since count, and a trend needs 8.',
      );
    }
  });

  it('says a short record in days', () => {
    expect(
      noTrendSentence({ ...GAP, cause: 'short_record', missingDate: null, historyDays: 5 }),
    ).toBe('No trend yet: it needs 8 days of history and this series has 5.');
  });
});
