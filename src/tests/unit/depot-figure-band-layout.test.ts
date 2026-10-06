import { describe, expect, it } from 'vitest';
import {
  figureBandColumns,
  figureBandGridClasses,
  figureBandRows,
  type BandWidthTier,
} from '@/lib/depot/shell/figureBandLayout';

describe('a band of figures below 1024 px', () => {
  it.each<[number, BandWidthTier, readonly number[]]>([
    [1, 'phone', [1]],
    [1, 'tablet', [1]],
    [2, 'phone', [2]],
    [2, 'tablet', [2]],
    [3, 'phone', [3]],
    [3, 'tablet', [3]],
    [4, 'phone', [2, 2]],
    [4, 'tablet', [4]],
    [5, 'phone', [3, 2]],
    [5, 'tablet', [3, 2]],
  ])('%i figures on a %s go %j', (count, tier, rows) => {
    expect(figureBandRows(count, figureBandColumns(count, tier))).toEqual(rows);
  });

  it.each([2, 3, 4, 5])('never leaves one of %i figures alone on a row', (count) => {
    for (const tier of ['phone', 'tablet'] as const) {
      const rows = figureBandRows(count, figureBandColumns(count, tier));
      expect(rows).not.toContain(1);
    }
  });

  it('writes the grid classes for the columns it decides', () => {
    expect(figureBandGridClasses(4)).toBe('grid-cols-2 sm:grid-cols-4');
    expect(figureBandGridClasses(5)).toBe('grid-cols-3 sm:grid-cols-3');
    expect(figureBandGridClasses(3)).toBe('grid-cols-3 sm:grid-cols-3');
    expect(figureBandGridClasses(2)).toBe('grid-cols-2 sm:grid-cols-2');
    expect(figureBandGridClasses(1)).toBe('grid-cols-1 sm:grid-cols-1');
  });
});
