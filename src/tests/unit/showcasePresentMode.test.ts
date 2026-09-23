// @vitest-environment jsdom
//
// Present mode: the reducer's bounds, and the chrome's two faces.
//
// One file, two halves. The reducer half is plain arithmetic and would run in
// node; it lives here so the jsdom half can render the chrome the reducer
// drives without a second file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  initialPresentState,
  presentReducer,
  type PresentState,
} from '@/components/showcase/presentMode';
import { PresentChrome } from '@/components/showcase/PresentChrome';
import { ShowcaseStage } from '@/components/showcase/ShowcaseStage';

// ─── Reducer ──────────────────────────────────────────────────────────────

describe('presentReducer', () => {
  const COUNT = 5;
  const active = (index: number, paused = false): PresentState => ({ active: true, index, paused });

  it('starts inactive at the first scene', () => {
    expect(initialPresentState).toEqual({ active: false, index: 0, paused: false });
  });

  it('enter activates at the given or current index, clamped', () => {
    expect(presentReducer(initialPresentState, { type: 'enter' }, COUNT)).toEqual(active(0));
    expect(presentReducer(initialPresentState, { type: 'enter', index: 3 }, COUNT)).toEqual(
      active(3),
    );
    expect(presentReducer(initialPresentState, { type: 'enter', index: 99 }, COUNT)).toEqual(
      active(4),
    );
    expect(presentReducer({ ...initialPresentState, index: 2 }, { type: 'enter' }, COUNT)).toEqual(
      active(2),
    );
  });

  it('next stays at the last scene and prev stays at the first', () => {
    expect(presentReducer(active(3), { type: 'next' }, COUNT)).toEqual(active(4));
    const last = active(4);
    expect(presentReducer(last, { type: 'next' }, COUNT)).toBe(last);
    const first = active(0);
    expect(presentReducer(first, { type: 'prev' }, COUNT)).toBe(first);
    expect(presentReducer(active(1), { type: 'prev' }, COUNT)).toEqual(active(0));
  });

  it('goto clamps into range', () => {
    expect(presentReducer(active(2), { type: 'goto', index: -4 }, COUNT)).toEqual(active(0));
    expect(presentReducer(active(2), { type: 'goto', index: 40 }, COUNT)).toEqual(active(4));
    expect(presentReducer(active(2), { type: 'goto', index: 1 }, COUNT)).toEqual(active(1));
    expect(presentReducer(active(2), { type: 'goto', index: Number.NaN }, COUNT)).toEqual(
      active(0),
    );
  });

  it('sync moves the index without changing active', () => {
    expect(presentReducer(initialPresentState, { type: 'sync', index: 3 }, COUNT)).toEqual({
      active: false,
      index: 3,
      paused: false,
    });
    expect(presentReducer(active(1, true), { type: 'sync', index: 2 }, COUNT)).toEqual(
      active(2, true),
    );
    expect(presentReducer(active(1), { type: 'sync', index: 9 }, COUNT)).toEqual(active(4));
  });

  it('exit keeps the index and resets paused', () => {
    expect(presentReducer(active(3, true), { type: 'exit' }, COUNT)).toEqual({
      active: false,
      index: 3,
      paused: false,
    });
  });

  it('togglePause flips paused', () => {
    expect(presentReducer(active(1), { type: 'togglePause' }, COUNT)).toEqual(active(1, true));
    expect(presentReducer(active(1, true), { type: 'togglePause' }, COUNT)).toEqual(active(1));
  });

  it('returns the same object when nothing changes', () => {
    const state = active(2);
    expect(presentReducer(state, { type: 'goto', index: 2 }, COUNT)).toBe(state);
    expect(presentReducer(state, { type: 'sync', index: 2 }, COUNT)).toBe(state);
    expect(presentReducer(state, { type: 'enter', index: 2 }, COUNT)).toBe(state);
    expect(presentReducer(initialPresentState, { type: 'exit' }, COUNT)).toBe(initialPresentState);
    expect(presentReducer(initialPresentState, { type: 'sync', index: 0 }, COUNT)).toBe(
      initialPresentState,
    );
  });

  it('is safe with no scenes at all', () => {
    expect(presentReducer(initialPresentState, { type: 'enter', index: 3 }, 0)).toEqual(active(0));
    expect(presentReducer(active(0), { type: 'next' }, 0)).toEqual(active(0));
  });
});

