import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDepotDetail } from '@/hooks/useDepotDetail';
import type { PolledState } from '@/hooks/usePolledJson';
import type { DepotDetailResponse } from '@/lib/depot/api';

// A 401 sends the browser to sign in; jsdom cannot navigate, so the redirect is a stand-in.
vi.mock('@/lib/depot/signInRedirect', () => ({ redirectToSignIn: vi.fn() }));

interface PendingCall {
  readonly url: string;
  readonly respond: (status: number, body?: unknown) => void;
}

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalFetch = globalThis.fetch;
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;

let calls: PendingCall[] = [];
let latest: PolledState<DepotDetailResponse> | null = null;
let root: Root | null = null;

function stubFetch(): void {
  calls = [];
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const signal = (init as RequestInit).signal as AbortSignal;
    return new Promise<Response>((resolve, reject) => {
      calls.push({
        url: String(input),
        respond: (status, body) =>
          resolve({
            status,
            ok: status >= 200 && status < 300,
            json: async () => body,
          } as Response),
      });
      signal.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      );
    });
  }) as typeof fetch;
}

const detail = (marker: string): DepotDetailResponse =>
  ({ fetchedAt: marker }) as unknown as DepotDetailResponse;

function Probe({ depotId }: { readonly depotId: string | null }) {
  latest = useDepotDetail(depotId);
  return null;
}

async function render(depotId: string | null): Promise<void> {
  await act(async () => {
    if (!root) root = createRoot(document.createElement('div'));
    root.render(<Probe depotId={depotId} />);
  });
}

async function settle(call: PendingCall | undefined, status: number, body?: unknown) {
  await act(async () => {
    call?.respond(status, body);
    await vi.advanceTimersByTimeAsync(0);
  });
}

function state(): PolledState<DepotDetailResponse> {
  if (!latest) throw new Error('hook has not rendered');
  return latest;
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  latest = null;
  stubFetch();
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActFlag;
});

describe('useDepotDetail', () => {
  it('polls the detail path for the depot id', async () => {
    await render('4560');
    expect(calls.map((c) => c.url)).toEqual(['/api/upsrtc/depot/4560']);
    await settle(calls[0], 200, detail('one'));
    expect(state()).toMatchObject({ data: detail('one'), loading: false, error: null });
  });

  it('does not fetch for a null id', async () => {
    await render(null);
    expect(calls).toHaveLength(0);
    expect(state()).toMatchObject({ data: null, error: null, loading: false });
  });

  it('does not fetch for an invalid id', async () => {
    await render('../x');
    expect(calls).toHaveLength(0);
    expect(state()).toMatchObject({ data: null, error: null, loading: false });
  });

  it('reports a 404 as Depot not found', async () => {
    await render('4560');
    await settle(calls[0], 404);
    expect(state().error).toBe('Depot not found');
  });

  it('reports a 400 as Invalid depot id', async () => {
    await render('4560');
    await settle(calls[0], 400);
    expect(state().error).toBe('Invalid depot id');
  });

  it('keeps the shared messages for other failures', async () => {
    await render('4560');
    await settle(calls[0], 401);
    expect(state().error).toBe('Session expired');
  });

  it('discards the previous depot data at once when the depot changes', async () => {
    await render('4560');
    await settle(calls[0], 200, detail('first'));
    await render('4561');
    expect(state()).toMatchObject({ data: null, loading: true, error: null });
    expect(calls[1]?.url).toBe('/api/upsrtc/depot/4561');
    await settle(calls[1], 200, detail('second'));
    expect(state().data).toEqual(detail('second'));
  });
});
