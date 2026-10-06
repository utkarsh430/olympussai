import { describe, expect, it } from 'vitest';
import {
  DUTY_COLUMN_WIDTH_PX,
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

  it('shows every column from 1024 px, in 888 px', () => {
    expect(dutyColumnKeys('wide')).toEqual(['route', 'class', 'start', 'end', 'state', 'bus', 'now']);
    expect(dutyTableWidth('wide')).toBe(888);
    expect(dutyTableWidth('wide')).toBeLessThanOrEqual(FRAME_1024);
  });

  it('fits 800 px in 588 px: class and end go to the expander', () => {
    expect(dutyColumnKeys('medium')).toEqual(['route', 'start', 'state', 'bus', 'now']);
    expect(dutyTableWidth('medium')).toBe(588);
    expect(dutyTableWidth('medium')).toBeLessThanOrEqual(FRAME_800);
  });

  it('fits its frame, hairlines included, from 640 px, where the gutter is 24 px a side', () => {
    expect(dutyTableWidth('medium') + TABLE_FRAME_BORDER_PX).toBeLessThanOrEqual(FRAME_640);
  });

  it('cuts no typical value in the middle tier', () => {
    const widths = dutyColumnWidths('medium');
    // A cell is 13 px mono, whose every glyph is 0.6 em wide, inside 12 px of padding a side.
    const fits = (key: DutyColumnKey, text: string): boolean =>
      text.length * MONO_13_ADVANCE_PX + 2 * CELL_PADDING_PX <= widths[key];
    expect(fits('start', '23:45')).toBe(true);
    expect(fits('state', 'Unmatched')).toBe(true);
    expect(fits('bus', 'UP78FN5435')).toBe(true);
    // Only the middle tier is trimmed: the wide tier keeps its widths.
    expect(dutyColumnWidths('wide')).toBe(DUTY_COLUMN_WIDTH_PX);
  });

  it('fits a 390 px phone in 336 px: route, start and bus', () => {
    expect(dutyColumnKeys('phone')).toEqual(['route', 'start', 'bus']);
    expect(dutyTableWidth('phone')).toBe(336);
    expect(dutyTableWidth('phone')).toBeLessThanOrEqual(FRAME_390);
  });
});
