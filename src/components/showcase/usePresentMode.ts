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