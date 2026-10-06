import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTE_NOT_FOUND_MESSAGE, routeHourlyUrl, useRouteHourly } from '@/hooks/useRouteHourly';
import type { PolledState } from '@/hooks/usePolledJson';
import type { RouteHourlyResponse } from '@/lib/depot/service/types';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalFetch = globalThis.fetch;
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;

let urls: string[] = [];
let status = 200;
let latest: PolledState<RouteHourlyResponse> | null = null;
let root: Root | null = null;

const payload = { fetchedAt: 'marker' } as unknown as RouteHourlyResponse;

function Probe({ routeName }: { readonly routeName: string | null }) {
  latest = useRouteHourly(routeName);
  return null;
}

async function render(routeName: string | null): Promise<void> {
  await act(async () => {
    root = createRoot(document.createElement('div'));
    root.render(<Probe routeName={routeName} />);
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  urls = [];
  status = 200;
  latest = null;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return { status, ok: status === 200, json: async () => payload } as Response;
  }) as typeof fetch;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActFlag;
});

describe('useRouteHourly', () => {
  it('asks for the route on the service path and polls every minute', async () => {
    await render('KANPUR-LUCKNOW');
    expect(urls).toEqual(['/api/upsrtc/depot/service/route/KANPUR-LUCKNOW']);
    expect(latest).toMatchObject({ data: payload, loading: false, error: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(urls).toHaveLength(2);
  });

  it('makes no request for a null or malformed name', async () => {
    expect(routeHourlyUrl('../x')).toBeNull();
    await render('../x');
    expect(urls).toEqual([]);
    expect(latest).toMatchObject({ data: null, error: null });
  });

  it('reports a route the feed does not carry in its own words', async () => {
    status = 404;
    await render('KANPUR-LUCKNOW');
    expect(latest?.error).toBe(ROUTE_NOT_FOUND_MESSAGE);
  });
});
