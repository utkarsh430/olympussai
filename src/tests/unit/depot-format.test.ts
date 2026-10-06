import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatFeedTime,
  formatOneDecimal,
  formatPlainDate,
  formatShare,
} from '@/lib/depot/format';

describe('formatCount', () => {
  it('uses Indian digit grouping', () => {
    expect(formatCount(1234567)).toBe('12,34,567');
    expect(formatCount(0)).toBe('0');
  });
});

describe('formatOneDecimal', () => {
  it('groups the whole part as formatCount does and always shows one decimal', () => {
    expect(formatOneDecimal(5503.5)).toBe('5,503.5');
    expect(formatOneDecimal(123456.78)).toBe('1,23,456.8');
    expect(formatOneDecimal(1000)).toBe('1,000.0');
    expect(formatOneDecimal(0)).toBe('0.0');
  });

  it('never prints a negative zero, and a negative with the true minus', () => {
    expect(formatOneDecimal(-0.04)).toBe('0.0');
    expect(formatOneDecimal(-1234.56)).toBe('−1,234.6');
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

describe('formatPlainDate', () => {
  it('writes a calendar date as day, month name and year', () => {
    expect(formatPlainDate('2026-10-07')).toBe('7 Oct 2026');
    expect(formatPlainDate('2027-01-31')).toBe('31 Jan 2027');
  });

  it('gives a dash for anything that is not a plain date', () => {
    expect(formatPlainDate('')).toBe('—');
    expect(formatPlainDate('2026-13-01')).toBe('—');
    expect(formatPlainDate('2026-10-00')).toBe('—');
    expect(formatPlainDate('2026-10-07T08:00:00Z')).toBe('—');
  });
});
