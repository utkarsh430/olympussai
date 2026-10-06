import { describe, expect, it } from 'vitest';
import {
  dutyColumnKeys,
  dutyTableTier,
  dutyTableWidth,
} from '@/lib/depot/duties/dutyTableLayout';

/* Content width with no rail below 1280 (16 px gutters): about 1,160 at 1440, 976 at
 * 1024, 752 at 800, 608 at 640 and 358 at 390. Each tier must fit the narrowest width
 * it serves, so no column is cut. */
const FRAME_1024 = 976;
const FRAME_640 = 640 - 32;
const FRAME_390 = 390 - 32;

describe('the duty table column sets (round 3)', () => {
  it('picks the tier from the width', () => {
    expect(dutyTableTier(false, false)).toBe('wide');
    expect(dutyTableTier(true, false)).toBe('medium');
    expect(dutyTableTier(true, true)).toBe('phone');
  });

  it('shows every column from 1024 px, in 900 px', () => {
    expect(dutyColumnKeys('wide')).toEqual(['route', 'class', 'start', 'end', 'state', 'bus', 'now']);
    expect(dutyTableWidth('wide')).toBe(900);
    expect(dutyTableWidth('wide')).toBeLessThanOrEqual(FRAME_1024);
  });

  it('fits 640 to 1023 px in 608 px: class and end go to the expander', () => {
    expect(dutyColumnKeys('medium')).toEqual(['route', 'start', 'state', 'bus', 'now']);
    expect(dutyTableWidth('medium')).toBe(608);
    expect(dutyTableWidth('medium')).toBeLessThanOrEqual(FRAME_640);
  });

  it('fits a 390 px phone in 348 px: route, start and bus', () => {
    expect(dutyColumnKeys('phone')).toEqual(['route', 'start', 'bus']);
    expect(dutyTableWidth('phone')).toBe(348);
    expect(dutyTableWidth('phone')).toBeLessThanOrEqual(FRAME_390);
  });
});
