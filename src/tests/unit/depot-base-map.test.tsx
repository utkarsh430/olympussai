import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const loader = vi.hoisted(() => ({
  configured: true,
  resolveMaps: null as null | ((lib: unknown) => void),
  refuse: null as null | (() => void),
  built: 0,
}));

vi.mock('@/lib/maps/loader', () => ({
  isMapsConfigured: () => loader.configured,
  getMapsLoader: () => ({
    importLibrary: (name: string) => {
      if (name !== 'maps') return Promise.resolve({});
      return new Promise((resolve) => {
        loader.resolveMaps = resolve;
      });
    },
  }),
}));

vi.mock('@/lib/maps/authFailure', () => ({
  onMapsAuthFailure: (fn: () => void) => {
    loader.refuse = fn;
    return () => {
      loader.refuse = null;
    };
  },
}));

import { BASE_MAP_LOAD_TIMEOUT_MS, useBaseMap } from '@/components/depot/shell/useBaseMap';

class FakeMap {
  constructor() {
    loader.built += 1;
  }
}

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;
const cleanup = vi.fn();

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const { status, message } = useBaseMap(ref, { stillAvailable: 'See the table.', onCleanup: cleanup });
  return (
    <div>
      <div ref={ref} />
      <span data-testid="status">{status}</span>
      <span data-testid="message">{message}</span>
    </div>
  );
}

const text = (id: string): string =>
  container.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';

async function loadLibrary(): Promise<void> {
  await act(async () => {
    loader.resolveMaps?.({ Map: FakeMap });
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(loader, { configured: true, resolveMaps: null, refuse: null, built: 0 });
  cleanup.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('useBaseMap', () => {
  it('builds the map and is ready once the library loads', async () => {
    expect(text('status')).toBe('loading');
    await loadLibrary();
    expect(text('status')).toBe('ready');
    expect(loader.built).toBe(1);
  });

  it('says the map is slow at the timeout, then builds it if the library arrives late', async () => {
    act(() => vi.advanceTimersByTime(BASE_MAP_LOAD_TIMEOUT_MS));
    expect(text('status')).toBe('error');
    expect(text('message')).toBe('The basemap took too long to load. See the table.');
    await loadLibrary();
    expect(text('status')).toBe('ready');
    expect(loader.built).toBe(1);
  });

  it('keeps a refusal final even when the library loads after it', async () => {
    act(() => loader.refuse?.());
    await loadLibrary();
    expect(text('status')).toBe('error');
    expect(text('message')).toBe('The basemap refused this request for this domain. See the table.');
    expect(loader.built).toBe(0);
  });

  it('keeps a refusal final after the map was ready', async () => {
    await loadLibrary();
    act(() => loader.refuse?.());
    expect(text('status')).toBe('error');
    act(() => vi.advanceTimersByTime(BASE_MAP_LOAD_TIMEOUT_MS));
    expect(text('message')).toContain('refused');
  });

  it('cleans up the page overlays and stops listening on unmount', () => {
    act(() => root.unmount());
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(loader.refuse).toBeNull();
    root = createRoot(container);
  });
});
