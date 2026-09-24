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

class FakePolyline {
  static constructed: FakePolyline[] = [];
  map: unknown;
  constructor(readonly options: google.maps.PolylineOptions) {
    this.map = options.map ?? null;
    FakePolyline.constructed.push(this);
  }
  setMap(map: unknown) {
    this.map = map;
  }
}

class FakeMarker {
  static constructed: FakeMarker[] = [];
  map: unknown;
  constructor(readonly options: google.maps.MarkerOptions) {
    this.map = options.map ?? null;
    FakeMarker.constructed.push(this);
  }
  setMap(map: unknown) {
    this.map = map;
  }
}

class FakeLatLngBounds {
  constructor(
    readonly southWest: google.maps.LatLngLiteral,
    readonly northEast: google.maps.LatLngLiteral,
  ) {}
}

class FakePoint {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
}

function installMaps(): FakeMapHarness {
  const installed = installFakeGoogleMaps();
  harness = installed;
  Object.assign((globalThis as { google: { maps: object } }).google.maps, {
    Map: FakeMap,
    Polyline: FakePolyline,
    Marker: FakeMarker,
    LatLngBounds: FakeLatLngBounds,
    Point: FakePoint,
    SymbolPath: { CIRCLE: 0 },
  });
  return installed;
}

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const SCENARIO: ReplayScenarioModel = {
  id: 'steady_variability',
  title: 'Steady variability',
  note: 'Ordinary running-time noise.',
  horizonSeconds: 4000,
  vehicleCount: 2,
  trajectories: {
    controlled: [
      {
        vehicleId: 'bus-1',
        points: [
          { t: 0, d: 0, hold: 0 },
          { t: 1000, d: 1000, hold: 0 },
          { t: 2000, d: 2000, hold: 0 },
        ],
      },
      {
        vehicleId: 'bus-2',
        points: [
          { t: 300, d: 0, hold: 0 },
          { t: 1100, d: 1000, hold: 60 },
          { t: 2000, d: 2000, hold: 0 },
        ],
      },
    ],
    uncontrolled: [],
  },
  sweeps: { controlled: [], uncontrolled: [] },
  netPercent: 3.1,
  excessWaitPercent: 40,
  incidentsAvoided: 2,
};

const CTX: ReplayContext = {
  route: LUCKNOW_CORRIDOR,
  trialCorridorLengthMeters: 24_000,
  targetHeadwaySeconds: 360,
  bunchedThresholdRatio: 0.25,
  warningThresholdRatio: 0.5,
};

/** At 1,150 s bus-2 is being held at station 2 and bus-1 is 130 m ahead: one hold, one warning pair. */
const FRAME = frameAt(SCENARIO, 'controlled', 1150, CTX);

const INK: Ink = {
  controlled: '#3ab3c9',
  baseline: '#7e93a6',
  success: '#2bff88',
  warning: '#ffb020',
  danger: '#ff4d5e',
  foreground: '#dbeefb',
  ground: '#02040a',
  muted: '#9fb6c9',
};

function mount(overrides: Partial<Parameters<typeof CorridorMap>[0]> = {}) {
  const onSelect = vi.fn();
  const props = {
    route: LUCKNOW_CORRIDOR,
    frame: FRAME,
    arm: 'controlled' as const,
    followedId: null,
    onSelect,
    ...overrides,
  };
  const view = render(createElement(CorridorMap, props));
  return { ...view, onSelect, props };
}

const tacticalCanvas = () => screen.queryByRole('img', { name: /buses on Route 41/ });

/* ── the pure pieces ──────────────────────────────────────────────────────── */

describe('tokenColour', () => {
  it('wraps an HSL triplet, passes a literal through, and falls back when the token is empty', () => {
    const values: Record<string, string> = {
      '--instrument-warning': ' 39 100% 56% ',
      '--sim-controlled': '#3ab3c9',
      '--background': '',
    };
    const spy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) => values[name] ?? '',
    } as unknown as CSSStyleDeclaration);
    const el = document.createElement('div');
    expect(tokenColour(el, '--instrument-warning', '#ffb020')).toBe('hsl(39 100% 56%)');
    expect(tokenColour(el, '--sim-controlled', '#000')).toBe('#3ab3c9');
    expect(tokenColour(el, '--background', '#02040a')).toBe('#02040a');
    expect(tokenColour(el, '--never-defined', '#123456')).toBe('#123456');
    spy.mockRestore();
  });
});

