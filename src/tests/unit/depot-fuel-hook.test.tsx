import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDepotFuel } from '@/hooks/useDepotFuel';
import type { PolledState } from '@/hooks/usePolledJson';
import type { FuelResponse } from '@/lib/depot/fuel/api';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalFetch = globalThis.fetch;
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;

let urls: string[] = [];
let status = 200;
let latest: PolledState<FuelResponse> | null = null;
let root: Root | null = null;

const payload = { fetchedAt: 'marker' } as unknown as FuelResponse;

function Probe({ depotId }: { readonly depotId: string | null }) {
  latest = useDepotFuel(depotId);
  return null;
}

async function render(depotId: string | null): Promise<void> {
  await act(async () => {
    root = createRoot(document.createElement('div'));
    root.render(<Probe depotId={depotId} />);
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

describe('useDepotFuel', () => {
  it('polls the fuel path of the depot', async () => {
    await render('4560');
    expect(urls).toEqual(['/api/upsrtc/depot/4560/fuel']);
    expect(latest).toMatchObject({ data: payload, loading: false, error: null });
  });

  it('makes no request for a null or malformed id', async () => {
    await render('../x');
    expect(urls).toEqual([]);
    expect(latest).toMatchObject({ data: null, error: null });
  });

  it('reports 404 as Depot not found and other failures with the shared words', async () => {
    status = 404;
    await render('4560');
    expect(latest?.error).toBe('Depot not found');
  });
});
