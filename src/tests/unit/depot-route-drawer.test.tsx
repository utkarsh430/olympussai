// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lookups: (string | null)[] = [];
const LIMITED = {
  data: null, error: 'Too many route lookups just now. Try again in 9 seconds.', loading: false,
  retryAfterSeconds: 9, slow: false,
};
const hook = vi.hoisted(() => ({ state: null as unknown, retries: 0 }));
vi.mock('@/hooks/useRouteProfile', () => ({
  useRouteProfile: (name: string | null) => {
    lookups.push(name);
    return { ...(hook.state as object), retry: () => { hook.retries += 1; } };
  },
}));

import { RouteDrawer } from '@/components/depot/routes/RouteDrawer';
import { buildRouteProfile } from '@/lib/depot/routes/routeProfile';
import { VND_1613_SCHEDULE } from './depot-route-vnd-1613.fixtures';

const ROUTE = { routeName: 'RKD_1_ORD_OUT', buses: 2, operators: [], deadKm: null };
let host: HTMLDivElement;
let root: Root;
let opener: HTMLButtonElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  lookups.length = 0;
  hook.state = LIMITED;
  hook.retries = 0;
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

  it('says when the lookup is slow, in place of the loading words', () => {
    hook.state = { data: null, error: null, loading: true, retryAfterSeconds: null, slow: false };
    render(() => undefined);
    expect(document.body.textContent).toContain("Loading this route's stops from the route-details service.");
    hook.state = { ...(hook.state as object), slow: true };
    render(() => undefined);
    expect(document.querySelector('[data-testid="route-drawer-slow"]')?.textContent).toBe(
      'Still waiting for the route-details service; one lookup can take a while.',
    );
  });

  it('gives a rate-limit wait and a failure each its own state with a Try again', () => {
    render(() => undefined);
    expect(document.querySelector('[data-testid="route-drawer-limited"]')?.textContent).toContain(
      'Try again in 9 seconds.',
    );
    hook.state = { data: null, error: 'Route details are unavailable right now.', loading: false, retryAfterSeconds: null, slow: false };
    render(() => undefined);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Route details are unavailable right now.');
    const again = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
    act(() => again?.click());
    expect(hook.retries).toBe(1);
  });

  it('says plainly when the feed has no stops for the route', () => {
    const profile = { stops: [], scheduledDurationMin: null, unlocatedStops: 0 };
    hook.state = { data: { status: 'ok', profile, fetchedAt: 'x' }, error: null, loading: false, retryAfterSeconds: null, slow: false };
    render(() => undefined);
    expect(document.querySelector('[data-testid="route-drawer-empty"]')?.textContent).toContain(
      'No stops in the feed for this route.',
    );
  });

  it('lists every stop of the recorded route and says which positions are left out', () => {
    const profile = buildRouteProfile(VND_1613_SCHEDULE, 'UP64AT0001', '2026-10-06');
    hook.state = { data: { status: 'ok', profile, fetchedAt: 'x' }, error: null, loading: false, retryAfterSeconds: null, slow: false };
    render(() => undefined);
    const text = document.body.textContent ?? '';
    expect(text).toContain('From VINDHYANAGAR to VARANASI CANT');
    expect(text).toContain('8 of 37 stops have no usable position, so they are left out of distances.');
    expect(text).toContain(
      '4 stops have a position that does not fit the timetable and are left out of distances.',
    );
    expect(text).toContain('NIGAHEE');
    expect(text).toContain('RAMNAGAR VARANASI');
    expect(text).toContain('20:09');
  });
});

describe('the route drawer link to the day hour by hour', () => {
  it('links the route it was opened for, in the prose, whatever the lookup says', () => {
    render(() => undefined);
    const link = document.querySelector<HTMLAnchorElement>('[data-testid="route-drawer-hourly"] a');
    expect(link?.getAttribute('href')).toBe('/project/depots/routes/r/RKD_1_ORD_OUT');
    expect(link?.textContent).toBe('Hour by hour');
    expect(link?.className).toBe('depot-link');
  });
});
