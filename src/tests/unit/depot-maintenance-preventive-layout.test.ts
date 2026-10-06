import { describe, expect, it } from 'vitest';
import {
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

  it('moves the odometer to the expander below 1024 px (616 px, fits 752 at 800)', () => {
    expect(preventiveExpanderKeys('medium')).toEqual(['odometer']);
    expect(preventiveTableWidth('medium')).toBe(616);
    expect(preventiveTableWidth('medium')).toBeLessThanOrEqual(752);
  });

  it('keeps registration and distance on a phone (336 px, fits 358 at 390)', () => {
    expect(preventiveColumnKeys('phone')).toEqual(['registration', 'next']);
    expect(preventiveExpanderKeys('phone')).toEqual(['class', 'odometer', 'age']);
    expect(preventiveTableWidth('phone')).toBe(336);
    expect(preventiveTableWidth('phone')).toBeLessThanOrEqual(358);
  });
});