describe('the frame as marks and overlays', () => {
  it('encodes the detector verdict in the quality: red and ringed in a raised pair, green otherwise', () => {
    // Both buses are the ends of the one warning pair, so both are raised.
    const marks = replayMarks(FRAME);
    expect(marks.map((mark) => [mark.id, mark.dataQuality])).toEqual([
      ['bus-1', 'degraded'],
      ['bus-2', 'degraded'],
    ]);
    const held = marks.find((mark) => mark.id === 'bus-2');
    expect(held?.latitude).toBeCloseTo(FRAME.vehicles[1]?.position.latitude ?? Number.NaN);
    expect(held?.headingDegrees).toBe(FRAME.vehicles[1]?.position.headingDegrees);

    // With the pair fine both are green: the hold on bus-2 does not move its
    // mark, because the hold is carried by its overlay ring and label.
    expect(FRAME.vehicles[1]?.holding).toBe(true);
    const quiet = {
      ...FRAME,
      pairs: FRAME.pairs.map((pair) => ({ ...pair, state: 'ok' as const })),
    };
    expect(replayMarks(quiet).map((mark) => mark.dataQuality)).toEqual(['good', 'good']);
  });

  it('draws only the pairs that are not fine, every hold, and the followed bus', () => {
    expect(FRAME.pairs).toHaveLength(1);
    expect(FRAME.pairs[0]?.state).toBe('warning');
    const overlays = replayOverlays(FRAME, 'bus-1', INK);
    expect(overlays.map((group) => group.id)).toEqual(['pairs', 'holds', 'followed']);

    const pair = overlays[0]?.marks[0];
    expect(pair?.points).toHaveLength(2);
    expect(pair?.colour).toBe(INK.warning);
    expect(pair?.dashed).toBe(true);
    expect(pair?.radiusPx).toBe(7);

    const hold = overlays[1]?.marks[0];
    expect(hold?.id).toBe('hold:bus-2');
    expect(hold?.label).toBe('HOLD');
    expect(hold?.colour).toBe(INK.warning);
    expect(hold?.radiusPx).toBe(14);

    const followed = overlays[2]?.marks[0];
    expect(followed?.label).toBe('bus-1');
    expect(followed?.colour).toBe(INK.foreground);
    expect(followed?.radiusPx).toBe(18);
  });

  it('colours a bunched pair in the danger ink and hands the layer nothing for a quiet frame', () => {
    const bunched = {
      ...FRAME,
      pairs: FRAME.pairs.map((pair) => ({ ...pair, state: 'bunched' as const })),
      holds: [],
    };
    const overlays = replayOverlays(bunched, null, INK);
    expect(overlays).toHaveLength(1);
    expect(overlays[0]?.marks[0]?.colour).toBe(INK.danger);
    expect(replayOverlays(emptyFrame(0), 'bus-9', INK)).toEqual([]);
    // A followed bus that is not on the road gets no ring.
    expect(replayOverlays({ ...FRAME, pairs: [], holds: [] }, 'bus-9', INK)).toEqual([]);
  });

  it('builds the palette as the detector verdict, green and red, with the ground as casing', () => {
    expect(paletteFor(INK)).toEqual({
      quality: { good: INK.success, degraded: INK.danger, stale: INK.danger },
      selected: INK.foreground,
      casing: INK.ground,
    });
  });

  it('names every station on a short route, every second on a medium one, every fourth on a long one', () => {
    expect(labelEveryStop(10)).toBe(1);
    expect(labelEveryStop(12)).toBe(1);
    expect(labelEveryStop(15)).toBe(2);
    expect(labelEveryStop(16)).toBe(2);
    expect(labelEveryStop(25)).toBe(4);
  });
});

/* ── the component ────────────────────────────────────────────────────────── */

