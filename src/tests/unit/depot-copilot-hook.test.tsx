import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCopilot, type CopilotHook } from '@/hooks/useCopilot';
import type { CopilotApiRequest } from '@/lib/depot/copilot/wire';

interface PendingCall {
  readonly signal: AbortSignal;
  readonly body: unknown;
  readonly respond: (status: number, body?: unknown) => void;
}

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalFetch = globalThis.fetch;
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;
const BODY: CopilotApiRequest = { task: 'briefing', scope: { kind: 'network' } };
const response = (headline: string): unknown => ({
  headline,
  paragraphs: ['p'],
  provider: 'scripted',
  notice: 'none',
  generatedAt: '2026-10-06T09:30:00.000Z',
  cached: false,
  facts: [],
});

let calls: PendingCall[] = [];
let latest: CopilotHook | null = null;
let root: Root | null = null;

function stubFetch(rejectOnAbort: boolean): void {
  calls = [];
  globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = (init as RequestInit).signal as AbortSignal;
    return new Promise<Response>((resolve, reject) => {
      calls.push({
        signal,
        body: JSON.parse((init as RequestInit).body as string),
        respond: (status, body) =>
          resolve({ status, ok: status === 200, json: async () => body } as unknown as Response),
      });
      if (rejectOnAbort) {
        signal.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        );
      }
    });
  }) as typeof fetch;
}

function Probe(): null {
  latest = useCopilot();
  return null;
}

function hook(): CopilotHook {
  if (!latest) throw new Error('hook has not rendered');
  return latest;
}

async function mount(): Promise<void> {
  root = createRoot(document.createElement('div'));
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

async function ask(body: CopilotApiRequest = BODY): Promise<void> {
  await act(async () => {
    hook().request(body);
  });
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

describe('useCopilot', () => {
  it('is idle and requests nothing on mount', async () => {
    await mount();
    expect(hook().state).toEqual({ status: 'idle' });
    expect(calls).toHaveLength(0);
  });

  it('goes loading then done with the response', async () => {
    await mount();
    await ask();
    expect(hook().state.status).toBe('loading');
    expect(calls[0]?.body).toEqual(BODY);
    await settle(calls[0], 200, response('H'));
    expect(hook().state).toMatchObject({ status: 'done', response: { headline: 'H' } });
  });

  it('fails with the kind for an error status', async () => {
    await mount();
    await ask();
    await settle(calls[0], 503, { error: 'x' });
    expect(hook().state).toEqual({ status: 'failed', kind: 'unavailable' });
  });

  it('aborts the in-flight request when a new one starts', async () => {
    await mount();
    await ask();
    await ask({ task: 'rationale', transferId: 't1' });
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(calls[1]?.signal.aborted).toBe(false);
    expect(hook().state.status).toBe('loading');
    await settle(calls[1], 200, response('second'));
    expect(hook().state).toMatchObject({ status: 'done', response: { headline: 'second' } });
  });

  it('never applies a late response from an aborted request, even if fetch ignores abort', async () => {
    stubFetch(false);
    await mount();
    await ask();
    await ask();
    await settle(calls[1], 200, response('new'));
    await settle(calls[0], 200, response('old'));
    expect(hook().state).toMatchObject({ status: 'done', response: { headline: 'new' } });
  });

  it('does not apply a late response after reset', async () => {
    stubFetch(false);
    await mount();
    await ask();
    await act(async () => {
      hook().reset();
    });
    await settle(calls[0], 200, response('late'));
    expect(hook().state).toEqual({ status: 'idle' });
  });

  it('aborts the in-flight request on unmount', async () => {
    // React 19 raises no warning for a state update after unmount, so a "late response"
    // cannot be observed from outside; the abort is the behaviour that can fail.
    await mount();
    await ask();
    expect(calls[0]?.signal.aborted).toBe(false);
    await unmount();
    expect(calls[0]?.signal.aborted).toBe(true);
  });

  it('survives a response that arrives after unmount without an unhandled error', async () => {
    stubFetch(false);
    await mount();
    await ask();
    await unmount();
    // A rejection from the handler would fail the run as an unhandled rejection.
    calls[0]?.respond(200, response('late'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls[0]?.signal.aborted).toBe(true);
  });

  it('counts down a rate limit, refuses requests meanwhile, then returns to idle', async () => {
    await mount();
    await ask();
    await settle(calls[0], 429, { error: 'slow', retryAfterSeconds: 3 });
    expect(hook().state).toEqual({
      status: 'failed',
      kind: 'rate_limited',
      secondsRemaining: 3,
    });

    await ask();
    expect(calls).toHaveLength(1);

    await tick(1000);
    expect(hook().state).toMatchObject({ secondsRemaining: 2 });
    await tick(1000);
    expect(hook().state).toMatchObject({ secondsRemaining: 1 });
    await ask();
    expect(calls).toHaveLength(1);

    await tick(1000);
    expect(hook().state).toEqual({ status: 'idle' });
    await ask();
    expect(calls).toHaveLength(2);
  });

  it('stops the countdown on unmount without updating', async () => {
    await mount();
    await ask();
    await settle(calls[0], 429, { error: 'slow', retryAfterSeconds: 5 });
    await unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reset returns to idle from any state', async () => {
    await mount();
    await ask();
    await settle(calls[0], 200, response('H'));
    await act(async () => {
      hook().reset();
    });
    expect(hook().state).toEqual({ status: 'idle' });
  });
});
