'use client';

import { useEffect, useState } from 'react';

/** Below the width where the table has room for every column (1024px). */
const BELOW_DESKTOP_QUERY = '(max-width: 1023px)';

/** Below the width where a table keeps only its phone column set (640px). */
const PHONE_QUERY = '(max-width: 639px)';

/** True below 1024px. Starts false so the server render and the first paint agree. */
export function useBelowDesktop(): boolean {
  return useMatches(BELOW_DESKTOP_QUERY);
}

/** True below 640px. Starts false so the server render and the first paint agree. */
export function usePhone(): boolean {
  return useMatches(PHONE_QUERY);
}

function useMatches(media: string): boolean {
  const [below, setBelow] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(media);
    setBelow(query.matches);
    const handler = (event: MediaQueryListEvent): void => setBelow(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, [media]);

  return below;
}
