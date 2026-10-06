import { describe, expect, it } from 'vitest';
import {
  DUTY_COLUMN_WIDTH_PX,
  dutyColumnKeys,
  dutyTableTier,
  type DutyTableTier,
} from '@/lib/depot/duties/dutyTableLayout';
import { contentWidthAt } from '@/lib/depot/shell/geometry';
import { tableWidth } from '@/lib/depot/shell/tableWidth';

/* Each tier must fit the content column the shell leaves at the widths it is checked at
 * (1024, 800 and a 390 px phone), so no column is cut. */
const FRAME_1024 = contentWidthAt(1024);
const FRAME_800 = contentWidthAt(800);
const FRAME_390 = contentWidthAt(390);

/** The table's width at a tier: its columns plus the shared expander column. */
const dutyTableWidth = (tier: DutyTableTier): number =>
  tableWidth(DUTY_COLUMN_WIDTH_PX, dutyColumnKeys(tier), { expander: true });

describe('the duty table column sets (round 3)', () => {
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

  it('fits 800 px in 596 px: class and end go to the expander', () => {
    expect(dutyColumnKeys('medium')).toEqual(['route', 'start', 'state', 'bus', 'now']);
    expect(dutyTableWidth('medium')).toBe(596);
    expect(dutyTableWidth('medium')).toBeLessThanOrEqual(FRAME_800);
  });

  it('fits a 390 px phone in 336 px: route, start and bus', () => {
    expect(dutyColumnKeys('phone')).toEqual(['route', 'start', 'bus']);
    expect(dutyTableWidth('phone')).toBe(336);
    expect(dutyTableWidth('phone')).toBeLessThanOrEqual(FRAME_390);
  });
});
