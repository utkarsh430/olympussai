'use client';

import { useEffect, useState } from 'react';
import { ROSTER_TIER_FROM_PX, rosterTier, type RosterTier } from '@/lib/depot/roster/rosterColumns';

/**
 * The roster's width tier, from the viewport. Starts at the widest tier so the server
 * render and the first paint agree, then follows every breakpoint the tiers name.
 */
export function useRosterTier(): RosterTier {
  const [tier, setTier] = useState<RosterTier>('wide');

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const queries = ROSTER_TIER_FROM_PX.filter(([, from]) => from > 0).map(([, from]) =>
      window.matchMedia(`(min-width: ${from}px)`),
    );
    const update = (): void => setTier(rosterTier(window.innerWidth));
    update();
    queries.forEach((query) => query.addEventListener('change', update));
    return () => queries.forEach((query) => query.removeEventListener('change', update));
  }, []);

  return tier;
}
