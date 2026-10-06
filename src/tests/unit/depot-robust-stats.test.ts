import { describe, expect, it } from 'vitest';
import {
  MAD_TO_SIGMA,
  MEAN_AD_TO_SIGMA,
  clamp,
  mad,
  meanAbsoluteDeviation,
  median,
  ratio,
  robustZ,
  tercileCuts,
} from '@/lib/depot/stats/robust';

describe('median', () => {
  it('takes the middle of an odd sample', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it('averages the middle pair of an even sample', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it('returns the single value of a one-value sample', () => {
    expect(median([7])).toBe(7);
  });
  it('returns null for an empty sample', () => {
    expect(median([])).toBeNull();
  });
  it('does not mutate its input', () => {
    const input = Object.freeze([3, 1, 2]);
    expect(median(input)).toBe(2);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('mad', () => {
  it('is the median absolute deviation from the median', () => {
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
  });
  it('is 0 for identical values', () => {
    expect(mad([5, 5, 5, 5])).toBe(0);
  });
  it('is null for an empty sample', () => {
    expect(mad([])).toBeNull();
  });
});

describe('robustZ', () => {
  it('matches a hand-computed value', () => {
    expect(robustZ(5, [1, 2, 3, 4, 100])).toBeCloseTo(2 / (MAD_TO_SIGMA * 1), 10);
  });
  it('is 0, never NaN or Infinity, when every value is identical', () => {
    expect(robustZ(5, [5, 5, 5])).toBe(0);
    expect(robustZ(9, [5, 5, 5])).toBe(0);
  });
  it('falls back to mean absolute deviation when most values are identical', () => {
    const sample = [1, 1, 1, 1, 1, 1, 0.9, 0.8];
    // median 1, MAD 0, meanAD 0.3 / 8 = 0.0375, so z(0.8) = -0.2 / (1.2533 * 0.0375).
    expect(MEAN_AD_TO_SIGMA).toBe(1.2533);
    expect(robustZ(0.8, sample)).toBeCloseTo(-4.2554, 4);
    expect(robustZ(0.9, sample)).toBeCloseTo(-2.1277, 4);
    expect(robustZ(1, sample)).toBe(0);
  });
  it('gives an unusually good value a positive z under the fallback', () => {
    const sample = [1, 1, 1, 1, 1, 1, 1, 1.5];
    expect(robustZ(1.5, sample)).toBeCloseTo(6.383, 4);
    expect(robustZ(1, sample)).toBe(0);
  });
  it('is null for an empty sample', () => {
    expect(robustZ(1, [])).toBeNull();
  });
  it('is 0 for the median itself', () => {
    expect(robustZ(3, [1, 2, 3, 4, 100])).toBe(0);
  });
});

describe('meanAbsoluteDeviation', () => {
  it('averages distances from the median', () => {
    expect(meanAbsoluteDeviation([1, 1, 1, 1, 1, 1, 0.9, 0.8])).toBeCloseTo(0.0375, 12);
  });
  it('is 0 for identical values and null when empty', () => {
    expect(meanAbsoluteDeviation([2, 2, 2])).toBe(0);
    expect(meanAbsoluteDeviation([])).toBeNull();
  });
});

describe('clamp', () => {
  it('limits both ends', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});

describe('tercileCuts', () => {
  it('splits nine values into three groups of three', () => {
    expect(tercileCuts([9, 8, 7, 6, 5, 4, 3, 2, 1])).toEqual([3, 6]);
  });
  it('handles two values', () => {
    expect(tercileCuts([10, 20])).toEqual([10, 20]);
  });
  it('returns null for an empty sample', () => {
    expect(tercileCuts([])).toBeNull();
  });
  it('does not mutate its input', () => {
    const input = Object.freeze([3, 1, 2]);
    tercileCuts(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('ratio', () => {
  it('divides', () => {
    expect(ratio(1, 4)).toBe(0.25);
  });
  it('is null when the denominator is 0', () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(3, 0)).toBeNull();
  });
});
