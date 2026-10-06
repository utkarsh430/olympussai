import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BusDrawer } from '@/components/depot/roster/BusDrawer';
import type { DepotBusView } from '@/lib/depot/api';
import { DEPOT_PORTAL_ROOT_ID } from '@/lib/depot/portalRoot';
import { buildRosterRows } from '@/lib/depot/roster/rosterModel';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;

const BUS = {
  registrationNumber: 'MH12AB1000',
  state: 'in_service',
  location: 'away',
  otherDepotId: null,
  distanceFromYardKm: 12,
  latitude: 19,
  longitude: 73,
  speedKmph: 30,
  gpsAgeMin: 1,
  vehicleStatus: 'live',
  tripStatus: null,
  routeName: 'Pune - Satara',
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
const [ROW] = buildRosterRows([BUS]);

/** An opener button that opens the drawer, as the roster page does. */
function Host({
  fallback,
  noOpener = false,
}: {
  readonly fallback?: HTMLElement | null;
  /** Mimics a deep link: the page has no button to hand focus back to. */
  readonly noOpener?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={opener} type="button" onClick={() => setOpen(true)}>
        open
      </button>
      {open ? (
        <BusDrawer
          registration="MH12AB1000"
          row={ROW ?? null}
          feedNow={null}
          onClose={() => setOpen(false)}
          restoreFocusTo={() => (noOpener ? null : opener.current) ?? fallback ?? null}
        />
      ) : null}
    </>
  );
}

let container: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function openDrawer(): Promise<HTMLButtonElement> {
  const opener = container.querySelector('button');
  if (!opener) throw new Error('no opener');
  opener.focus();
  await act(async () => {
    opener.click();
  });
  await settle();
  return opener;
}

function key(name: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: name,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
}

const panel = (): HTMLElement => document.querySelector('[role="dialog"]') as HTMLElement;
const buttons = (): HTMLElement[] => Array.from(panel().querySelectorAll('button'));

beforeEach(async () => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  // The timetable request fails, which leaves a Retry button: a second focusable item.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  document.body.style.overflow = 'auto';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Host />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActFlag;
  document.body.style.overflow = '';
});

describe('BusDrawer as a modal', () => {
  it('is a labelled modal dialog naming the bus', async () => {
    await openDrawer();
    expect(panel().getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(panel().getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent).toBe('Bus MH12AB1000');
  });

  it('moves focus into the panel on open', async () => {
    await openDrawer();
    expect(panel().contains(document.activeElement)).toBe(true);
  });

  it('wraps Tab from the last item to the first', async () => {
    await openDrawer();
    const items = buttons();
    expect(items.length).toBeGreaterThanOrEqual(2);
    items[items.length - 1]?.focus();
    const event = key('Tab');
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[0]);
  });

  it('wraps Shift+Tab from the first item to the last', async () => {
    await openDrawer();
    const items = buttons();
    items[0]?.focus();
    const event = key('Tab', true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('wraps Shift+Tab from the title to the last item', async () => {
    await openDrawer();
    const items = buttons();
    (document.getElementById('bus-drawer-title') as HTMLElement).focus();
    key('Tab', true);
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('brings focus back into the panel on Tab when it is on the body', async () => {
    await openDrawer();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    key('Tab');
    expect(document.activeElement).toBe(buttons()[0]);
  });

  it('brings focus back to the last item on Shift+Tab from the body', async () => {
    await openDrawer();
    (document.activeElement as HTMLElement).blur();
    key('Tab', true);
    const items = buttons();
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('closes on Escape and returns focus to the opener', async () => {
    const opener = await openDrawer();
    key('Escape');
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes from the Close button', async () => {
    await openDrawer();
    const close = buttons().find((b) => b.textContent === 'Close');
    await act(async () => close?.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('locks page scroll while open and restores the previous value', async () => {
    await openDrawer();
    expect(document.body.style.overflow).toBe('hidden');
    key('Escape');
    await settle();
    expect(document.body.style.overflow).toBe('auto');
  });
});

describe('BusDrawer opened without an opener', () => {
  it('returns focus to the fallback element instead of the body', async () => {
    const fallback = document.createElement('div');
    fallback.tabIndex = -1;
    document.body.appendChild(fallback);
    await act(async () => {
      root.render(<Host fallback={fallback} noOpener />);
    });
    await openDrawer();
    key('Escape');
    await settle();
    expect(document.activeElement).toBe(fallback);
    fallback.remove();
  });
});

describe('BusDrawer typeface and words', () => {
  it('is portalled inside the shell, so its sentences take the module sans face, not the browser serif', async () => {
    const shellRoot = document.createElement('div');
    shellRoot.id = DEPOT_PORTAL_ROOT_ID;
    document.body.appendChild(shellRoot);
    const [noRoute] = buildRosterRows([{ ...BUS, routeName: null } as DepotBusView]);
    await act(async () => {
      root.render(
        <BusDrawer
          registration="MH12AB1000"
          row={noRoute ?? null}
          feedNow={null}
          onClose={() => {}}
          restoreFocusTo={() => null}
        />,
      );
    });
    expect(shellRoot.contains(panel())).toBe(true);
    // The "no route" sentence is a sans-class paragraph, not an unclassed one.
    const sentence = Array.from(panel().querySelectorAll('p')).find((p) =>
      (p.textContent ?? '').includes('no timetable'),
    );
    expect(sentence?.className).toContain('depot-prose');
    shellRoot.remove();
  });

  it('names the state by its word alone and carries the quiet in Last heard', async () => {
    const [quiet] = buildRosterRows([
      { ...BUS, state: 'on_road', gpsAgeMin: 192, notHeardMin: 192 } as DepotBusView,
    ]);
    await act(async () => {
      root.render(
        <BusDrawer
          registration="MH12AB1000"
          row={quiet ?? null}
          feedNow={null}
          onClose={() => {}}
          restoreFocusTo={() => null}
        />,
      );
    });
    const facts = Array.from(panel().querySelectorAll('dl > div')).map((div) => div.textContent);
    expect(facts.find((f) => f?.startsWith('State'))).toBe('StateOn road, no schedule in feed');
    expect(facts.find((f) => f?.startsWith('Last heard'))).toBe('Last heardnot heard 3 h 12 min');
  });
});
