import { EXPANDER_WIDTH_PX as SHELL_EXPANDER_WIDTH_PX } from '@/components/depot/shell/tableLayout';
import { describe, expect, it } from 'vitest';
import {
  EXPANDER_WIDTH_PX,
  preventiveColumnKeys,
  preventiveExpanderKeys,
  preventiveTableWidth,
  preventiveTier,
} from '@/lib/depot/maintenance/preventiveLayout';

/* Content width with no rail below 1280 (16 px gutters): about 1,160 at 1440, 976 at
 * 1024, 752 at 800 and 358 at 390. */
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
    expect(preventiveTableWidth('wide')).toBeLessThanOrEqual(976);
  });

  it('moves the odometer to the expander below 1024 px (604 px, fits 752 at 800)', () => {
    expect(preventiveExpanderKeys('medium')).toEqual(['odometer']);
    expect(preventiveTableWidth('medium')).toBe(604);
    expect(preventiveTableWidth('medium')).toBeLessThanOrEqual(752);
  });

  it('keeps registration and distance on a phone (324 px, fits 358 at 390)', () => {
    expect(preventiveColumnKeys('phone')).toEqual(['registration', 'next']);
    expect(preventiveExpanderKeys('phone')).toEqual(['class', 'odometer', 'age']);
    expect(preventiveTableWidth('phone')).toBe(324);
    expect(preventiveTableWidth('phone')).toBeLessThanOrEqual(358);
  });

  it('counts the shell expander: the chevron is the first column, 24 px', () => {
    expect(EXPANDER_WIDTH_PX).toBe(SHELL_EXPANDER_WIDTH_PX);
  });
});
