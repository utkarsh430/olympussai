'use client';

import { useEffect } from 'react';
import { useOsStore } from './osStore';

/** Reads the browser-kept OS state (region, copilot, review trail) once, after hydration. */
export function OsHydrator() {
  const hydrate = useOsStore((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  return null;
}
