import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POLL_INTERVAL_MS,
  DEPOT_UNAVAILABLE_MESSAGE,
  NETWORK_UNREACHABLE_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  usePolledJson,
  type PolledJsonOptions,
  type PolledState,
} from '@/hooks/usePolledJson';
import { useFetchedJson } from '@/hooks/useFetchedJson';

interface Doc {
  readonly marker: string;
}

interface PendingCall {
  readonly url: string;
  readonly init: RequestInit;
  readonly signal: AbortSignal;
  readonly json: ReturnType<typeof vi.fn>;
  readonly respond: (status: number, body?: unknown) => void;
  readonly fail: (error: unknown) => void;
}

type Options = PolledJsonOptions;

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalFetch = globalThis.fetch;
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;

let calls: PendingCall[] = [];
let latest: PolledState<Doc> | null = null;
let renders: PolledState<Doc>[] = [];
let root: Root | null = null;
let container: HTMLElement | null = null;

function stubFetch(rejectOnAbort: boolean): void {
  calls = [];
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const signal = (init as RequestInit).signal as AbortSignal;
    return new Promise<Response>((resolve, reject) => {
      const json = vi.fn();
      calls.push({
        url: String(input),
        init: init as RequestInit,
        signal,
        json,
        respond: (status, body) => {
          json.mockImplementation(async () => body);
          resolve({ status, ok: status >= 200 && status < 300, json } as unknown as Response);
        },
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

const doc = (marker: string): Doc => ({ marker });

function PolledProbe(props: { readonly url: string | null; readonly options?: Options }) {
  const state = usePolledJson<Doc>(props.url, props.options);
  latest = state;
  renders.push(state);
  return null;
}

function FetchedProbe(props: { readonly url: string | null }) {
  const state = useFetchedJson<Doc>(props.url);
  latest = { ...state, refresh: () => undefined };
  return null;
}

async function mount(element: React.ReactElement): Promise<void> {
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => {
    root?.render(element);
  });
}

async function rerender(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root?.render(element);
  });
}

async function unmount(): Promise<void> {
  await act(async () => {
    root?.unmount();
  });
  root = null;
}

async function settle(call: PendingCall | undefined, status: number, body?: unknown) {
  await act(async () => {
    call?.respond(status, body);
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function state(): PolledState<Doc> {
  if (!latest) throw new Error('hook has not rendered');
  return latest;
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  latest = null;
  renders = [];
  stubFetch(true);
});

afterEach(async () => {
  if (root) await unmount();
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActFlag;
});

describe('usePolledJson', () => {
  it('requests the url with cache no-store', async () => {
    await mount(<PolledProbe url="/api/a" />);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/a');
    expect(calls[0]?.init.cache).toBe('no-store');
  });

  it('is loading until the first response, then never loading again', async () => {
    await mount(<PolledProbe url="/api/a" />);
    expect(state()).toMatchObject({ loading: true, data: null, error: null });
    await settle(calls[0], 200, doc('one'));
    expect(state()).toMatchObject({ loading: false, data: doc('one'), error: null });
    await tick(DEFAULT_POLL_INTERVAL_MS);
    expect(calls).toHaveLength(2);
    expect(state().loading).toBe(false);
  });

  it('polls on a custom interval', async () => {
    await mount(<PolledProbe url="/api/a" options={{ intervalMs: 1000 }} />);
    await tick(3000);
    expect(calls).toHaveLength(4);
  });

  it('stops loading when the first request fails', async () => {
    await mount(<PolledProbe url="/api/a" />);
    await act(async () => {
      calls[0]?.fail(new TypeError('Failed to fetch'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(state()).toMatchObject({
      loading: false,
      data: null,
      error: NETWORK_UNREACHABLE_MESSAGE,
    });
  });

  it('keeps the last good data on a failed poll, then clears the error on success', async () => {
    await mount(<PolledProbe url="/api/a" />);
    await settle(calls[0], 200, doc('good'));
    await tick(DEFAULT_POLL_INTERVAL_MS);
    await settle(calls[1], 500);
    expect(state()).toMatchObject({ data: doc('good'), error: DEPOT_UNAVAILABLE_MESSAGE });
    await tick(DEFAULT_POLL_INTERVAL_MS);
    await settle(calls[2], 200, doc('newer'));
    expect(state()).toMatchObject({ data: doc('newer'), error: null });
  });

  it('uses the fixed messages', async () => {
    expect(SESSION_EXPIRED_MESSAGE).toBe('Session expired');
    expect(DEPOT_UNAVAILABLE_MESSAGE).toBe('Depot data unavailable');
    expect(NETWORK_UNREACHABLE_MESSAGE).toBe('Could not reach the server');
    await mount(<PolledProbe url="/api/a" />);
    await settle(calls[0], 401);
    expect(state().error).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it('prefers a custom status message but still lets 401 through', async () => {
    const statusMessages = { 404: 'Gone' } as const;
    await mount(<PolledProbe url="/api/a" options={{ statusMessages }} />);
    await settle(calls[0], 404);
    expect(state().error).toBe('Gone');
    await tick(DEFAULT_POLL_INTERVAL_MS);
    await settle(calls[1], 401);
    expect(state().error).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it('refresh aborts the in-flight request and applies only the second response', async () => {
    await mount(<PolledProbe url="/api/a" />);
    const first = calls[0];
    await act(async () => {
      state().refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toHaveLength(2);
    expect(first?.signal.aborted).toBe(true);
    await settle(calls[1], 200, doc('second'));
    await settle(first, 200, doc('first'));
    expect(state()).toMatchObject({ data: doc('second'), error: null });
  });

  it('never reports an aborted request as an error', async () => {
    await mount(<PolledProbe url="/api/a" />);
    await act(async () => {
      state().refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(state()).toMatchObject({ error: null, loading: true });
  });

  it('does nothing for a null url', async () => {
    await mount(<PolledProbe url={null} />);
    await tick(DEFAULT_POLL_INTERVAL_MS * 2);
    await act(async () => state().refresh());
    expect(calls).toHaveLength(0);
    expect(state()).toMatchObject({ data: null, error: null, loading: false });
  });

  it('discards the previous url data at once and ignores a late old response', async () => {
    stubFetch(false);
    await mount(<PolledProbe url="/api/a" />);
    await settle(calls[0], 200, doc('a'));
    await rerender(<PolledProbe url="/api/b" />);
    expect(state()).toMatchObject({ data: null, loading: true, error: null });
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(calls[1]?.url).toBe('/api/b');

    // b is still in flight when the url moves on; its late answer must change nothing.
    await rerender(<PolledProbe url="/api/c" />);
    await settle(calls[1], 200, doc('b-late'));
    expect(state()).toMatchObject({ data: null, loading: true });
    await settle(calls[2], 200, doc('c'));
    expect(state().data).toEqual(doc('c'));
  });

  it('never exposes the old url data in any render after the url changes', async () => {
    await mount(<PolledProbe url="/api/a" />);
    await settle(calls[0], 200, doc('a'));
    const before = renders.length;
    await rerender(<PolledProbe url="/api/b" />);
    expect(renders.length).toBeGreaterThan(before);
    expect(renders.slice(before).every((r) => r.data === null)).toBe(true);
  });

  it('sets no state and renders nothing when a response lands after unmount', async () => {
    stubFetch(false);
    await mount(<PolledProbe url="/api/a" />);
    const pending = calls[0];
    await unmount();
    expect(pending?.signal.aborted).toBe(true);
    const rendersAtUnmount = renders.length;

    await settle(pending, 200, doc('late'));
    await tick(DEFAULT_POLL_INTERVAL_MS * 3);

    expect(renders).toHaveLength(rendersAtUnmount);
    // The body is never even read once the request was aborted.
    expect(pending?.json).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });
});

describe('useFetchedJson', () => {
  it('fetches once and never again as time passes', async () => {
    await mount(<FetchedProbe url="/api/a" />);
    await settle(calls[0], 200, doc('one'));
    await tick(DEFAULT_POLL_INTERVAL_MS * 5);
    expect(calls).toHaveLength(1);
    expect(latest).toMatchObject({ data: doc('one'), loading: false, error: null });
  });

  it('refetches when the url changes and discards the old data', async () => {
    await mount(<FetchedProbe url="/api/a" />);
    await settle(calls[0], 200, doc('a'));
    await rerender(<FetchedProbe url="/api/b" />);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(latest).toMatchObject({ data: null, loading: true });
    await settle(calls[1], 200, doc('b'));
    expect(latest?.data).toEqual(doc('b'));
  });

  it('uses the same fixed errors and does nothing for null', async () => {
    await mount(<FetchedProbe url="/api/a" />);
    await settle(calls[0], 401);
    expect(latest?.error).toBe(SESSION_EXPIRED_MESSAGE);
    await rerender(<FetchedProbe url={null} />);
    expect(calls).toHaveLength(1);
    expect(latest).toMatchObject({ data: null, error: null, loading: false });
  });
});

describe('usePolledJson keeping the previous answer across a query change', () => {
  const keep = { keepPreviousOnQueryChange: true } as const;

  it('keeps the previous rows, marked previous and loading, until the new query answers', async () => {
    await mount(<PolledProbe url="/api/routes?q=a" options={keep} />);
    await settle(calls[0], 200, doc('a'));
    await rerender(<PolledProbe url="/api/routes?q=ag" options={keep} />);
    expect(state()).toMatchObject({ data: doc('a'), loading: true, previous: true, error: null });
    await settle(calls[1], 200, doc('ag'));
    expect(state()).toMatchObject({ data: doc('ag'), loading: false, previous: false });
  });

  it('never carries an answer to another path, such as another depot', async () => {
    await mount(<PolledProbe url="/api/depot/A/fuel" options={keep} />);
    await settle(calls[0], 200, doc('A'));
    await rerender(<PolledProbe url="/api/depot/B/fuel" options={keep} />);
    expect(state()).toMatchObject({ data: null, loading: true, previous: false });
  });

  it('never carries an answer when the caller did not ask for it', async () => {
    await mount(<PolledProbe url="/api/routes?q=a" />);
    await settle(calls[0], 200, doc('a'));
    await rerender(<PolledProbe url="/api/routes?q=ag" />);
    expect(state()).toMatchObject({ data: null, loading: true, previous: false });
  });

  it('drops the previous rows when the new query fails', async () => {
    await mount(<PolledProbe url="/api/routes?q=a" options={keep} />);
    await settle(calls[0], 200, doc('a'));
    await rerender(<PolledProbe url="/api/routes?q=ag" options={keep} />);
    await settle(calls[1], 500);
    expect(state()).toMatchObject({ data: null, error: DEPOT_UNAVAILABLE_MESSAGE, previous: false });
  });
});
