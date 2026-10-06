'use client';

import { useEffect, useState } from 'react';
import type { UnitsTier } from '@/lib/depot/network/unitsTable';

/** The rail shows only from 1280 now: the tiers follow the content width, not the rail. */
const QUERIES: readonly (readonly [UnitsTier, string])[] = [
  ['full', '(min-width: 1440px)'],
  ['mid', '(min-width: 1024px)'],
  ['narrow', '(min-width: 640px)'],
];

function currentTier(): UnitsTier {
  return QUERIES.find(([, query]) => window.matchMedia(query).matches)?.[0] ?? 'phone';
}

/** The units table's column tier. Starts 'full' so the server render and the first paint agree. */
export function useUnitsTier(): UnitsTier {
  const [tier, setTier] = useState<UnitsTier>('full');

  useEffect(() => {
    const update = (): void => setTier(currentTier());
    update();
    const lists = QUERIES.map(([, query]) => window.matchMedia(query));
    lists.forEach((list) => list.addEventListener('change', update));
    return () => lists.forEach((list) => list.removeEventListener('change', update));
  }, []);

  return tier;
}