describe('CorridorMap', () => {
  const previousGetContext = HTMLCanvasElement.prototype.getContext;
  const previousMatchMedia = window.matchMedia;

  beforeAll(() => {
    // The tactical canvas needs a 2D context, a media query and a
    // ResizeObserver that jsdom does not provide. Every context method is a
    // no-op, so a draw runs end to end and we only learn whether it throws.
    const noop = () => undefined;
    const state: Record<string | symbol, unknown> = {};
    const proxy = new Proxy(state, {
      get(target, prop) {
        if (prop in target) return target[prop];
        return noop;
      },
    });
    HTMLCanvasElement.prototype.getContext = function getContext() {
      return proxy as unknown as CanvasRenderingContext2D;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    class NoopResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', NoopResizeObserver);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  beforeEach(() => {
    loader.configured = false;
    loader.importLibrary.mockReset();
    loader.authListeners.clear();
    FakeMap.constructed = [];
    FakePolyline.constructed = [];
    FakeMarker.constructed = [];
  });

  afterEach(() => {
    harness?.restore();
    harness = null;
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = previousGetContext;
    window.matchMedia = previousMatchMedia;
    vi.unstubAllGlobals();
  });

  it('falls back to the tactical plot at once when no key is configured, without asking the loader', () => {
    mount();
    expect(tacticalCanvas()).toBeInTheDocument();
    expect(loader.importLibrary).not.toHaveBeenCalled();
    expect(screen.queryByText('Loading the map')).toBeNull();
    expect(screen.queryByRole('application')).toBeNull();
  });

  it('builds the basemap once, draws the corridor, fits the route and paints the frame', async () => {
    const installed = installMaps();
    const fitBounds = vi.spyOn(installed.map, 'fitBounds');
    loader.configured = true;
    loader.importLibrary.mockResolvedValue({ Map: FakeMap });

    const { rerender, props, unmount } = mount();
    // Loading: the container is there, the plot is not, and the fallback panel says so.
    expect(screen.getByText('Loading the map')).toBeInTheDocument();
    expect(tacticalCanvas()).toBeNull();
    expect(loader.importLibrary).toHaveBeenCalledWith('maps');

    await waitFor(() => expect(screen.getByText('Under control')).toBeInTheDocument());
    expect(screen.queryByText('Loading the map')).toBeNull();
    expect(tacticalCanvas()).toBeNull();
    expect(screen.getByText('Alambagh Bus Station → Chinhat Terminal')).toBeInTheDocument();
    expect(
      screen.getByRole('application', { name: /Under control: 2 buses on Route 41/ }),
    ).toBeInTheDocument();

    // The map, once, on the route's centre in the dark theme with no chrome.
    expect(FakeMap.constructed).toHaveLength(1);
    const options = FakeMap.constructed[0]?.options;
    expect(options?.center).toEqual({
      lat: LUCKNOW_CORRIDOR.centre.latitude,
      lng: LUCKNOW_CORRIDOR.centre.longitude,
    });
    expect(options?.zoom).toBe(LUCKNOW_CORRIDOR.zoom);
    expect(options?.backgroundColor).toBe('#02040a');
    expect(options?.styles).toBeDefined();
    expect(options?.disableDefaultUI).toBe(true);
    expect(options?.gestureHandling).toBe('greedy');
    expect(options?.clickableIcons).toBe(false);
    expect(options?.keyboardShortcuts).toBe(false);

    // The corridor: an underlay and a line through every stop, in the arm ink.
    expect(FakePolyline.constructed).toHaveLength(2);
    const [underlay, line] = FakePolyline.constructed;
    expect(underlay?.options.strokeWeight).toBe(9);
    expect(underlay?.options.strokeOpacity).toBeCloseTo(0.18);
    expect(line?.options.strokeWeight).toBe(2);
    for (const polyline of FakePolyline.constructed) {
      expect(polyline.options.strokeColor).toBe('#3ab3c9');
      expect(polyline.options.path).toHaveLength(LUCKNOW_CORRIDOR.stops.length);
      expect(polyline.map).toBe(installed.map);
    }

    // A station at every stop; the first, the last and every fourth named.
    expect(FakeMarker.constructed).toHaveLength(25);
    const named = FakeMarker.constructed.filter((marker) => marker.options.label !== undefined);
    expect(named).toHaveLength(7);
    const names = named.map((marker) => (marker.options.label as google.maps.MarkerLabel).text);
    expect(names[0]).toBe('Alambagh Bus Station');
    expect(names[names.length - 1]).toBe('Chinhat Terminal');
    const icon = FakeMarker.constructed[0]?.options.icon as google.maps.Symbol;
    expect(icon.scale).toBe(3.5);
    expect(icon.fillColor).toBe('#02040a');
    expect(icon.strokeColor).toBe('#3ab3c9');
    const label = named[0]?.options.label as google.maps.MarkerLabel;
    expect(label.fontSize).toBe('11px');
    expect(label.color).toBe('#9fb6c9');

    // The camera on the route, with room around it.
    expect(fitBounds).toHaveBeenCalledTimes(1);
    const [bounds, padding] = fitBounds.mock.calls[0] as unknown as [FakeLatLngBounds, unknown];
    expect(bounds.southWest).toEqual({
      lat: LUCKNOW_CORRIDOR.bounds.south,
      lng: LUCKNOW_CORRIDOR.bounds.west,
    });
    expect(bounds.northEast).toEqual({
      lat: LUCKNOW_CORRIDOR.bounds.north,
      lng: LUCKNOW_CORRIDOR.bounds.east,
    });
    expect(padding).toEqual({ top: 48, right: 48, bottom: 48, left: 48 });

    // What the layer painted: both buses are the ends of the one warning
    // pair, so both chevrons are filled red - never the arm ink, which is the
    // corridor's - with a dashed warning link over the pair and a HOLD label
    // at the station.
    expect(installed.flushFrames()).toBeGreaterThan(0);
    const painted = installed.context();
    const fillColours = painted.fills.map((fill) => fill.colour);
    expect(fillColours).toContain('#ff4d5e');
    expect(fillColours).not.toContain('#2bff88');
    expect(fillColours).not.toContain('#3ab3c9');
    expect(
      painted.strokes.some((stroke) => stroke.colour === '#ffb020' && stroke.dash.length > 0),
    ).toBe(true);
    expect(painted.texts.map((text) => text.text)).toContain('HOLD');

    // A new route replaces the corridor and re-fits; the map is not rebuilt.
    rerender(createElement(CorridorMap, { ...props, route: SUBURBAN_CORRIDOR }));
    expect(FakeMap.constructed).toHaveLength(1);
    expect(underlay?.map).toBeNull();
    expect(line?.map).toBeNull();
    expect(FakePolyline.constructed).toHaveLength(4);
    expect(FakePolyline.constructed[3]?.options.path).toHaveLength(SUBURBAN_CORRIDOR.stops.length);
    expect(FakeMarker.constructed.filter((marker) => marker.map !== null)).toHaveLength(15);
    expect(fitBounds).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Alambagh Bus Station → Unnao Bus Station')).toBeInTheDocument();

    // A new arm recolours the corridor without moving the camera.
    rerender(
      createElement(CorridorMap, { ...props, route: SUBURBAN_CORRIDOR, arm: 'uncontrolled' }),
    );
    expect(screen.getByText('Left alone')).toBeInTheDocument();
    const live = FakePolyline.constructed.filter((polyline) => polyline.map !== null);
    expect(live).toHaveLength(2);
    for (const polyline of live) expect(polyline.options.strokeColor).toBe('#7e93a6');
    expect(fitBounds).toHaveBeenCalledTimes(2);

    // Unmount lets go of everything on the map.
    unmount();
    for (const polyline of FakePolyline.constructed) expect(polyline.map).toBeNull();
    for (const marker of FakeMarker.constructed) expect(marker.map).toBeNull();
  });

  it('selects a bus through the layer with its id', async () => {
    const installed = installMaps();
    loader.configured = true;
    loader.importLibrary.mockResolvedValue({ Map: FakeMap });
    const { onSelect } = mount({ followedId: 'bus-2' });
    await waitFor(() => expect(screen.getByText('Under control')).toBeInTheDocument());
    installed.flushFrames();
    // The followed bus is drawn on its own in the foreground ink, ringed and named.
    const painted = installed.context();
    expect(painted.fills.some((fill) => fill.colour === '#dbeefb')).toBe(true);
    expect(painted.texts.map((text) => text.text)).toContain('bus-2');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('falls back to the plot when the SDK cannot be loaded', async () => {
    installMaps();
    loader.configured = true;
    loader.importLibrary.mockRejectedValue(new Error('offline'));
    mount();
    expect(screen.getByText('Loading the map')).toBeInTheDocument();
    await waitFor(() => expect(tacticalCanvas()).toBeInTheDocument());
    expect(FakeMap.constructed).toHaveLength(0);
    expect(screen.queryByText('Loading the map')).toBeNull();
  });

  it('falls back to the plot, disposing what was built, when Google refuses the key after the map is up', async () => {
    installMaps();
    loader.configured = true;
    loader.importLibrary.mockResolvedValue({ Map: FakeMap });
    mount();
    await waitFor(() => expect(screen.getByText('Under control')).toBeInTheDocument());
    expect(FakePolyline.constructed.every((polyline) => polyline.map !== null)).toBe(true);

    failAuth();

    expect(tacticalCanvas()).toBeInTheDocument();
    expect(screen.queryByRole('application')).toBeNull();
    for (const polyline of FakePolyline.constructed) expect(polyline.map).toBeNull();
    for (const marker of FakeMarker.constructed) expect(marker.map).toBeNull();
  });

  it('never builds over the fallback when the refusal arrives before the SDK does', async () => {
    installMaps();
    loader.configured = true;
    let resolveImport: (value: unknown) => void = () => undefined;
    loader.importLibrary.mockReturnValue(
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );
    mount();
    expect(screen.getByText('Loading the map')).toBeInTheDocument();
    failAuth();
    expect(tacticalCanvas()).toBeInTheDocument();
    await act(async () => {
      resolveImport({ Map: FakeMap });
      await Promise.resolve();
    });
    expect(FakeMap.constructed).toHaveLength(0);
    expect(FakePolyline.constructed).toHaveLength(0);
    expect(tacticalCanvas()).toBeInTheDocument();
  });
});
