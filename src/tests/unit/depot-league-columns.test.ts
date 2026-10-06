import { describe, it, expect } from 'vitest';
import {
  CELL_PADDING_X_REM,
  FROZEN_KEYS,
  LEAGUE_COMPONENT_ORDER,
  NARROW_COMPONENTS,
  frozenBlockRem,
  frozenLayout,
  frozenStyle,
} from '@/lib/depot/league/leagueColumns';
import { DEI_COMPONENTS } from '@/lib/depot/score/config';

const PX_PER_REM = 16;
/** A 360px phone with 16px gutters and the frame's own 1px borders. */
const PHONE_FRAME_REM = (360 - 32 - 2) / PX_PER_REM;
/** 11px mono uppercase with 0.12em tracking: about 7.92px a character. */
const HEADER_CHAR_REM = 7.92 / PX_PER_REM;
const SORT_ARROW_REM = (4 + 12) / PX_PER_REM;

describe('league frozen block', () => {
  it('freezes Rank, Depot and Index in that order', () => {
    expect(FROZEN_KEYS).toEqual(['rank', 'depot', 'index']);
  });

  it('starts each frozen column exactly where the one before it ends, so nothing shows between', () => {
    for (const size of ['compact', 'wide'] as const) {
      const layout = frozenLayout(size);
      let left = 0;
      for (const column of layout) {
        expect(column.leftRem).toBeCloseTo(left, 6);
        left += column.widthRem;
      }
      expect(frozenBlockRem(size)).toBeCloseTo(left, 6);
    }
  });

  it('leaves room inside Rank for its sorted header, so no digit is pushed under Depot', () => {
    const rank = frozenLayout('wide')[0];
    expect(rank.innerRem).toBeGreaterThanOrEqual(4 * HEADER_CHAR_REM + SORT_ARROW_REM);
  });

  it('leaves room inside Index for the numeral and bar, and for the window line under its header', () => {
    expect(frozenLayout('wide')[2].innerRem).toBeGreaterThanOrEqual(7);
    expect(frozenLayout('compact')[2].innerRem).toBeGreaterThanOrEqual(11 * HEADER_CHAR_REM);
  });

  it('inner widths are the column width less the side padding and the borders', () => {
    const [rank, depot, index] = frozenLayout('wide');
    expect(rank.innerRem).toBeCloseTo(rank.widthRem - 2 * CELL_PADDING_X_REM - 2 / PX_PER_REM, 6);
    expect(depot.innerRem).toBeCloseTo(depot.widthRem - 2 * CELL_PADDING_X_REM, 6);
    expect(index.innerRem).toBeCloseTo(index.widthRem - 2 * CELL_PADDING_X_REM - 1 / PX_PER_REM, 6);
  });

  it('fits the compact block inside a phone-width frame', () => {
    expect(frozenBlockRem('compact')).toBeLessThanOrEqual(PHONE_FRAME_REM);
  });

  it('writes the arithmetic once as CSS properties for both sizes', () => {
    const style = frozenStyle(frozenLayout('compact')[1], frozenLayout('wide')[1]);
    expect(style).toEqual({
      '--frozen-left': '4.75rem',
      '--frozen-left-wide': '4.75rem',
      '--frozen-w': '8rem',
      '--frozen-w-wide': '13rem',
      '--frozen-inner': '6.5rem',
      '--frozen-inner-wide': '11.5rem',
    });
  });
});

describe('league column order', () => {
  it('puts schedule coverage and device integrity first, every component exactly once', () => {
    expect(LEAGUE_COMPONENT_ORDER.slice(0, 2)).toEqual(['scheduled', 'deviceHealth']);
    expect([...LEAGUE_COMPONENT_ORDER].sort()).toEqual(DEI_COMPONENTS.map((c) => c.key).sort());
  });

  it('keeps the two diagnostic columns in the narrow set', () => {
    expect([...NARROW_COMPONENTS]).toEqual(['scheduled', 'deviceHealth']);
  });
});
