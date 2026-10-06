import { describe, expect, it } from 'vitest';
import {
  PREVENTIVE_COLUMN_WIDTH_PX,
  preventiveColumnKeys,
  preventiveColumnWidth,
  preventiveExpanderKeys,
  preventiveHeader,
  preventiveTier,
  type PreventiveTier,
} from '@/lib/depot/maintenance/preventiveLayout';
import { contentWidthAt, tableRoomAt } from '@/lib/depot/shell/geometry';
import { EXPANDER_WIDTH_PX, tableWidth } from '@/lib/depot/shell/tableWidth';

/** The table's width at a tier: its columns, plus the expander column when it has one. */
const preventiveTableWidth = (tier: PreventiveTier): number =>
  tableWidth(PREVENTIVE_COLUMN_WIDTH_PX, preventiveColumnKeys(tier), {
    expander: preventiveExpanderKeys(tier).length > 0,
  });

/* Each tier fits the content column the shell leaves at the narrowest width it is checked at. */
describe('the preventive table column sets', () => {
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

  it('keeps registration and distance on a phone, both inside the 326 px frame at 360', () => {
    expect(preventiveColumnKeys('phone')).toEqual(['registration', 'next']);
    expect(preventiveExpanderKeys('phone')).toEqual(['class', 'odometer', 'age']);
    expect(preventivePhoneTableWidth()).toBe(314);
    expect(preventivePhoneTableWidth()).toBeLessThanOrEqual(tableRoomAt(360));
  });

  it('gives each phone column room for its whole header, so no header widens the table', () => {
    for (const key of preventiveColumnKeys('phone')) {
      const header = preventiveHeader(key, 'phone');
      expect(sortableHeaderWidth(header), header).toBeLessThanOrEqual(
        preventiveColumnWidth(key, 'phone'),
      );
    }
    // The wide header stays wherever the table has the room for it.
    expect(preventiveHeader('next', 'medium')).toBe('To next service, km');
    expect(preventiveHeader('next', 'phone')).toBe('Km to service');
  });
});

/** The phone table: the expander and the two columns at their phone widths. */
const preventivePhoneTableWidth = (): number =>
  preventiveColumnKeys('phone').reduce(
    (sum, key) => sum + preventiveColumnWidth(key, 'phone'),
    EXPANDER_WIDTH_PX,
  );

/**
 * A sortable header's drawn width: mono 11 px capitals with 0.12 em tracking (7.92 px a
 * character, measured in the browser), the 12 px sort arrow and its 4 px gap, and the
 * cell's 12 px padding each side.
 */
const sortableHeaderWidth = (header: string): number => header.length * 7.92 + 16 + 24;
