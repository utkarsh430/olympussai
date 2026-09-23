'use client';

/**
 * Present mode: the reducer wired to the document.
 *
 * The hook owns every side effect the reducer deliberately does not: the
 * `data-present` attribute on `.sc-root` (which turns scroll-snap on), the
 * fullscreen request and its release, the scroll to the current scene, the
 * keyboard, and the IntersectionObserver that keeps the index in step with
 * whatever the visitor has scrolled to so the arrows continue from there.
 *
 * Scrolling happens only for a NAVIGATION - a key, a pip, entering - and
 * never for a `sync` from the observer. Scrolling on sync would have the
 * page drive its own scroll container while the visitor is still wheeling
 * through it, and with `scroll-snap-type: y mandatory` the browser already
 * lands the scene.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import {
  initialPresentState,
  presentReducer,
  type PresentAction,
  type PresentState,
} from './presentMode';

/** Visible fraction of a scene, or of the viewport, at which a scene counts as current. */
const CURRENT_SCENE_SHARE = 0.6;

/**
 * More than one threshold, because a scene taller than the viewport can never
 * be 60% visible: a gallery two viewports tall tops out at 50%. The callback
 * also accepts a scene that covers 60% of the ROOT, and the lower thresholds
 * are what give such a scene a callback to be accepted in.
 */
const OBSERVER_THRESHOLDS = [0.2, 0.4, CURRENT_SCENE_SHARE];

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function scrollRoot(): Element | null {
  return document.querySelector('.sc-root');
}

export interface PresentModeApi {
  state: PresentState;
  enter: (index?: number) => void;
  exit: () => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
}

export function usePresentMode({ sceneIds }: { sceneIds: readonly string[] }): PresentModeApi {
  // Callers may build `sceneIds` inline; the list itself is what matters.
  const sceneKey = sceneIds.join('\u0000');
  const ids = useMemo(() => (sceneKey === '' ? [] : sceneKey.split('\u0000')), [sceneKey]);
  const sceneCount = ids.length;

  const [state, dispatch] = useReducer(
    (current: PresentState, action: PresentAction) => presentReducer(current, action, sceneCount),
    initialPresentState,
  );
  const reduced = useReducedMotion();

  /** Set by a navigation, consumed by the scroll effect; never set by `sync`. */
  const scrollPendingRef = useRef(false);

  const enter = useCallback((index?: number) => {
    scrollPendingRef.current = true;
    dispatch({ type: 'enter', index });
    scrollRoot()?.setAttribute('data-present', 'true');
    const root = document.documentElement;
    if (typeof root.requestFullscreen === 'function') {
      try {
        root.requestFullscreen().catch(() => {});
      } catch {
        // A browser that refuses without a promise is a browser that stays windowed.
      }
    }
  }, []);

  const exit = useCallback(() => {
    dispatch({ type: 'exit' });
    scrollRoot()?.removeAttribute('data-present');
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      try {
        document.exitFullscreen().catch(() => {});
      } catch {
        // Nothing to release.
      }
    }
  }, []);

  const next = useCallback(() => {
    scrollPendingRef.current = true;
    dispatch({ type: 'next' });
  }, []);

  const prev = useCallback(() => {
    scrollPendingRef.current = true;
    dispatch({ type: 'prev' });
  }, []);

  const goTo = useCallback((index: number) => {
    scrollPendingRef.current = true;
    dispatch({ type: 'goto', index });
  }, []);

  // Leaving fullscreen by any route (Esc handled by the browser, the window
  // control, a tab switch) leaves present mode with it.
  useEffect(() => {
    if (!state.active) return;
    const handler = () => {
      if (!document.fullscreenElement) exit();
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, [state.active, exit]);

  // A navigation lands its scene.
  useEffect(() => {
    if (!state.active || !scrollPendingRef.current) return;
    scrollPendingRef.current = false;
    const id = ids[state.index];
    if (id === undefined) return;
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }, [state.active, state.index, ids, reduced]);

  // Keyboard.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!state.active) {
        if (
          (event.key === 'p' || event.key === 'P') &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !isEditable(event.target)
        ) {
          event.preventDefault();
          enter();
        }
        return;
      }
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
          event.preventDefault();
          next();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          event.preventDefault();
          prev();
          break;
        case 'Home':
          event.preventDefault();
          goTo(0);
          break;
        case 'End':
          event.preventDefault();
          goTo(sceneCount - 1);
          break;
        case 'Escape':
          event.preventDefault();
          exit();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.active, sceneCount, enter, exit, next, prev, goTo]);

  // Keep the index in step with what is on screen.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-scene]'));
    if (elements.length === 0) return;

    const indexOf = (element: HTMLElement): number => {
      const byId = ids.indexOf(element.id);
      if (byId !== -1) return byId;
      const key = element.dataset.scene;
      return key === undefined ? -1 : ids.indexOf(key);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const rootHeight = entry.rootBounds?.height ?? 0;
          const coversRoot =
            rootHeight > 0 && entry.intersectionRect.height >= CURRENT_SCENE_SHARE * rootHeight;
          if (entry.intersectionRatio < CURRENT_SCENE_SHARE && !coversRoot) continue;
          const index = indexOf(entry.target as HTMLElement);
          if (index !== -1) dispatch({ type: 'sync', index });
        }
      },
      { root: scrollRoot(), threshold: OBSERVER_THRESHOLDS },
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [ids]);

  // Unmounting mid-presentation must not leave the scroll container snapping.
  useEffect(() => () => scrollRoot()?.removeAttribute('data-present'), []);

  return { state, enter, exit, next, prev, goTo };
}
