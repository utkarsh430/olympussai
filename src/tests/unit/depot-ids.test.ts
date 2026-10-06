import { describe, expect, it } from 'vitest';
import { isValidDepotId, isValidRouteName } from '@/lib/depot/ids';
import { UNASSIGNED_DEPOT_ID } from '@/lib/depot/types';

describe('isValidDepotId', () => {
  it('accepts the digit ids the feed uses', () => {
    expect(isValidDepotId('2')).toBe(true);
    expect(isValidDepotId('81')).toBe(true);
    expect(isValidDepotId('157')).toBe(true);
    expect(isValidDepotId('123456')).toBe(true);
  });

  it('accepts the unassigned bucket', () => {
    expect(isValidDepotId(UNASSIGNED_DEPOT_ID)).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of [
      '',
      ' 81',
      '81 ',
      '1234567',
      '-1',
      '8.1',
      '81a',
      'DEPOT-81',
      '../81',
      '81/roster',
      '%38%31',
      '８１',
      'Unassigned',
    ]) {
      expect(isValidDepotId(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('rejects non-strings', () => {
    expect(isValidDepotId(81)).toBe(false);
    expect(isValidDepotId(null)).toBe(false);
    expect(isValidDepotId(undefined)).toBe(false);
    expect(isValidDepotId(['81'])).toBe(false);
  });
});

describe('isValidRouteName', () => {
  it('accepts feed route names', () => {
    expect(isValidRouteName('BLY_9509_ORD')).toBe(true);
    expect(isValidRouteName('RKD_4560_ORD_OUT')).toBe(true);
    expect(isValidRouteName('KSG-166')).toBe(true);
  });

  it('rejects empty, oversized and path-like values', () => {
    for (const value of ['', 'A'.repeat(65), 'BLY 9509', '../x', 'a/b', 'a%2Fb', 'a.b', 'a?b']) {
      expect(isValidRouteName(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('rejects non-strings', () => {
    expect(isValidRouteName(9509)).toBe(false);
    expect(isValidRouteName(null)).toBe(false);
  });
});
