'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  applyTheme,
  readStoredPreference,
  storePreference,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme/theme';

/**
 * Holds the operator's theme choice and keeps the document in step with it.
 *
 * ─── THIS DOES NOT MAKE THE TREE A CLIENT TREE ───────────────────────────
 *
 * The provider is a client component, but `children` passed THROUGH it stay
 * exactly what they were. A Server Component rendered inside it is still
 * rendered on the server. That matters here more than usual: the fleet table
 * is thousands of rows, and shipping it as client JS would be a real cost.
 *
 * ─── WHY IT DOES NOT RENDER THE THEME ITSELF ─────────────────────────────
 *
 * The class on <html> is put there by the inline script in the root layout,
 * before first paint. This provider's first effect READS the same sources
 * and re-applies them, which is a no-op on a correctly primed document — it
 * exists so the React state matches what the script already did, not so the
 * theme arrives. If this component were the thing that applied the theme,
 * every navigation would flash.
 *
 * Nothing here renders differently between server and client, so there is no
 * hydration mismatch to suppress.
 */
interface ThemeContextValue {
  /** What the operator chose: light, dark, or follow the machine. */
  preference: ThemePreference;
  /** What is actually on screen. `system` is already resolved here. */
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children?: ReactNode }) {
  // Both start at the server-rendered assumption and are corrected in the
  // effect below. They are never read for rendering anything that differs
  // between server and client, so this cannot mismatch.
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [resolved, setResolved] = useState<ResolvedTheme>('dark');

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const stored = readStoredPreference();
    setPreferenceState(stored);
    setResolved(applyTheme(stored, media.matches));

    // An operator on `system` whose machine flips to dark at dusk must follow
    // it without reloading. Re-reads the stored preference on each change
    // rather than closing over it, so the listener never goes stale.
    const onSystemChange = (event: MediaQueryListEvent) => {
      const current = readStoredPreference();
      if (current !== 'system') return;
      setResolved(applyTheme('system', event.matches));
    };

    media.addEventListener('change', onSystemChange);
    return () => media.removeEventListener('change', onSystemChange);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    storePreference(next);
    setResolved(applyTheme(next, window.matchMedia('(prefers-color-scheme: dark)').matches));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Read the current theme.
 *
 * Returns a working default rather than throwing when there is no provider.
 * A missing provider must not be able to blank an operations screen, and the
 * only consumer that genuinely needs the real value is the toggle — which is
 * always inside one.
 *
 * The map is the other consumer that matters: the Google Maps basemap is a
 * JavaScript style array, not CSS, so it cannot follow the theme through a
 * class. A map component must subscribe to `resolved` and call `setOptions`
 * when it changes, or it will show a black basemap under a light console.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context) return context;
  return {
    preference: 'system',
    resolved: 'dark',
    setPreference: () => {},
  };
}
