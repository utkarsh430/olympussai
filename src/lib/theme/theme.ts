/**
 * The theme contract, in one place, with no React in it.
 *
 * Deliberately a plain module with no `'use client'` directive: the no-flash
 * script is injected by the ROOT LAYOUT, which is a Server Component, while
 * the provider and toggle that use the same constants are client components.
 * A shared value imported across that boundary from a `'use client'` module
 * is a client-reference proxy rather than the thing it is declared as — it
 * throws at request time and nothing but `pnpm check:client-boundary`
 * catches it. Keeping the constants here means both sides import a real
 * value.
 */

/**
 * What the operator CHOSE. Three states, not two.
 *
 * `system` is a real, distinct choice and not merely the absence of one: an
 * operator who wants the console to follow their machine into dark at dusk
 * has picked something, and a two-state toggle cannot express it. This is
 * why the toggle is a segmented control rather than a switch.
 */
export type ThemePreference = 'light' | 'dark' | 'system';

/** What is actually on screen once `system` has been resolved. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

/** localStorage key. Changing it silently resets every operator's choice. */
export const THEME_STORAGE_KEY = 'olympuss-theme';

/** The class the palette hangs off. Must match `darkMode` in tailwind.config.ts. */
export const DARK_CLASS = 'dark';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * The script that runs BEFORE first paint.
 *
 * ─── WHY THIS IS A STRING OF JAVASCRIPT ──────────────────────────────────
 *
 * A theme applied by React runs after hydration, which is after the browser
 * has already painted — so a dark-mode operator opening the console sees a
 * white flash on every single navigation. The only way to avoid it is to set
 * the class synchronously in <head>, before the body is painted, which means
 * inline script.
 *
 * It is emitted with `dangerouslySetInnerHTML`, so it must contain no
 * user-controlled data. It does not: every value in it is a literal from
 * this module.
 *
 * ─── WHY IT IS WRAPPED IN try/catch ──────────────────────────────────────
 *
 * `localStorage` throws — not returns null, THROWS — when cookies are
 * blocked or the page is in certain privacy modes. An uncaught throw here
 * runs before React and would leave the console rendering unthemed. Failing
 * to system preference is the correct degradation.
 *
 * It also stamps `data-theme-ready` on <html>. That is what the end-to-end
 * evidence keys off to prove the class was applied before paint rather than
 * after hydration.
 */
export function themeInitScript(): string {
  return `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var d=p==='dark'||((p===null||p==='system')&&m);var e=document.documentElement;e.classList.toggle(${JSON.stringify(DARK_CLASS)},d);e.style.colorScheme=d?'dark':'light';e.setAttribute('data-theme-ready',d?'dark':'light');}catch(_){}})();`;
}

/**
 * Apply a preference to the document. Shared by the provider's initial sync,
 * its change handler and its OS-preference listener, so all three can never
 * drift apart.
 */
export function applyTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  const resolved: ResolvedTheme =
    preference === 'dark' || (preference === 'system' && prefersDark) ? 'dark' : 'light';
  const root = document.documentElement;
  root.classList.toggle(DARK_CLASS, resolved === 'dark');
  root.style.colorScheme = resolved;
  root.setAttribute('data-theme-ready', resolved);
  return resolved;
}

/** Reads the stored preference, tolerating a blocked or corrupt store. */
export function readStoredPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Persists the preference. `system` is stored explicitly rather than by
 * removing the key, so "follow my machine" survives as a stated choice
 * instead of decaying into "never chose".
 */
export function storePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* Storage blocked. The theme still applies for this page's lifetime. */
  }
}
