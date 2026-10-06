import { describe, expect, it } from 'vitest';
import { formatRupees } from '@/lib/depot/fuel/format';

describe('formatRupees', () => {
  it.each([
    [0, '₹0'],
    [-0, '₹0'],
    [-0.4, '₹0'],
    [0.4, '₹0'],
    [999, '₹999'],
    [1000, '₹1,000'],
    [99999, '₹99,999'],
    [100000, '₹1,00,000'],
    [12345678, '₹1,23,45,678'],
    [-1234, '-₹1,234'],
    [-1234567, '-₹12,34,567'],
    [1234.5, '₹1,235'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatRupees(value)).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'withholds %s',
    (value) => {
      expect(formatRupees(value)).toBe('—');
    },
  );
});
