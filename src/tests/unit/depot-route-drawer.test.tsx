// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lookups: (string | null)[] = [];
vi.mock('@/hooks/useRouteProfile', () => ({
  useRouteProfile: (name: string | null) => {
    lookups.push(name);
    return { data: null, error: 'Too many route lookups just now. Try again in 9 seconds.', loading: false };
  },
}));

import { RouteDrawer } from '@/components/depot/routes/RouteDrawer';

const ROUTE = { routeName: 'RKD_1_ORD_OUT', buses: 2, operators: [], deadKm: null };
let host: HTMLDivElement;
let root: Root;
let opener: HTMLButtonElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  lookups.length = 0;
  opener = document.createElement('button');
  document.body.append(opener);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  opener.remove();
});

const render = (onClose: () => void): void =>
  act(() =>
    root.render(
      <RouteDrawer
        route={ROUTE}
        move={null}
        onClose={onClose}
        onProfiled={() => undefined}
        restoreFocusTo={() => opener}
      />,
    ),
  );

describe('RouteDrawer', () => {
  it('moves focus in, locks the page, fetches one route and states a 429 plainly', () => {
    render(() => undefined);
    expect(document.activeElement?.id).toBe('route-drawer-title');
    expect(document.body.style.overflow).toBe('hidden');
    expect(new Set(lookups)).toEqual(new Set(['RKD_1_ORD_OUT']));
    expect(document.body.textContent).toContain('Try again in 9 seconds.');
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
  });

  it('closes on Escape, holds Tab inside, and hands focus back to the opener', () => {
    const onClose = vi.fn();
    render(onClose);
    const close = document.querySelector<HTMLButtonElement>('[role="dialog"] button')!;
    close.focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(close);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root.render(<></>));
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
  });
});
