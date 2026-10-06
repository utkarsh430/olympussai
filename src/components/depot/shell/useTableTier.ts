'use client';

import { TABLE_TIER_FROM_PX, type TableTier } from '@/lib/depot/shell/tableTier';
import { useWidthTier } from './useWidthTier';

/** The table tier for the viewport (fuel, revenue, economics, trends). 'wide' on the server. */
export function useTableTier(): TableTier {
  return useWidthTier(TABLE_TIER_FROM_PX);
}
