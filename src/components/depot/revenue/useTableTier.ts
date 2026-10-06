'use client';

import { useEffect, useState } from 'react';
import { TIER_FROM_PX, type TableTier } from '@/lib/depot/revenue/tableTier';

const WIDE_QUERY = `(min-width: ${TIER_FROM_PX.wide}px)`;
const MEDIUM_QUERY = `(min-width: ${TIER_FROM_PX.medium}px)`;

function currentTier(): TableTier {
  if (window.matchMedia(WIDE_QUERY).matches) return 'wide';
  if (window.matchMedia(MEDIUM_QUERY).matches) return 'medium';
  return 'narrow';
}

/** The table tier for the viewport. Starts 'wide' so the server render and the first paint agree. */
export function useTableTier(): TableTier {
  const [tier, setTier] = useState<TableTier>('wide');

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const queries = [window.matchMedia(WIDE_QUERY), window.matchMedia(MEDIUM_QUERY)];
    const update = (): void => setTier(currentTier());
    update();
    queries.forEach((q) => q.addEventListener?.('change', update));
    return () => queries.forEach((q) => q.removeEventListener?.('change', update));
  }, []);

  return tier;
}