// ─── Chrome ───────────────────────────────────────────────────────────────

const SCENES = Array.from({ length: 8 }, (_, i) => ({
  id: `scene-${i + 1}`,
  label: `Scene ${i + 1}`,
}));
const LABELS = new Set(SCENES.map((scene) => scene.label));

function pips(): HTMLElement[] {
  return screen
    .queryAllByRole('button')
    .filter((button) => LABELS.has(button.getAttribute('aria-label') ?? ''));
}

/**
 * The quiet theme's one negative rule, checked on a rendered subtree: none of
 * the HUD controls or labels, no glow on type, and no inline shadow. The grid
 * texture (`bg-hud-grid`) is part of the ground and is deliberately not on
 * this list.
 */
const LOUD_CLASSES = ['hud-button', 'hud-label', 'text-glow', 'holo-glow'];

function expectQuiet(root: HTMLElement) {
  for (const loud of LOUD_CLASSES) {
    expect(root.querySelector(`[class*="${loud}"]`), loud).toBeNull();
  }
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    expect(element.style.boxShadow).toBe('');
  }
}

function chromeProps(over: Partial<Parameters<typeof PresentChrome>[0]> = {}) {
  return {
    active: false,
    index: 0,
    scenes: SCENES,
    onEnter: vi.fn(),
    onExit: vi.fn(),
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onGoTo: vi.fn(),
    ...over,
  };
}

