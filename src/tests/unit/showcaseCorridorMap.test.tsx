// @vitest-environment jsdom
//
// The live trial's corridor map: the basemap when it can be had, the
// tactical plot when it cannot.
//
// Three paths, each of which is a distinct way the basemap goes missing and
// each of which must end on the tactical canvas rather than on a blank or a
// white panel: no key configured (the fallback is immediate, and the loader
// is never asked), the SDK failing to load (a rejected `importLibrary`), and
// Google refusing the key for this origin AFTER the map is built - the
// `gm_authFailure` hook, which leaves the container white and every other
// signal green. The ready path is exercised against the fleet layer's real
// `draw()` through the fake Google Maps harness, so what is asserted is
// what the layer actually painted, not what the component intended.
//
// The loader is mocked, not the environment: `.env.local` may or may not
// hold a key, and a test that depended on it would pass or fail by machine.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { installFakeGoogleMaps, type FakeMapHarness } from '@/tests/helpers/fakeGoogleMap';
import { LUCKNOW_CORRIDOR, SUBURBAN_CORRIDOR } from '@/lib/showcase/corridor';
import { emptyFrame, frameAt, type ReplayContext } from '@/lib/showcase/replayFrame';
import type { ReplayScenarioModel } from '@/lib/showcase/resolve';
import {
  CorridorMap,
  labelEveryStop,
  paletteFor,
  replayMarks,
  replayOverlays,
  tokenColour,
  type Ink,
} from '@/components/showcase/CorridorMap';

/* ── the loader, switchable per test ─────────────────────────────────────── */

const loader = vi.hoisted(() => ({
  configured: false,
  importLibrary: vi.fn<(library: string) => Promise<unknown>>(),
  authListeners: new Set<() => void>(),
}));

vi.mock('@/lib/maps/loader', () => ({
  isMapsConfigured: () => loader.configured,
  mapsAuthFailed: () => false,
  onMapsAuthFailure: (listener: () => void) => {
    loader.authListeners.add(listener);
    return () => loader.authListeners.delete(listener);
  },
  getMapsLoader: () => ({ importLibrary: loader.importLibrary }),
}));

/** Fire Google's authentication-failure hook, as the loader would. */
function failAuth(): void {
  act(() => {
    for (const listener of loader.authListeners) listener();
  });
}

/* ── the Maps surface the component touches that the shared fake lacks ───── */

let harness: FakeMapHarness | null = null;

interface Constructed {
  container: HTMLElement;
  options: google.maps.MapOptions;
}

class FakeMap {
  static constructed: Constructed[] = [];
  constructor(container: HTMLElement, options: google.maps.MapOptions) {
    FakeMap.constructed.push({ container, options });
    // The harness's map is what the fleet layer knows how to talk to.
    return (harness as FakeMapHarness).map as unknown as FakeMap;
  }
}