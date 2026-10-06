import { StrictMode, act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RosterPage } from '@/components/depot/roster/RosterPage';
import type { DepotBusView } from '@/lib/depot/api';

// The router's search parameters, as Next.js keeps them: in step with the history API, so
// a `replaceState` re-renders the page with the new query and no navigation is made.
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/roster',
  useSearchParams: () =>
    new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
}));
const realReplaceState = window.history.replaceState.bind(window.history);
const search = (): string => window.location.search.replace(/^\?/, '');

function bus(registrationNumber: string): DepotBusView {
  return {
    registrationNumber,
    state: 'in_service',
    location: 'away',
    otherDepotId: null,
    distanceFromYardKm: 12,
    latitude: null,
    longitude: null,
    speedKmph: null,
    gpsAgeMin: null,
    vehicleStatus: 'live',
    tripStatus: null,
    routeName: null,
    routeDescription: null,
    journeyId: null,
    journeyCode: null,
    scheduledStart: null,
    scheduledEnd: null,
    tripDate: null,
    delayMinutes: null,
    mainPowerOn: true,
    tamperCode: null,
  } as DepotBusView;
}

vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: () => ({
    data: {
      buses: [bus('MH12AB1000'), bus('MH12AB2000')],
      feedNow: '2026-10-06T09:30:00.000Z',
      stale: false,
    },
    error: null,
    loading: false,
    refresh: () => {},
  }),
}));

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;
let container: HTMLDivElement;
let root: Root;

const openerFor = (registration: string): HTMLButtonElement => {
  const found = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(registration),
  );
  if (!found) throw new Error(`no opener for ${registration}`);
  return found;
};

const click = async (element: Element): Promise<void> => {
  await act(async () => {
    (element as HTMLElement).click();
  });
};

const mount = async (): Promise<void> => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <StrictMode>
        <RosterPage />
      </StrictMode>,
    );
  });
};

beforeEach(async () => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  router.replace.mockClear();
  router.push.mockClear();
  realReplaceState(null, '', '/roster');
  window.history.replaceState = (...args: Parameters<History['replaceState']>): void => {
    realReplaceState(...args);
    listeners.forEach((listener) => listener());
  };
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  await mount();
});

afterEach(async () => {
  window.history.replaceState = realReplaceState;
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActFlag;
  document.body.style.overflow = '';
});

describe('RosterPage drawer focus under StrictMode', () => {
  it('returns focus to the button that opened the drawer', async () => {
    const opener = openerFor('MH12AB1000');
    opener.focus();
    await click(opener);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    await click(document.querySelector('[role="dialog"] button') as HTMLElement);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('returns focus to the newer opener after another bus is opened', async () => {
    await click(openerFor('MH12AB1000'));
    await click(document.querySelector('[role="dialog"] button') as HTMLElement);
    const second = openerFor('MH12AB2000');
    second.focus();
    await click(second);
    await click(document.querySelector('[role="dialog"] button') as HTMLElement);
    expect(document.activeElement).toBe(second);
  });
});

describe('RosterPage ?bus= in the URL', () => {
  it('opens and closes a bus by replacing the history entry, never by a navigation', async () => {
    const entries = window.history.length;
    await click(openerFor('MH12AB1000'));
    expect(search()).toBe('bus=MH12AB1000');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await click(document.querySelector('[role="dialog"] button') as HTMLElement);
    expect(search()).toBe('');
    expect(window.history.length).toBe(entries);
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('opens no drawer for a value that is not a registration, and removes it from the URL', async () => {
    await act(async () => root.unmount());
    container.remove();
    const spoof = 'UP32 — your session needs re-verification, call 05xx-xxxxxxx';
    realReplaceState(null, '', `/roster?state=in_service&bus=${encodeURIComponent(spoof)}`);
    await mount();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain('re-verification');
    expect(search()).toBe('state=in_service');
  });

  it('marks no registration as pressed: the button opens a dialog, it is not a toggle', () => {
    expect(openerFor('MH12AB1000').hasAttribute('aria-pressed')).toBe(false);
  });
});

describe('RosterPage filters in the URL', () => {
  const toggle = (word: string): HTMLButtonElement => {
    const found = Array.from(container.querySelectorAll('[role="group"] button')).find((b) =>
      (b.textContent ?? '').startsWith(word),
    );
    if (!found) throw new Error(`no toggle ${word}`);
    return found as HTMLButtonElement;
  };

  it('writes a state toggle into the query and keeps it when a bus opens and closes', async () => {
    await click(toggle('In service'));
    expect(search()).toBe('state=in_service');
    expect(toggle('In service').getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('Roster · 2');
    expect(container.textContent).not.toContain('Showing');
    await click(openerFor('MH12AB1000'));
    expect(new URLSearchParams(search()).get('state')).toBe('in_service');
    await click(document.querySelector('[role="dialog"] button') as HTMLElement);
    expect(search()).toBe('state=in_service');
  });

  it('says when nothing matches and offers to clear the filters', async () => {
    await click(toggle('Dark'));
    expect(container.textContent).toContain('No bus matches these filters');
    const clear = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Clear the filters');
    await click(clear as HTMLElement);
    expect(search()).toBe('');
    expect(container.textContent).toContain('Roster · 2');
    expect(container.textContent).not.toContain('Showing');
  });
});
