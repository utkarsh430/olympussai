import { describe, expect, it } from 'vitest';
import {
  capitalise,
  countPhrase,
  formatPercent,
  formatPercentOneDecimal,
  plainCountPhrase,
  pluralWord,
  signedTwoDecimals,
  signedWhole,
} from '@/lib/depot/format';

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

describe('the shared sign, percent and capital helpers', () => {
  it('signs a whole number with "+0" for zero, and two decimals with a bare "0.00"', () => {
    expect(signedWhole(3)).toBe('+3');
    expect(signedWhole(-2)).toBe('−2');
    expect(signedWhole(0)).toBe('+0');
    expect(signedTwoDecimals(0.004)).toBe('0.00');
    expect(signedTwoDecimals(-1.3)).toBe('−1.30');
    expect(signedTwoDecimals(0.425)).toBe('+0.43');
  });

  it('gives a whole or one-decimal percentage, and capitalises the first letter only', () => {
    expect(formatPercent(0.456)).toBe('46%');
    expect(formatPercentOneDecimal(0.0456)).toBe('4.6%');
    expect(capitalise('driver on leave')).toBe('Driver on leave');
    expect(capitalise('')).toBe('');
  });
});
