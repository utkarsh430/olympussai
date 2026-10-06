import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { useWidthTier, type WidthTiers } from '@/components/depot/shell/useWidthTier';

const TIERS: WidthTiers<'wide' | 'mid' | 'phone'> = [
  ['wide', 1280],
  ['mid', 640],
  ['phone', 0],
];

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const realMatchMedia = window.matchMedia;
let viewport = 1440;
let listeners: (() => void)[] = [];
let container: HTMLDivElement;
let root: Root;

function Probe() {
  return <span>{useWidthTier(TIERS)}</span>;
}

function mockViewport(): void {
  window.matchMedia = ((query: string) => ({
    get matches() {
      return viewport >= Number(/min-width: (\d+)px/.exec(query)?.[1] ?? 0);
    },
    media: query,
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    removeEventListener: (_: string, fn: () => void) => {
      listeners = listeners.filter((l) => l !== fn);
    },
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  viewport = 1440;
  listeners = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.matchMedia = realMatchMedia;
});

describe('useWidthTier', () => {
  it('renders the widest tier on the server', () => {
    mockViewport();
    viewport = 390;
    expect(renderToString(<Probe />)).toContain('wide');
  });

  it('stays on the widest tier where the browser has no matchMedia', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    act(() => root.render(<Probe />));
    expect(container.textContent).toBe('wide');
  });

  it('reads the tier from the viewport and follows a crossing', () => {
    mockViewport();
    viewport = 800;
    act(() => root.render(<Probe />));
    expect(container.textContent).toBe('mid');
    viewport = 390;
    act(() => listeners.forEach((fn) => fn()));
    expect(container.textContent).toBe('phone');
    viewport = 1280;
    act(() => listeners.forEach((fn) => fn()));
    expect(container.textContent).toBe('wide');
  });

  it('stops listening when the page unmounts', () => {
    mockViewport();
    act(() => root.render(<Probe />));
    expect(listeners).toHaveLength(2);
    act(() => root.unmount());
    expect(listeners).toHaveLength(0);
    root = createRoot(container);
  });
});
