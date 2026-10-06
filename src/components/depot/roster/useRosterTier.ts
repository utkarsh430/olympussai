'use client';

import { useWidthTier } from '@/components/depot/shell/useWidthTier';
import { ROSTER_TIER_FROM_PX, type RosterTier } from '@/lib/depot/roster/rosterColumns';

/** The roster's width tier, from the viewport. The widest tier on the server. */
export function useRosterTier(): RosterTier {
  return useWidthTier(ROSTER_TIER_FROM_PX);
}
