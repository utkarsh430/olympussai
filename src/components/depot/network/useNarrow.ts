'use client';

import { useEffect, useState } from 'react';

/** Below this width the rail becomes a strip and the depot table keeps its core columns. */
const NARROW_QUERY = '(max-width: 899px)';

/** True below 900px. Starts false so the server render and the first paint agree. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    setNarrow(query.matches);
    const handler = (event: MediaQueryListEvent): void => setNarrow(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  return narrow;
}
