'use client';

import { useWidthTier, type WidthTiers } from '@/components/depot/shell/useWidthTier';
import { BREAKPOINT_PX, WIDE_VIEWPORT_PX } from '@/lib/depot/shell/geometry';
import type { UnitsTier } from '@/lib/depot/network/unitsTable';

/** The rail shows only from 1280: the tiers follow the content width, not the rail. */
const UNITS_TIERS: WidthTiers<UnitsTier> = [
  ['full', WIDE_VIEWPORT_PX],
  ['mid', BREAKPOINT_PX.lg],
  ['narrow', BREAKPOINT_PX.sm],
  ['phone', 0],
];

/** The units table's column tier. 'full' on the server. */
export function useUnitsTier(): UnitsTier {
  return useWidthTier(UNITS_TIERS);
}
