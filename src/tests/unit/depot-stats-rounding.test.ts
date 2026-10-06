import { describe, expect, it } from 'vitest';
import {
  roundHalfAwayFromZero,
  roundOneDecimal,
  roundToDecimals,
  wholeTenths,
} from '@/lib/depot/stats/rounding';
import { median, medianOr } from '@/lib/depot/stats/robust';

describe('the shared rounding rules', () => {
  it('rounds a half up for the plain rules, and away from zero for the symmetric one', () => {
    expect(roundOneDecimal(0.25)).toBe(0.3);
    expect(roundOneDecimal(-0.25)).toBe(-0.2);
    expect(roundToDecimals(-0.25, 1)).toBe(-0.2);
    expect(roundToDecimals(1.2345, 2)).toBe(1.23);
    expect(roundHalfAwayFromZero(-0.25, 1)).toBe(-0.3);
    expect(roundHalfAwayFromZero(0.805 - 0.8, 2)).toBe(0.01);
    expect(roundHalfAwayFromZero(0.8 - 0.805, 2)).toBe(-0.01);
  });

  it('counts whole tenths and keeps a negative zero, which only the symmetric rule clears', () => {
    expect(wholeTenths(12.34)).toBe(123);
    expect(Object.is(wholeTenths(-0.04), -0)).toBe(true);
    expect(Object.is(roundHalfAwayFromZero(-0.004, 2), 0)).toBe(true);
  });
});

describe('the shared median for callers that need a number', () => {
  it("is the plain median for a sample and the caller's own answer for an empty one", () => {
    expect(medianOr([3, 1, 2, 10], 0)).toBe(2.5);
    expect(medianOr([], 0)).toBe(0);
    expect(medianOr([], NaN)).toBeNaN();
    expect(median([])).toBeNull();
  });
});
