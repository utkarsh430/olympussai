'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * A page's width tiers, widest first, each with the viewport width it starts at; the last
 * starts at 0. Define it at module level: the hook subscribes once per list.
 */
export type WidthTiers<T extends string> = readonly (readonly [T, number])[];

const minWidthQuery = (fromPx: number): string => `(min-width: ${fromPx}px)`;

const canMatch = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** The widest tier: what the server renders and what the first paint agrees with. */
function widestTier<T extends string>(tiers: WidthTiers<T>): T {
  const first = tiers[0];
  if (first === undefined) throw new Error('a width tier list needs at least one tier');
  return first[0];
}

/** The tier whose start the viewport has reached, from the browser's media queries. */
export function currentWidthTier<T extends string>(tiers: WidthTiers<T>): T {
  if (!canMatch()) return widestTier(tiers);
  const found = tiers.find(
    ([, fromPx]) => fromPx <= 0 || window.matchMedia(minWidthQuery(fromPx)).matches,
  );
  return found?.[0] ?? tiers[tiers.length - 1]?.[0] ?? widestTier(tiers);
}

/**
 * The viewport's width tier, from `matchMedia`. The server render and the hydrating render
 * read the widest tier, so they agree; the browser's tier follows at once and on every
 * crossing of a tier's start. Without `matchMedia` (a test environment) it stays widest.
 */
export function useWidthTier<T extends string>(tiers: WidthTiers<T>): T {
  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      if (!canMatch()) return () => undefined;
      const lists = tiers
        .filter(([, fromPx]) => fromPx > 0)
        .map(([, fromPx]) => window.matchMedia(minWidthQuery(fromPx)));
      lists.forEach((list) => list.addEventListener?.('change', onChange));
      return () => lists.forEach((list) => list.removeEventListener?.('change', onChange));
    },
    [tiers],
  );
  return useSyncExternalStore(
    subscribe,
    () => currentWidthTier(tiers),
    () => widestTier(tiers),
  );
}
