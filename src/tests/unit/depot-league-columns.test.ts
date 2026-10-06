import { describe, it, expect } from 'vitest';
import {
  CELL_PADDING_X_REM,
  FROZEN_KEYS,
  LEAGUE_COMPONENT_ORDER,
  LEAGUE_SCROLLING_COLUMNS,
  TIER_CLASS,
  frozenBlockRem,
  frozenColumn,
  frozenLayout,
  frozenStyle,
  tableWidthPx,
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
    const rank = frozenColumn('wide', 'rank');
    expect(rank.innerRem).toBeGreaterThanOrEqual(4 * HEADER_CHAR_REM + SORT_ARROW_REM);
  });

  it('leaves room inside Index for the numeral and bar, and for the window line under its header', () => {
    // numeral (2.5rem), gap (0.5rem) and bar (4rem) on one line
    expect(frozenColumn('wide', 'index').innerRem).toBeGreaterThanOrEqual(7);
    // "INDEX" and its sort arrow on ONE line, the window words being in the provenance line
    for (const size of ['compact', 'wide'] as const) {
      expect(frozenColumn(size, 'index').innerRem).toBeGreaterThanOrEqual(5 * HEADER_CHAR_REM + SORT_ARROW_REM);
    }
  });

  it('inner widths are the column width less the side padding and the borders', () => {
    const [rank, depot, index] = (['rank', 'depot', 'index'] as const).map((k) => frozenColumn('wide', k));
    expect(rank!.innerRem).toBeCloseTo(rank!.widthRem - 2 * CELL_PADDING_X_REM - 2 / PX_PER_REM, 6);
    expect(depot!.innerRem).toBeCloseTo(depot!.widthRem - 2 * CELL_PADDING_X_REM, 6);
    expect(index!.innerRem).toBeCloseTo(index!.widthRem - 2 * CELL_PADDING_X_REM - 1 / PX_PER_REM, 6);
  });

  it('fits the compact block inside a phone-width frame', () => {
    expect(frozenBlockRem('compact')).toBeLessThanOrEqual(PHONE_FRAME_REM);
  });

  it('writes the arithmetic once as CSS properties for both sizes', () => {
    const style = frozenStyle(frozenColumn('compact', 'depot'), frozenColumn('wide', 'depot'));
    expect(style).toEqual({
      '--frozen-left': '4.75rem',
      '--frozen-left-wide': '4.75rem',
      '--frozen-w': '10rem',
      '--frozen-w-wide': '11rem',
      '--frozen-inner': '8.5rem',
      '--frozen-inner-wide': '9.5rem',
    });
  });
});

describe('league column order', () => {
  it('puts schedule coverage and device integrity first, every component exactly once', () => {
    expect(LEAGUE_COMPONENT_ORDER.slice(0, 2)).toEqual(['scheduled', 'deviceHealth']);
    expect([...LEAGUE_COMPONENT_ORDER].sort()).toEqual(DEI_COMPONENTS.map((c) => c.key).sort());
  });

  it('shows schedule coverage, device integrity and on-road share from 640px, the rest wider', () => {
    const tierOf = (key: string) => LEAGUE_SCROLLING_COLUMNS.find((c) => c.key === key)?.tier;
    expect(['scheduled', 'deviceHealth', 'onRoad'].map(tierOf)).toEqual(['sm', 'sm', 'sm']);
    expect(['dark', 'offRoad', 'trend', 'fleet'].map(tierOf)).toEqual(['xl', 'xl', 'full', 'full']);
    expect(TIER_CLASS.full).toBe('hidden min-[1424px]:table-cell');
  });
});

/** Table frames measured in the capture (round 4): 1440 → 1,158px, 1024 → 774px, 800 → 750px. */
describe('league table width against its frame, so no column is cut and nothing scrolls sideways', () => {
  it.each([
    ['phone', 360 - 32 - 2],
    ['sm', 750],
    ['xl', 1280 - 282],
    ['full', 1424 - 282],
  ] as const)('fits the %s set inside a %ipx frame', (tier, frame) => {
    expect(tableWidthPx(tier)).toBeLessThanOrEqual(frame);
  });

  it('sums to about 1,141px at 1440, in the 1,158px frame', () => {
    expect(Math.round(tableWidthPx('full'))).toBe(1141);
  });
});
