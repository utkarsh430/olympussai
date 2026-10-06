import { StrictMode, act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RosterPage } from '@/components/depot/roster/RosterPage';
import type { DepotBusView } from '@/lib/depot/api';

// A tiny in-memory router so `?bus=` changes re-render the page like the real one.
let search = '';
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: (url: string): void => {
      search = url.includes('?') ? (url.split('?')[1] ?? '') : '';
      listeners.forEach((listener) => listener());
    },
  }),
  usePathname: () => '/roster',
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => search)),
}));

function bus(registrationNumber: string): DepotBusView {
  return {
    registrationNumber,
    state: 'in_service',
    location: 'yard',
    otherDepotId: null,
    distanceFromYardKm: null,
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

beforeEach(async () => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  search = '';
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
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
});

afterEach(async () => {
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
