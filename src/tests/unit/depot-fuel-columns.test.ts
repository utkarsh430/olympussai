import { describe, expect, it } from 'vitest';
import type { FuelFlaggedBus } from '@/lib/depot/fuel/api';
import {
  ROUTE_WIDTHS,
  STAND_OUT_WIDTHS,
  routeColumnKeys,
  routeRateHeaders,
  standOutColumnKeys,
  standOutRowTitle,
  standOutSecondLine,
} from '@/lib/depot/fuel/fuelColumns';
import { TIER_FRAME_PX, columnSum, tableTierFor, type TableTier } from '@/lib/depot/revenue/tableTier';

const TIERS: readonly TableTier[] = ['wide', 'medium', 'narrow'];
const bus = {
  registrationNumber: 'UP32-1',
  routeName: 'R1',
  serviceClass: 'ordinary',
  comparison: 'depot',
} as unknown as FuelFlaggedBus;

describe('tiers', () => {
  it('follow the viewport: 1440 and 1280 wide, 1024 medium, 800 and 390 narrow', () => {
    expect([1440, 1280, 1024, 1279, 800, 390].map(tableTierFor)).toEqual([
      'wide',
      'wide',
      'medium',
      'medium',
      'narrow',
      'narrow',
    ]);
  });
});

describe('buses that stand out', () => {
  it.each(TIERS)('fits the %s frame with and without the route column', (tier) => {
    for (const withRoute of [true, false]) {
      expect(columnSum(STAND_OUT_WIDTHS, standOutColumnKeys(tier, withRoute))).toBeLessThanOrEqual(
        TIER_FRAME_PX[tier],
      );
    }
  });

  it('never drops VARIANCE, the reason the table exists', () => {
    for (const tier of TIERS) expect(standOutColumnKeys(tier, true)).toContain('variance');
  });

  it('folds CLASS and BASIS into a second line at 1024 and keeps four columns at 800', () => {
    expect(standOutColumnKeys('medium', true)).toEqual(['registration', 'route', 'bus', 'median', 'variance']);
    expect(standOutColumnKeys('narrow', true)).toEqual(['registration', 'bus', 'median', 'variance']);
    expect(standOutSecondLine(bus)).toBe('Ordinary · class in depot');
    expect(standOutRowTitle(bus, 'narrow')).toBe('UP32-1 · Ordinary · class in depot · route R1');
    expect(standOutRowTitle(bus, 'wide')).toBe('UP32-1');
  });
});

describe('by route', () => {
  it.each(TIERS)('fits the %s frame', (tier) => {
    expect(columnSum(ROUTE_WIDTHS, routeColumnKeys(tier))).toBeLessThanOrEqual(TIER_FRAME_PX[tier]);
  });

  it('at 800 drops FUEL COST ₹ and shortens the rate headers', () => {
    expect(routeColumnKeys('narrow')).not.toContain('cost');
    expect(routeRateHeaders('narrow')).toEqual({ kmpl: { header: 'Km/L' }, cpk: { header: '₹/km' } });
  });
});
