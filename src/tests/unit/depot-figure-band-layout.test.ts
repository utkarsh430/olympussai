import { describe, expect, it } from 'vitest';
import {
  CAPTION_MAX_LINES,
  LAST_SPANS_CLASSES,
  bandWidthTier,
  figureBandColumns,
  figureBandGridClasses,
  figureBandLastSpans,
  figureBandRows,
  figureTextWidth,
  figureValuePx,
  figureValueWidth,
  type BandWidthTier,
} from '@/lib/depot/shell/figureBandLayout';

const BELOW_DESKTOP: readonly BandWidthTier[] = ['phone', 'narrowTablet', 'tablet'];

describe('a band of figures below 1024 px', () => {
  it('picks the tier from the viewport width', () => {
    expect(bandWidthTier(360)).toBe('phone');
    expect(bandWidthTier(639)).toBe('phone');
    expect(bandWidthTier(640)).toBe('narrowTablet');
    expect(bandWidthTier(768)).toBe('tablet');
    expect(bandWidthTier(1023)).toBe('tablet');
    expect(bandWidthTier(1024)).toBe('desktop');
  });

  it.each<[number, BandWidthTier, readonly number[], boolean]>([
    [1, 'phone', [1], false],
    [2, 'phone', [2], false],
    [3, 'phone', [2, 1], true],
    [4, 'phone', [2, 2], false],
    [5, 'phone', [2, 2, 1], true],
    [1, 'narrowTablet', [1], false],
    [2, 'narrowTablet', [2], false],
    [3, 'narrowTablet', [3], false],
    [4, 'narrowTablet', [2, 2], false],
    [5, 'narrowTablet', [3, 2], false],
    [1, 'tablet', [1], false],
    [2, 'tablet', [2], false],
    [3, 'tablet', [3], false],
    [4, 'tablet', [4], false],
    [5, 'tablet', [3, 2], false],
  ])('%i figures on a %s go %j (last spans the row: %s)', (count, tier, rows, spans) => {
    expect(figureBandRows(count, figureBandColumns(count, tier))).toEqual(rows);
    expect(figureBandLastSpans(count, tier)).toBe(spans);
  });

  it('has two columns on a phone whatever the count', () => {
    for (const count of [2, 3, 4, 5]) expect(figureBandColumns(count, 'phone')).toBe(2);
  });

  it.each([2, 3, 4, 5])('never leaves one of %i figures alone in part of a row', (count) => {
    for (const tier of BELOW_DESKTOP) {
      const rows = figureBandRows(count, figureBandColumns(count, tier));
      const alone = rows.at(-1) === 1;
      expect(!alone || figureBandLastSpans(count, tier)).toBe(true);
    }
  });

  it('writes the grid classes for the columns and the span it decides', () => {
    expect(figureBandGridClasses(5)).toBe(
      `grid-cols-2 sm:grid-cols-3 md:grid-cols-3 ${LAST_SPANS_CLASSES}`,
    );
    expect(figureBandGridClasses(4)).toBe('grid-cols-2 sm:grid-cols-2 md:grid-cols-4');
    expect(figureBandGridClasses(3)).toBe(
      `grid-cols-2 sm:grid-cols-3 md:grid-cols-3 ${LAST_SPANS_CLASSES}`,
    );
    expect(figureBandGridClasses(2)).toBe('grid-cols-2 sm:grid-cols-2 md:grid-cols-2');
    expect(figureBandGridClasses(1)).toBe('grid-cols-1 sm:grid-cols-1 md:grid-cols-1');
    expect(LAST_SPANS_CLASSES).toBe(
      '[&>li:last-child]:col-span-2 sm:[&>li:last-child]:col-span-1',
    );
  });

  it('gives a figure half the phone column, or all of it when it spans', () => {
    // 390: 358 px column + 17 px pull = 375; half is 187.5, less 33 px of hairline and padding.
    expect(figureTextWidth(5, 0, 390)).toBe(154.5);
    expect(figureTextWidth(5, 4, 390)).toBe(342);
    expect(figureTextWidth(5, 0, 360)).toBe(139.5);
    expect(figureTextWidth(3, 2, 360)).toBe(312);
    expect(figureTextWidth(5, 0, 640)).toBe(170);
    expect(figureTextWidth(4, 0, 640)).toBe(271.5);
    expect(figureTextWidth(4, 0, 768)).toBe(151.25);
    expect(figureTextWidth(5, 0, 1024)).toBe(159);
  });
});

