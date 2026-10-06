import { describe, expect, it } from 'vitest';
import {
  DUTY_LONGEST_TEXT,
  dutyColumnKeys,
  dutyColumnWidths,
  dutyTableTier,
  type DutyColumnKey,
  type DutyTableTier,
} from '@/lib/depot/duties/dutyTableLayout';
import { BREAKPOINT_PX, TABLE_FRAME_BORDER_PX, contentWidthAt } from '@/lib/depot/shell/geometry';
import { tableWidth } from '@/lib/depot/shell/tableWidth';

/* Each tier must fit the content column the shell leaves at the widths it is checked at
 * (1024, 800, the middle tier's narrowest 640 and a 390 px phone), so no column is cut. */
const FRAME_1024 = contentWidthAt(1024);
const FRAME_800 = contentWidthAt(800);
const FRAME_640 = contentWidthAt(BREAKPOINT_PX.sm);
const FRAME_390 = contentWidthAt(390);

/** JetBrains Mono's advance at the table's 13 px, and a cell's side padding (`px-3`). */
const MONO_13_ADVANCE_PX = 13 * 0.6;
const CELL_PADDING_PX = 12;

/** The table's width at a tier: its columns plus the shared expander column. */
const dutyTableWidth = (tier: DutyTableTier): number =>
  tableWidth(dutyColumnWidths(tier), dutyColumnKeys(tier), { expander: true });

describe('the duty table column sets', () => {
  it('picks the tier from the width', () => {
    expect(dutyTableTier(false, false)).toBe('wide');
    expect(dutyTableTier(true, false)).toBe('medium');
    expect(dutyTableTier(true, true)).toBe('phone');
  });

  it('shows every column from 1024 px, in 904 px', () => {
    expect(dutyColumnKeys('wide')).toEqual(['route', 'class', 'start', 'end', 'state', 'bus', 'now']);
    expect(dutyTableWidth('wide')).toBe(904);
    expect(dutyTableWidth('wide')).toBeLessThanOrEqual(FRAME_1024);
  });

  it('shows route, start, state and bus from 640 px; class, end and how the bus stands are in the expander', () => {
    expect(dutyColumnKeys('medium')).toEqual(['route', 'start', 'state', 'bus']);
    expect(dutyTableWidth('medium')).toBe(456);
  });

  /*
   * The table's cells never wrap, so a column is as wide as its longest value whatever
   * width it is given: the frame must hold every column at its longest typical value.
   */
  const needs = (key: DutyColumnKey): number => {
    const text = DUTY_LONGEST_TEXT[key];
    return text === undefined ? 0 : text.length * MONO_13_ADVANCE_PX + 2 * CELL_PADDING_PX;
  };
  const laidOut = (tier: DutyTableTier): number => {
    const widths = dutyColumnWidths(tier);
    const grown = Object.fromEntries(
      dutyColumnKeys(tier).map((key) => [key, Math.max(widths[key], needs(key))]),
    ) as Partial<Record<DutyColumnKey, number>>;
    return tableWidth(grown, dutyColumnKeys(tier), { expander: true });
  };

  it('gives every shown column the room of its longest typical value', () => {
    expect(DUTY_LONGEST_TEXT).toMatchObject({
      route: 'KSB_1284_ORD_OUT',
      start: '23:45',
      state: 'Unmatched',
      bus: 'UP78FN5435',
    });
    for (const tier of ['medium', 'phone'] as const) {
      const widths = dutyColumnWidths(tier);
      for (const key of dutyColumnKeys(tier)) {
        expect(widths[key], `${tier} ${key}`).toBeGreaterThanOrEqual(needs(key));
      }
    }
  });

  it('fits its frame, hairlines included, from 640 px, with every value at its longest', () => {
    expect(laidOut('medium') + TABLE_FRAME_BORDER_PX).toBeLessThanOrEqual(FRAME_640);
    expect(laidOut('medium') + TABLE_FRAME_BORDER_PX).toBeLessThanOrEqual(FRAME_800);
  });

  it('fits a 390 px phone in 352 px: route, start and bus', () => {
    expect(dutyColumnKeys('phone')).toEqual(['route', 'start', 'bus']);
    expect(dutyTableWidth('phone')).toBe(352);
    expect(laidOut('phone')).toBeLessThanOrEqual(FRAME_390);
  });
});
