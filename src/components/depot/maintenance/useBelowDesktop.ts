'use client';

import { useEffect, useState } from 'react';

/** Below the width where the table has room for every column (1024px). */
const BELOW_DESKTOP_QUERY = '(max-width: 1023px)';

/** True below 1024px. Starts false so the server render and the first paint agree. */
export function useBelowDesktop(): boolean {
  const [below, setBelow] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(BELOW_DESKTOP_QUERY);
    setBelow(query.matches);
    const handler = (event: MediaQueryListEvent): void => setBelow(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  return below;
}
