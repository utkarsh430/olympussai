import { describe, expect, it } from 'vitest';
import {
  PREVENTIVE_COLUMN_WIDTH_PX,
  preventiveColumnKeys,
  preventiveExpanderKeys,
  preventiveTier,
  type PreventiveTier,
} from '@/lib/depot/maintenance/preventiveLayout';
import { contentWidthAt } from '@/lib/depot/shell/geometry';
import { tableWidth } from '@/lib/depot/shell/tableWidth';

/** The table's width at a tier: its columns, plus the expander column when it has one. */
const preventiveTableWidth = (tier: PreventiveTier): number =>
  tableWidth(PREVENTIVE_COLUMN_WIDTH_PX, preventiveColumnKeys(tier), {
    expander: preventiveExpanderKeys(tier).length > 0,
  });

/* Each tier fits the content column the shell leaves at the narrowest width it is checked at. */
describe('the preventive table column sets (round 3)', () => {
  it('picks the tier from the width', () => {
    expect(preventiveTier(false, false)).toBe('wide');
    expect(preventiveTier(true, false)).toBe('medium');
    expect(preventiveTier(true, true)).toBe('phone');
  });

  it('shows every column from 1024 px in 720 px, with no expander', () => {
    expect(preventiveColumnKeys('wide')).toHaveLength(5);
    expect(preventiveExpanderKeys('wide')).toEqual([]);
    expect(preventiveTableWidth('wide')).toBe(720);
    expect(preventiveTableWidth('wide')).toBeLessThanOrEqual(contentWidthAt(1024));
  });

  it('moves the odometer to the expander below 1024 px (604 px, fits 752 at 800)', () => {
    expect(preventiveExpanderKeys('medium')).toEqual(['odometer']);
    expect(preventiveTableWidth('medium')).toBe(604);
    expect(preventiveTableWidth('medium')).toBeLessThanOrEqual(contentWidthAt(800));
  });

  it('keeps registration and distance on a phone (324 px, fits 358 at 390)', () => {
    expect(preventiveColumnKeys('phone')).toEqual(['registration', 'next']);
    expect(preventiveExpanderKeys('phone')).toEqual(['class', 'odometer', 'age']);
    expect(preventiveTableWidth('phone')).toBe(324);
    expect(preventiveTableWidth('phone')).toBeLessThanOrEqual(contentWidthAt(390));
  });
});