describe('PresentChrome', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        media: '',
        addEventListener() {},
        removeEventListener() {},
        // framer-motion's reduced-motion probe still uses the legacy pair.
        addListener() {},
        removeListener() {},
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers a Present button and no pips while inactive', () => {
    const props = chromeProps();
    render(createElement(PresentChrome, props));
    const present = screen.getByRole('button', { name: /present/i });
    expect(present).toBeInTheDocument();
    expect(pips()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /exit/i })).not.toBeInTheDocument();
    fireEvent.click(present);
    expect(props.onEnter).toHaveBeenCalledTimes(1);

    // The idle bar is chrome: the print stylesheet hides it by this attribute.
    const bar = screen.getByTestId('present-idle-bar');
    expect(bar).toHaveAttribute('data-showcase-chrome');
    expect(bar).toContainElement(present);
    expect(screen.getByLabelText('Press P to present')).toHaveTextContent('P');
    expectQuiet(bar);
  });

  it('shows one pip per scene, the current one marked, and the transport while active', () => {
    const props = chromeProps({ active: true, index: 2 });
    render(createElement(PresentChrome, props));

    const overlay = screen.getByTestId('present-overlay');
    expect(overlay).toHaveAttribute('data-showcase-chrome');
    expect(screen.queryByTestId('present-idle-bar')).not.toBeInTheDocument();
    expectQuiet(overlay);

    const dots = pips();
    expect(dots).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Scene 3' })).toHaveAttribute('aria-current', 'step');
    expect(dots.filter((dot) => dot.getAttribute('aria-current') === 'step')).toHaveLength(1);
    expect(screen.getByTestId('present-scene-label')).toHaveTextContent('Scene 3');

    fireEvent.click(screen.getByRole('button', { name: 'Scene 6' }));
    expect(props.onGoTo).toHaveBeenCalledWith(5);

    fireEvent.click(screen.getByRole('button', { name: /exit/i }));
    expect(props.onExit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(props.onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(props.onPrev).toHaveBeenCalledTimes(1);

    expect(screen.queryByRole('button', { name: /^present$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
  });
});

// ─── The stage, end to end in jsdom ───────────────────────────────────────

// jsdom has no canvas, no layout and no frame clock. The backdrop's field
// mounts a canvas loop, so the context is a no-op proxy, the observer never
// fires and the frame request never lands - the same stubs the scene tests
// use. Nothing here draws; what is asserted is the structure.
const originalGetContext = HTMLCanvasElement.prototype.getContext;

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

describe('ShowcaseStage', () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        media: '',
        addEventListener() {},
        removeEventListener() {},
        // framer-motion's reduced-motion probe still uses the legacy pair.
        addListener() {},
        removeListener() {},
      })),
    );
    vi.stubGlobal('ResizeObserver', NoopObserver);
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    HTMLCanvasElement.prototype.getContext = (() =>
      new Proxy({}, { get: () => () => undefined })) as unknown as typeof originalGetContext;
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  function renderStage() {
    const root = document.createElement('div');
    root.className = 'sc-root';
    document.body.appendChild(root);
    const scenes = SCENES.slice(0, 3);
    // Typed as the stage's own props: `children` is required there, which is
    // why it travels in the props object rather than as extra arguments.
    const props: Parameters<typeof ShowcaseStage>[0] = {
      scenes,
      children: scenes.map((scene) =>
        createElement(
          'section',
          { key: scene.id, id: scene.id, 'data-scene': scene.id },
          scene.label,
        ),
      ),
    };
    const view = render(createElement(ShowcaseStage, props), { container: root });
    return { view, root };
  }

  it('lays a layered, quiet, hidden-from-print backdrop under the scenes', () => {
    const { root } = renderStage();
    const backdrop = root.querySelector<HTMLElement>('[data-showcase-backdrop]');
    expect(backdrop).not.toBeNull();
    if (!backdrop) return;
    expect(backdrop).toHaveAttribute('aria-hidden');

    // The one thing that moves: a single page-wide field. Its ink follows
    // the accent, and it is the only canvas on the whole stage - the hero
    // no longer carries one of its own.
    const canvases = root.querySelectorAll('canvas');
    expect(canvases).toHaveLength(1);
    const canvas = canvases[0];
    expect(backdrop.contains(canvas ?? null)).toBe(true);
    expect(canvas?.parentElement?.classList.contains('text-primary')).toBe(true);

    // Everything else is still: no scanline, no noise, nothing animated,
    // nothing glowing, and no transform anywhere in the ground.
    expect(backdrop.querySelector('[class*="scanline"], [class*="noise"]')).toBeNull();
    expectQuiet(backdrop);
    for (const element of Array.from(backdrop.querySelectorAll<HTMLElement>('*'))) {
      expect(element.style.animation).toBe('');
      expect(element.style.transform).toBe('');
      for (const name of Array.from(element.classList)) {
        expect(name, name).not.toMatch(/^(hud-|animate-)|text-glow/);
      }
    }

    // The scenes sit above it, not inside it, and nothing between a scene
    // and the root carries a transform that would re-root `fixed` children.
    const scene = document.getElementById('scene-1');
    expect(backdrop.contains(scene)).toBe(false);
    for (let node = scene?.parentElement; node && node !== root; node = node.parentElement) {
      expect(node.style.transform).toBe('');
    }
  });

  it('enters on P, steps with the arrows, and leaves on Escape', () => {
    const { root } = renderStage();
    expect(screen.getByText('Scene 1')).toBeInTheDocument();
    expect(root.getAttribute('data-present')).toBeNull();

    act(() => {
      fireEvent.keyDown(window, { key: 'p' });
    });
    expect(root.getAttribute('data-present')).toBe('true');
    expect(screen.getByTestId('present-overlay')).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(screen.getByRole('button', { name: 'Scene 2' })).toHaveAttribute('aria-current', 'step');
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView.mock.contexts[1]).toBe(document.getElementById('scene-2'));

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(root.getAttribute('data-present')).toBeNull();
    expect(screen.getByRole('button', { name: /present/i })).toBeInTheDocument();
  });

  it('ignores P typed into a field', () => {
    const { root } = renderStage();
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      fireEvent.keyDown(input, { key: 'p' });
    });
    expect(root.getAttribute('data-present')).toBeNull();
  });
});
