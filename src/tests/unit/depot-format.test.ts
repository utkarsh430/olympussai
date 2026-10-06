import { describe, expect, it } from 'vitest';
import { formatCount, formatFeedTime, formatShare } from '@/lib/depot/format';

describe('formatCount', () => {
  it('uses Indian digit grouping', () => {
    expect(formatCount(1234567)).toBe('12,34,567');
    expect(formatCount(0)).toBe('0');
  });
});

describe('formatShare', () => {
  it('rounds to a whole-number percentage', () => {
    expect(formatShare(42, 100)).toBe('42%');
    expect(formatShare(1, 3)).toBe('33%');
    expect(formatShare(2, 3)).toBe('67%');
    expect(formatShare(0, 10)).toBe('0%');
  });

  it('returns a dash when the population is empty', () => {
    expect(formatShare(0, 0)).toBe('—');
    expect(formatShare(5, 0)).toBe('—');
  });
});

describe('formatFeedTime', () => {
  it('prints the wall-clock HH:MM in the string without timezone conversion', () => {
    expect(formatFeedTime('2026-10-06T14:02:31Z')).toBe('14:02');
    expect(formatFeedTime('2026-10-06T00:05:00.000Z')).toBe('00:05');
    expect(formatFeedTime('2026-10-06T09:30:00+05:30')).toBe('09:30');
  });

  it('returns a dash for null or unparsable input', () => {
    expect(formatFeedTime(null)).toBe('—');
    expect(formatFeedTime('')).toBe('—');
    expect(formatFeedTime('not a time')).toBe('—');
    expect(formatFeedTime('2026-10-06')).toBe('—');
    expect(formatFeedTime('2026-10-06T25:99:00Z')).toBe('—');
  });
});
