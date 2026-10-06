import { describe, expect, it } from 'vitest';
import {
  YARD_FRAME_PX,
  YARD_MIN_SPARE_PX,
  awayColumnKeys,
  rollColumnKeys,
  sharedReason,
  showAtYardFor,
  unknownColumnKeys,
  yardTableWidth,
  type YardColumnKey,
  type YardTier,
} from '@/lib/depot/yard/yardTableLayout';

describe('yard lists per width (critique §7, §8)', () => {
  it('drops REASON on a phone and keeps REGISTRATION · STATE · FROM YARD for away', () => {
    expect(rollColumnKeys('phone', true)).toEqual(['registration', 'notHeard']);
    expect(rollColumnKeys('wide', true)).toEqual(['registration', 'notHeard', 'reason']);
    expect(awayColumnKeys('phone', true)).toEqual(['registration', 'state', 'km']);
    expect(awayColumnKeys('wide', false)).toEqual(['registration', 'state', 'km', 'notHeard']);
  });

  it.each<[YardTier, readonly YardColumnKey[], number]>([
    ['phone', awayColumnKeys('phone', true), 330],
    ['phone', rollColumnKeys('phone', true), 234],
    ['phone', unknownColumnKeys(), 338],
    ['wide', awayColumnKeys('wide', true), 730],
    ['wide', rollColumnKeys('wide', true), 530],
    ['wide', unknownColumnKeys(), 418],
  ])('fits the %s frame: %j at %i px', (tier, keys, sum) => {
    expect(yardTableWidth(tier, keys)).toBe(sum);
    expect(sum).toBeLessThanOrEqual(YARD_FRAME_PX[tier] - YARD_MIN_SPARE_PX);
  });

  it('decides "In the yard of" from the rows shown, not the whole list', () => {
    expect(showAtYardFor([{ atYard: '' }, { atYard: '' }])).toBe(false);
    expect(showAtYardFor([{ atYard: '' }, { atYard: 'Kaiserbagh' }])).toBe(true);
  });

  it('makes a reason the group note only when every listed row gives it', () => {
    expect(sharedReason([{ reason: 'not heard recently' }, { reason: 'not heard recently' }])).toBe(
      'not heard recently',
    );
    expect(sharedReason([{ reason: 'not heard recently' }, { reason: 'stopped' }])).toBeNull();
    expect(sharedReason([{ reason: '' }])).toBeNull();
    expect(sharedReason([])).toBeNull();
  });
});
