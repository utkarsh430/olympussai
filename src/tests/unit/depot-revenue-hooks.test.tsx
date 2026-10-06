import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDepotEconomics } from '@/hooks/useDepotEconomics';
import { useDepotRevenue } from '@/hooks/useDepotRevenue';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalFetch = globalThis.fetch;
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;

let urls: string[] = [];
let root: Root | null = null;

function RevenueProbe({ depotId }: { readonly depotId: string | null }) {
  useDepotRevenue(depotId);
  return null;
}

function EconomicsProbe() {
  useDepotEconomics();
  return null;
}

async function render(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root = createRoot(document.createElement('div'));
    root.render(element);
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  urls = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return { status: 200, ok: true, json: async () => ({}) } as Response;
  }) as typeof fetch;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActFlag;
});

describe('useDepotRevenue', () => {
  it('polls the revenue path of the depot', async () => {
    await render(<RevenueProbe depotId="4560" />);
    expect(urls).toEqual(['/api/upsrtc/depot/4560/revenue']);
  });

  it('makes no request for a null or malformed id', async () => {
    await render(<RevenueProbe depotId="../x" />);
    expect(urls).toEqual([]);
  });
});

describe('useDepotEconomics', () => {
  it('polls the network economics path', async () => {
    await render(<EconomicsProbe />);
    expect(urls).toEqual(['/api/upsrtc/depot/economics']);
  });
});
