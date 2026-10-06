// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileLoader } from '@/components/depot/routes/ProfileLoader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DEPOTS = [{ value: '49', label: 'Bhaisali', routes: null, busesOnRoutes: 12 }];
const LIST = {
  routes: [
    { routeName: 'R1', profiled: false },
    { routeName: 'R2', profiled: false },
    { routeName: 'R3', profiled: false },
    { routeName: 'R0', profiled: true },
  ],
};

let container: HTMLDivElement;
let root: Root | null = null;
const originalFetch = globalThis.fetch;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

const OK = { status: 'ok', fetchedAt: 'x', profile: { stops: [{ name: 'A' }] } };
const EMPTY = { status: 'unavailable', reason: 'no_bus_on_route', fetchedAt: 'x' };

function stubFetch(limitedOnce: boolean): string[] {
  const profileCalls: string[] = [];
  let limited = limitedOnce;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/depot/routes')) return json(LIST);
    const name = decodeURIComponent(url.split('/').pop() ?? '');
    profileCalls.push(name);
    if (name === 'R2' && limited) {
      limited = false;
      return json({ error: 'busy' }, 429, { 'Retry-After': '2' });
    }
    return json(name === 'R3' ? EMPTY : OK);
  }) as typeof fetch;
  return profileCalls;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

async function render(wait: (ms: number, signal: AbortSignal) => Promise<void>, onFinished = () => {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(
      <ProfileLoader depots={DEPOTS} defaultDepotId="" onFinished={onFinished} wait={wait} />,
    ));
  const select = container.querySelector('select') as HTMLSelectElement;
  await act(async () => {
    select.value = '49';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

function button(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith(text));
}

const status = (): string =>
  container.querySelector('[data-testid="route-profile-loader-status"]')?.textContent ?? '';

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
});

describe('route profile loader', () => {
  it('starts on the default depot with its sentence, and still looks nothing up until pressed', async () => {
    const calls = stubFetch(false);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const lead = "No route can be planned yet: no route's details have been loaded.";
    await act(async () =>
      root?.render(<ProfileLoader depots={DEPOTS} defaultDepotId="49" lead={lead} onFinished={() => {}} />),
    );
    await flush();
    expect(calls).toEqual([]);
    expect(status()).toBe(lead);
    expect((container.querySelector('select') as HTMLSelectElement).value).toBe('49');
    expect(button('Load route details')?.textContent).toBe('Load route details: 3 lookups');
  });

  it('does nothing until pressed, then loads one at a time and finishes', async () => {
    const calls = stubFetch(false);
    const onFinished = vi.fn();
    await render(async () => {}, onFinished);
    expect(calls).toEqual([]);
    expect(button('Load route details')?.textContent).toBe('Load route details: 3 lookups');
    expect(button('Load route details')?.title).toBe(
      'Looks up 3 routes of Bhaisali on the route-details service: one lookup per route, one at a time, at most 40 a press.',
    );
    // The cost line is said once, in the closing disclosure; the button counts the lookups.
    expect(container.textContent).not.toContain(
      'One lookup on the route-details service per route, one at a time',
    );
    await act(async () => button('Load route details')?.click());
    await flush();
    expect(calls).toEqual(['R1', 'R2', 'R3']);
    expect(status()).toBe(
      'Done: 3 of 3 loaded, 1 had no stops in the feed. The plan will include the new profiles within half a minute.',
    );
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('pauses on a 429 and says when it resumes', async () => {
    stubFetch(true);
    let release: () => void = () => {};
    const wait = () => new Promise<void>((resolve) => (release = resolve));
    await render(wait);
    await act(async () => button('Load route details')?.click());
    await flush();
    expect(status()).toBe('Paused: too many lookups; resuming in 2 seconds. 1 of 3 loaded.');
    await act(async () => release());
    await flush();
    expect(status()).toBe('Paused: too many lookups; resuming in 1 second. 1 of 3 loaded.');
    await act(async () => release());
    await flush();
    expect(status()).toMatch(/^Done: 3 of 3 loaded/);
  });

  it('stops when cancelled during a pause', async () => {
    const calls = stubFetch(true);
    const wait = (_ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
    await render(wait);
    await act(async () => button('Load route details')?.click());
    await flush();
    await act(async () => button('Cancel')?.click());
    await flush();
    expect(status()).toBe('Cancelled: 1 of 3 loaded.');
    expect(calls).toEqual(['R1', 'R2']);
    expect(button('Cancel')).toBeUndefined();
    // Only the route whose lookup answered is done: the other two are offered again.
    expect(button('Load route details')?.textContent).toBe('Load route details: 2 lookups');
    expect(note()).toBe('2 listed routes of Bhaisali still to load; press Load to continue.');
  });

  it('offers a route again when its lookup failed, and never claims it has details', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/depot/routes')) return json(LIST);
      const name = decodeURIComponent(url.split('/').pop() ?? '');
      calls.push(name);
      return name === 'R2' ? json({ error: 'upstream' }, 503) : json(OK);
    }) as typeof fetch;
    await render(async () => {});
    await act(async () => button('Load route details')?.click());
    await flush();
    expect(status()).toMatch(/^Done: 3 of 3 loaded, 1 could not be read\./);
    expect(note()).toBe('1 listed route of Bhaisali still to load; press Load to continue.');
    await act(async () => button('Load route details')?.click());
    await flush();
    expect(calls).toEqual(['R1', 'R2', 'R3', 'R2']);
  });

  it('says every route was looked up only once every lookup answered', async () => {
    stubFetch(false);
    await render(async () => {});
    await act(async () => button('Load route details')?.click());
    await flush();
    expect(button('Load route details')).toBeUndefined();
    expect(note()).toBe('Every listed route of Bhaisali has been looked up.');
  });
});

function note(): string | undefined {
  return document.querySelector('[data-testid="route-profile-loader"] .depot-note')?.textContent ?? undefined;
}
