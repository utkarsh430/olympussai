// @vitest-environment jsdom
//
// The theme layer: the no-flash script, the preference store, and the
// three-state toggle.
//
// What is actually being protected here:
//
//   1. NO FLASH. The class is applied by a synchronous inline script before
//      first paint, not by React after hydration. If that regresses, a
//      dark-mode operator sees a white flash on every navigation — which is
//      not a test failure anywhere else, only a complaint.
//   2. THREE STATES. `system` is a real choice, not the absence of one. A
//      two-state toggle cannot express "follow my machine", and silently
//      converting `system` into a fixed value overwrites what the operator
//      asked for.
//   3. STORAGE CANNOT TAKE THE CONSOLE DOWN. `localStorage` THROWS — not
//      returns null — when cookies are blocked. An uncaught throw here runs
//      before React and leaves the page unthemed.
//
// NOTE ON `eval` BELOW: the thing under test IS a string of JavaScript — the
// script the root layout injects into <head> to beat the first paint. The
// only way to test what it actually does is to execute it. The input is this
// repo's own `themeInitScript()` and nothing else, so there is no untrusted
// code path here; the alternative (asserting on the string's text) would test
// the spelling rather than the behaviour.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  applyTheme,
  isThemePreference,
  readStoredPreference,
  storePreference,
  themeInitScript,
  THEME_STORAGE_KEY,
} from '@/lib/theme/theme';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

/** Installs a controllable `matchMedia`, which jsdom does not provide. */
function mockPrefersDark(prefersDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    matches: prefersDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
    dispatch: (matches: boolean) => {
      mql.matches = matches;
      for (const listener of listeners) listener({ matches } as MediaQueryListEvent);
    },
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  );
  return mql;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme-ready');
  document.documentElement.style.colorScheme = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the pre-paint theme script', () => {
  it('applies dark before paint when the operator chose dark', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    mockPrefersDark(false);

    eval(themeInitScript());

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme-ready')).toBe('dark');
  });

  it('applies light before paint when the operator chose light, even on a dark machine', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    mockPrefersDark(true);

    eval(themeInitScript());

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.getAttribute('data-theme-ready')).toBe('light');
  });

  it('follows the machine when the operator has chosen nothing', () => {
    mockPrefersDark(true);

    eval(themeInitScript());

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('sets color-scheme so form controls and scrollbars match the theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    mockPrefersDark(false);

    eval(themeInitScript());

    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('survives localStorage throwing rather than leaving the page unthemed', () => {
    mockPrefersDark(false);
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    // The whole point: this must not throw. An uncaught throw here runs
    // before React and takes the console's styling with it.
    expect(() => eval(themeInitScript())).not.toThrow();

    getItem.mockRestore();
  });

  it('contains no interpolated data, so there is nothing to escape', () => {
    // The script is emitted with dangerouslySetInnerHTML. It is only safe
    // because every value in it is a literal from the theme module.
    const script = themeInitScript();
    expect(script).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(script).not.toMatch(/<\/script/i);
  });
});

describe('the stored preference', () => {
  it('round-trips each of the three states', () => {
    for (const preference of ['light', 'dark', 'system'] as const) {
      storePreference(preference);
      expect(readStoredPreference()).toBe(preference);
    }
  });

  it('stores `system` explicitly rather than by deleting the key', () => {
    // "Follow my machine" is a stated choice. Representing it as an absent
    // key makes it indistinguishable from "never chose", which matters the
    // moment a default changes.
    storePreference('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('falls back to `system` on a corrupt value instead of throwing', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'chartreuse');
    expect(readStoredPreference()).toBe('system');
  });

  it('recognises exactly the three valid preferences', () => {
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('auto')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

describe('applyTheme', () => {
  it('resolves `system` against the machine preference', () => {
    expect(applyTheme('system', true)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    expect(applyTheme('system', false)).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('ignores the machine preference when the operator has chosen explicitly', () => {
    expect(applyTheme('light', true)).toBe('light');
    expect(applyTheme('dark', false)).toBe('dark');
  });
});

describe('the theme toggle', () => {
  it('offers all three choices as a radio group', () => {
    mockPrefersDark(false);
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    const group = screen.getByRole('radiogroup', { name: 'Colour theme' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
  });

  it('marks the operator’s current choice as selected', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    mockPrefersDark(true);
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme-toggle-light')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('theme-toggle-dark')).toHaveAttribute('aria-checked', 'false');
  });

  it('applies and persists a choice', async () => {
    mockPrefersDark(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    await user.click(screen.getByTestId('theme-toggle-dark'));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('follows the machine when set to auto, without a reload', () => {
    const media = mockPrefersDark(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // An operator on `system` whose machine flips to dark at dusk must
    // follow it. This is why the provider listens rather than reading once.
    act(() => media.dispatch(true));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('stops following the machine once an explicit choice is made', async () => {
    const media = mockPrefersDark(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    await user.click(screen.getByTestId('theme-toggle-light'));
    act(() => media.dispatch(true));

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('labels every option in text, not by icon alone', () => {
    mockPrefersDark(false);
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    for (const label of ['Light', 'Dark', 'Auto']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
