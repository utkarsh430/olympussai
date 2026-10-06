import { describe, expect, it } from 'vitest';
import { countPhrase, plainCountPhrase, pluralWord } from '@/lib/depot/format';

describe('the shared count helpers', () => {
  it('uses the singular for exactly one and the plural for zero and any other number', () => {
    expect(pluralWord(1, 'bus', 'buses')).toBe('bus');
    expect(pluralWord(0, 'bus', 'buses')).toBe('buses');
    expect(pluralWord(2, 'bus', 'buses')).toBe('buses');
  });

  it('groups the count as the pages do, while the plain phrase keeps the bare digits', () => {
    expect(countPhrase(12_045, 'bus', 'buses')).toBe('12,045 buses');
    expect(plainCountPhrase(12_045, 'bus', 'buses')).toBe('12045 buses');
    expect(countPhrase(1, 'duty', 'duties')).toBe('1 duty');
    expect(plainCountPhrase(1, 'duty', 'duties')).toBe('1 duty');
  });
});
