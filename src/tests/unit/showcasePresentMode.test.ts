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