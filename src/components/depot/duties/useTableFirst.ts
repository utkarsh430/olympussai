'use client';

import { useEffect, useState } from 'react';
import { TABLE_FIRST_QUERY } from '@/lib/depot/duties/dutyBoardModel';

/** True below 640 px, where the board opens as the table. Starts false so the server render and the first paint agree. */
export function useTableFirst(): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(TABLE_FIRST_QUERY);
    setNarrow(query.matches);
    const handler = (event: MediaQueryListEvent): void => setNarrow(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  return narrow;
}
