// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SLOW_AFTER_MS, useRouteProfile, type UseRouteProfile } from '@/hooks/useRouteProfile';

let host: HTMLDivElement;
let root: Root;
let seen: UseRouteProfile | null = null;
const originalFetch = globalThis.fetch;

function Probe({ name }: { readonly name: string }) {
  seen = useRouteProfile(name);
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

describe('useRouteProfile', () => {
  it('turns slow after the threshold while the lookup is still running', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as typeof fetch;
    await act(async () => root.render(<Probe name="R1" />));
    expect(seen?.loading).toBe(true);
    expect(seen?.slow).toBe(false);
    await act(async () => vi.advanceTimersByTime(SLOW_AFTER_MS + 1));
    expect(seen?.slow).toBe(true);
  });

  it('reports a 429 with its seconds, and looks the route up again only on retry', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response('{}', { status: 429, headers: { 'Retry-After': '9' } });
    }) as typeof fetch;
    await act(async () => root.render(<Probe name="R1" />));
    expect(seen?.retryAfterSeconds).toBe(9);
    expect(seen?.error).toBe('Too many route lookups just now. Try again in 9 seconds.');
    expect(calls).toHaveLength(1);
    await act(async () => seen?.retry());
    expect(calls).toHaveLength(2);
  });
});