/*
 * The widest values each page showed in the browser, by band size. Every one must fit
 * the narrowest cell of its band (a non-spanning cell) at every width checked.
 */
const REAL_VALUES: readonly { page: string; count: number; values: readonly string[] }[] = [
  { page: 'fleet distribution', count: 5, values: ['14 → 0', '620 → 593', '27 of 27', '1042.1'] },
  { page: 'fuel', count: 5, values: ['89 of 199', '16,386 km', '3,535.3 L', '₹3,25,249', '4.6'] },
  { page: 'revenue', count: 5, values: ['10,180', '53.4%', '₹4,71,344', '₹28.77'] },
  { page: 'overview', count: 5, values: ['10,000', '2,646', '5,616'] },
  { page: 'depot trends', count: 3, values: ['180', '179 to 190', '1 of 14'] },
  { page: 'maintenance', count: 3, values: ['10', '18', '27'] },
  { page: 'yard', count: 4, values: ['142 of 208', '119'] },
  { page: 'exceptions', count: 4, values: ['1,583', '675'] },
];

const WIDTHS = [360, 390, 640, 700, 768, 800, 1024, 1280, 1440];

describe('a figure value is never cut', () => {
  it('sets a value one step smaller on a phone, never below 11 px', () => {
    expect(figureValuePx(360)).toBe(20);
    expect(figureValuePx(639)).toBe(20);
    expect(figureValuePx(640)).toBe(24);
  });

  it('matches the widths the browser measured at 24 px', () => {
    expect(figureValueWidth('10,000', 24)).toBeCloseTo(86.4);
    expect(figureValueWidth('179 to 190', 24)).toBeCloseTo(144);
    // Measured 148 px: the arrow is drawn wider than the mono glyphs.
    expect(figureValueWidth('618 → 591', 24)).toBeGreaterThanOrEqual(148);
  });

  it.each(REAL_VALUES)('fits every $page value at every width', ({ count, values }) => {
    for (const width of WIDTHS) {
      const room = figureTextWidth(count, 0, width);
      for (const value of values) {
        expect(
          figureValueWidth(value, figureValuePx(width)),
          `${value} at ${width} px`,
        ).toBeLessThanOrEqual(room);
      }
    }
  });
});

/*
 * The widest captions the browser measured (sans 12 px, in px). Each must wrap to no more
 * than two lines in the narrowest cell of a band of four or five; 40 px a line is kept back for a
 * word that does not fit at a line's end.
 */
const REAL_CAPTIONS_PX: Readonly<Record<string, number>> = {
  '111 no duty · 78 duties unmatched': 192,
  '40 on the road, 50 from the yard': 177,
  'every eligible bus matched': 147,
  '59% heard · 21% assigned': 146,
  'under 10 buses or 5 peers': 144,
  'available buses, forecast': 137,
};
const WORD_SLACK_PX = 40;

describe('a band caption wraps instead of being cut', () => {
  it.each(Object.entries(REAL_CAPTIONS_PX))('"%s" takes at most two lines', (_text, px) => {
    for (const width of WIDTHS) {
      const room = Math.min(figureTextWidth(4, 0, width), figureTextWidth(5, 0, width));
      const lines = Math.ceil(px / (room - WORD_SLACK_PX));
      expect(lines, `at ${width} px`).toBeLessThanOrEqual(CAPTION_MAX_LINES);
    }
  });
});
