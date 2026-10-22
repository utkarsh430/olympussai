'use client';

import { useEffect } from 'react';
import { useAiStore } from './ai/aiStore';
import { useOsStore } from './osStore';

/**
 * Reads the browser-kept OS state (region, sidebar, copilot, review trail, the AI
 * cycle's interval) once, after hydration.
 */
export function OsHydrator() {
  const hydrate = useOsStore((s) => s.hydrate);
  const hydrateAi = useAiStore((s) => s.hydrate);
  useEffect(() => {
    hydrate();
    hydrateAi();
  }, [hydrate, hydrateAi]);
  return null;
}
