import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEPOT_POLL_INTERVAL_MS,
  DEPOT_UNAVAILABLE_MESSAGE,
  NETWORK_UNREACHABLE_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  useDepotNetwork,
  type DepotNetworkState,
} from '@/hooks/useDepotNetwork';
import type { DepotNetworkResponse } from '@/lib/depot/api';

interface PendingCall {
  readonly url: string;
  readonly init: RequestInit;
  readonly signal: AbortSignal;
  readonly respond: (status: number, body?: unknown) => void;
  readonly fail: (error: unknown) => void;
}

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalFetch = globalThis.fetch;
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;

let calls: PendingCall[] = [];
let latest: DepotNetworkState | null = null;
let root: Root | null = null;
let container: HTMLElement | null = null;

/** Real fetch rejects with an AbortError when its signal fires; mimic that unless told not to. */
function stubFetch(rejectOnAbort: boolean): void {
  calls = [];
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const signal = (init as RequestInit).signal as AbortSignal;
    return new Promise<Response>((resolve, reject) => {
      calls.push({
        url: String(input),
        init: init as RequestInit,
        signal,
        respond: (status, body) =>
          resolve({
            status,
            ok: status >= 200 && status < 300,
            json: async () => body,
          } as Response),
        fail: reject,
      });
      if (rejectOnAbort) {
        signal.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        );
      }
    });
  }) as typeof fetch;
}

function payload(marker: string): DepotNetworkResponse {
  return { fetchedAt: marker } as unknown as DepotNetworkResponse;
}

function Probe() {
  latest = useDepotNetwork();
  return null;
}

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function mount(): Promise<void> {
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => {
    root?.render(<Probe />);
  });
}

async function unmount(): Promise<void> {
  await act(async () => {
    root?.unmount();
  });
  root = null;
}

async function settle(call: PendingCall, status: number, body?: unknown): Promise<void> {
  await act(async () => {
    call.respond(status, body);
    await vi.advanceTimersByTimeAsync(0);
  });
}

function state(): DepotNetworkState {
  if (!latest) throw new Error('hook has not rendered');
  return latest;
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  latest = null;
  stubFetch(true);
});

afterEach(async () => {
  if (root) await unmount();
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActFlag;
});

describe('useDepotNetwork', () => {
  it('requests the network path with cache no-store', async () => {
    await mount();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/upsrtc/depot/network');
    expect(calls[0]?.init.cache).toBe('no-store');
  });

  it('is loading until the first response, then never loading again', async () => {
    await mount();
    expect(state().loading).toBe(true);
    expect(state().data).toBeNull();

    await settle(calls[0] as PendingCall, 200, payload('one'));
    expect(state().loading).toBe(false);
    expect(state().data).toEqual(payload('one'));
    expect(state().error).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEPOT_POLL_INTERVAL_MS);
    });
    expect(calls).toHaveLength(2);
    expect(state().loading).toBe(false);
  });

  it('stops loading when the first request fails', async () => {
    await mount();
    await act(async () => {
      (calls[0] as PendingCall).fail(new TypeError('Failed to fetch'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(state().loading).toBe(false);
    expect(state().data).toBeNull();
    expect(state().error).toBe(NETWORK_UNREACHABLE_MESSAGE);
  });

  it('keeps the last good data on a failed poll, then clears the error on success', async () => {
    await mount();
    await settle(calls[0] as PendingCall, 200, payload('good'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEPOT_POLL_INTERVAL_MS);
    });
    await settle(calls[1] as PendingCall, 500);
    expect(state().data).toEqual(payload('good'));
    expect(state().error).toBe(DEPOT_UNAVAILABLE_MESSAGE);
    expect(state().loading).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEPOT_POLL_INTERVAL_MS);
    });
    await settle(calls[2] as PendingCall, 200, payload('newer'));
    expect(state().data).toEqual(payload('newer'));
    expect(state().error).toBeNull();
  });

  it('reports a 401 as an expired session', async () => {
    await mount();
    await settle(calls[0] as PendingCall, 401);
    expect(state().error).toBe(SESSION_EXPIRED_MESSAGE);
    expect(SESSION_EXPIRED_MESSAGE).toBe('Session expired');
    expect(state().loading).toBe(false);
  });

  it('uses fixed messages and never surfaces raw browser text', async () => {
    expect(DEPOT_UNAVAILABLE_MESSAGE).toBe('Depot data unavailable');
    expect(NETWORK_UNREACHABLE_MESSAGE).toBe('Could not reach the server');
    await mount();
    await act(async () => {
      (calls[0] as PendingCall).fail(new Error('NetworkError when attempting to fetch resource.'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(state().error).toBe(NETWORK_UNREACHABLE_MESSAGE);
  });

  it('refresh aborts the in-flight request and applies only the second response', async () => {
    await mount();
    const first = calls[0] as PendingCall;
    await act(async () => {
      state().refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toHaveLength(2);
    expect(first.signal.aborted).toBe(true);
    expect(calls[1]?.signal.aborted).toBe(false);

    await settle(calls[1] as PendingCall, 200, payload('second'));
    expect(state().data).toEqual(payload('second'));

    // A late answer from the aborted request must change nothing.
    await settle(first, 200, payload('first'));
    expect(state().data).toEqual(payload('second'));
    expect(state().error).toBeNull();
  });

  it('ignores a late response from an aborted request even if fetch does not reject', async () => {
    stubFetch(false);
    await mount();
    const first = calls[0] as PendingCall;
    await act(async () => {
      state().refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    await settle(calls[1] as PendingCall, 200, payload('second'));
    await settle(first, 200, payload('first'));
    expect(state().data).toEqual(payload('second'));
  });

  it('never reports an aborted request as an error', async () => {
    await mount();
    await act(async () => {
      state().refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    // The first request has been aborted and rejected with AbortError by now.
    expect(state().error).toBeNull();
    expect(state().loading).toBe(true);
  });

  it('stops polling and sets no state after unmount', async () => {
    await mount();
    const first = calls[0] as PendingCall;
    await unmount();
    expect(first.signal.aborted).toBe(true);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => {
      first.respond(200, payload('late'));
      await vi.advanceTimersByTimeAsync(DEPOT_POLL_INTERVAL_MS * 3);
    });
    expect(calls).toHaveLength(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(state().data).toBeNull();
    errorSpy.mockRestore();
  });
});
