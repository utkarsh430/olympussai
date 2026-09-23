'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createFleetLayer,
  type FleetLayerHandle,
  type FleetLayerPalette,
} from '@/components/map/fleetCanvasLayer';
import { MapFallback } from '@/components/map/MapFallback';
import { MAP_THEME } from '@/lib/constants';
import type { FleetMapOverlay, FleetMapOverlayMark } from '@/lib/maps/contract';
import { getMapsLoader, isMapsConfigured, onMapsAuthFailure } from '@/lib/maps/loader';
import type { CorridorRoute } from '@/lib/showcase/corridor';
import type { ReplayArm, ReplayFrame } from '@/lib/showcase/replayFrame';
import { cn } from '@/lib/utils';
import type { DataQuality } from '@/models/canonical';
import { ARM_LABEL, TacticalMap, type TacticalMapProps } from './TacticalMap';

/**
 * The live trial on a real basemap, with the tactical plot as its fallback.
 *
 * Same props as `TacticalMap`, and the same picture: the corridor as one
 * ink, a station at every stop, a chevron per bus, a dashed link over a
 * pair that is not fine, a ring and a HOLD label where a bus is being held,
 * and the arm named in text in the corner. The difference is what it sits
 * on. Here the corridor is drawn on Google's dark basemap so a viewer can
 * see the streets the route follows, and the buses are painted by the same
 * canvas layer the operations consoles use (`fleetCanvasLayer.ts`), so the
 * chevron a boardroom sees is the chevron a control room sees.
 *
 * The plot is the FALLBACK, never a second renderer: whenever the basemap
 * cannot be had - no key configured, the SDK failing to load, the Map
 * constructor throwing, or Google refusing the key for this origin after
 * the map has been built (`RefererNotAllowedMapError`, which leaves the
 * container white and the app none the wiser) - whatever was built is
 * disposed and `TacticalMap` takes over with the identical props. Nothing
 * upstream has to know which one is showing.
 *
 * The map is built ONCE per mount. A change of route replaces the polylines
 * and the station markers and re-fits the camera; a change of arm recolours
 * them without moving it; a new frame only hands the layer new marks.
 */
export type CorridorMapProps = TacticalMapProps;

type MapStatus = 'loading' | 'ready' | 'fallback';

/** A bus as the fleet layer draws it. Quality carries the state, so the SHAPE does too. */
export interface ReplayMark {
  id: string;
  latitude: number;
  longitude: number;
  headingDegrees: number;
  /** `degraded` (ringed, amber) while holding; `good` (filled, the arm ink) otherwise. */
  dataQuality: DataQuality;
}

/** The colours this renderer needs, resolved once at build time. */
export interface Ink {
  controlled: string;
  baseline: string;
  warning: string;
  danger: string;
  foreground: string;
  ground: string;
  muted: string;
}

/**
 * The documented value of every token read here, in the dark theme this
 * surface always runs in (`showcase.css` for `--sim-controlled`,
 * `globals.css` `.dark` for the rest). Used only when a token resolves to
 * nothing - a container with no themed ancestor, or a test DOM.
 */
const TOKEN_FALLBACK = {
  '--sim-controlled': '#3ab3c9',
  '--sim-baseline': '#7e93a6',
  '--instrument-warning': '#ffb020',
  '--instrument-danger': '#ff4d5e',
  '--foreground': '#dbeefb',
  '--background': '#02040a',
  '--muted-foreground': '#9fb6c9',
} as const;

/** Room the camera fit keeps around the corridor, in CSS pixels, on every side. */
const FIT_PADDING_PX = 48;

/** Ring radii for the annotations, in CSS pixels: a pair's ends, a hold, the followed bus. */
const PAIR_RING_PX = 7;
const HOLD_RING_PX = 14;
const FOLLOW_RING_PX = 18;

/** Station labels sit this far above or below the dot, in the symbol's own units (scaled by `scale`). */
const LABEL_OFFSET_UNITS = 4;
const STATION_SCALE = 3.5;

const NO_OVERLAYS: readonly FleetMapOverlay[] = [];

const noop = () => undefined;

/**
 * One design token as a colour string.
 *
 * This is the one place resolved colour strings are unavoidable: the Maps
 * API takes hex for a polyline and a symbol, and the canvas layer takes a
 * colour string for a fill, and neither can read a CSS custom property. So
 * the tokens are read off the container's computed style ONCE, when the
 * map is built. `--instrument-*` and the page tokens are HSL triplets
 * (`39 100% 56%`) and are wrapped; `--sim-*` are literal colours and pass
 * through; a token that resolves to nothing takes the documented value.
 */
export function tokenColour(el: Element, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  if (!value) return fallback;
  return /^\d/.test(value) ? `hsl(${value})` : value;
}

function resolveInk(el: Element): Ink {
  const read = (name: keyof typeof TOKEN_FALLBACK) => tokenColour(el, name, TOKEN_FALLBACK[name]);
  return {
    controlled: read('--sim-controlled'),
    baseline: read('--sim-baseline'),
    warning: read('--instrument-warning'),
    danger: read('--instrument-danger'),
    foreground: read('--foreground'),
    ground: read('--background'),
    muted: read('--muted-foreground'),
  };
}

/** The ink the arm draws in: the corridor line, the station rings and every bus that is not holding. */
export function armInk(arm: ReplayArm, ink: Ink): string {
  return arm === 'controlled' ? ink.controlled : ink.baseline;
}

/** The fleet layer's palette for one arm. Casing in the ground colour, so a chevron survives over the corridor line. */
export function paletteFor(arm: ReplayArm, ink: Ink): FleetLayerPalette {
  return {
    quality: { good: armInk(arm, ink), degraded: ink.warning, stale: ink.danger },
    selected: ink.foreground,
    casing: ink.ground,
  };
}

/** Every bus on the road as a mark. A holding bus is `degraded`, which the layer draws ringed. */
export function replayMarks(frame: ReplayFrame): ReplayMark[] {
  return frame.vehicles.map((vehicle) => ({
    id: vehicle.id,
    latitude: vehicle.position.latitude,
    longitude: vehicle.position.longitude,
    headingDegrees: vehicle.position.headingDegrees,
    dataQuality: vehicle.holding ? 'degraded' : 'good',
  }));
}

/**
 * The frame's annotations: a dashed link over every pair that is not fine,
 * a ring and a HOLD label at every hold, and a ring with its id around the
 * followed bus. Groups that would be empty are left out, so a quiet frame
 * hands the layer nothing to draw.
 */
export function replayOverlays(
  frame: ReplayFrame,
  followedId: string | null,
  ink: Ink,
): FleetMapOverlay[] {
  const overlays: FleetMapOverlay[] = [];

  const pairs: FleetMapOverlayMark[] = [];
  for (const pair of frame.pairs) {
    if (pair.state === 'ok') continue;
    pairs.push({
      id: `pair:${pair.leaderId}:${pair.followerId}`,
      points: [pair.leader, pair.follower],
      colour: pair.state === 'bunched' ? ink.danger : ink.warning,
      radiusPx: PAIR_RING_PX,
      dashed: true,
    });
  }
  if (pairs.length > 0) overlays.push({ id: 'pairs', marks: pairs });

  const holds: FleetMapOverlayMark[] = frame.holds.map((hold) => ({
    id: `hold:${hold.vehicleId}`,
    points: [hold.position],
    colour: ink.warning,
    radiusPx: HOLD_RING_PX,
    label: 'HOLD',
  }));
  if (holds.length > 0) overlays.push({ id: 'holds', marks: holds });

  const followed = followedId
    ? frame.vehicles.find((vehicle) => vehicle.id === followedId)
    : undefined;
  if (followed) {
    overlays.push({
      id: 'followed',
      marks: [
        {
          id: `follow:${followed.id}`,
          points: [followed.position],
          colour: ink.foreground,
          radiusPx: FOLLOW_RING_PX,
          label: followed.id,
        },
      ],
    });
  }

  return overlays;
}

/**
 * Which stations get a name: every one on a short route, every second on a
 * medium one, every fourth on a long one. The first and last are always
 * named. Unlike the tactical plot's rule this does not read the width: the
 * map zooms, the plot does not.
 */
export function labelEveryStop(stopCount: number): number {
  if (stopCount <= 12) return 1;
  if (stopCount <= 16) return 2;
  return 4;
}

function stationIcon(ground: string, ink: string, labelAbove: boolean): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: STATION_SCALE,
    fillColor: ground,
    fillOpacity: 1,
    strokeColor: ink,
    strokeWeight: 1.2,
    labelOrigin: new google.maps.Point(0, labelAbove ? -LABEL_OFFSET_UNITS : LABEL_OFFSET_UNITS),
  };
}

interface CorridorDrawing {
  dispose(): void;
}

/**
 * The corridor on the basemap: a wide faint underlay and a thin line through
 * every stop, then a station dot at each with a name on some of them. Names
 * alternate above and below the line, as they do on the plot, so two
 * neighbouring names do not print over each other.
 */
function drawCorridor(
  map: google.maps.Map,
  route: CorridorRoute,
  line: string,
  ink: Ink,
): CorridorDrawing {
  const path = route.stops.map((stop) => ({ lat: stop.latitude, lng: stop.longitude }));
  const underlay = new google.maps.Polyline({
    map,
    path,
    strokeColor: line,
    strokeOpacity: 0.18,
    strokeWeight: 9,
    clickable: false,
    zIndex: 1,
  });
  const trace = new google.maps.Polyline({
    map,
    path,
    strokeColor: line,
    strokeOpacity: 0.9,
    strokeWeight: 2,
    clickable: false,
    zIndex: 2,
  });

  const every = labelEveryStop(route.stops.length);
  const last = route.stops.length - 1;
  let named = 0;
  const markers = route.stops.map((stop, index) => {
    const labelled = index === 0 || index === last || index % every === 0;
    const above = named % 2 === 0;
    if (labelled) named += 1;
    return new google.maps.Marker({
      map,
      position: { lat: stop.latitude, lng: stop.longitude },
      clickable: false,
      zIndex: 3,
      icon: stationIcon(ink.ground, line, above),
      label: labelled
        ? {
            text: stop.name,
            color: ink.muted,
            fontSize: '11px',
            fontFamily: 'var(--font-mono), monospace',
          }
        : undefined,
    });
  });

  return {
    dispose() {
      underlay.setMap(null);
      trace.setMap(null);
      for (const marker of markers) marker.setMap(null);
    },
  };
}

function fitRoute(map: google.maps.Map, route: CorridorRoute): void {
  const bounds = new google.maps.LatLngBounds(
    { lat: route.bounds.south, lng: route.bounds.west },
    { lat: route.bounds.north, lng: route.bounds.east },
  );
  map.fitBounds(bounds, {
    top: FIT_PADDING_PX,
    right: FIT_PADDING_PX,
    bottom: FIT_PADDING_PX,
    left: FIT_PADDING_PX,
  });
}

export function CorridorMap(props: CorridorMapProps) {
  const { route, frame, arm, followedId, onSelect, className } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const layerRef = useRef<FleetLayerHandle<ReplayMark> | null>(null);
  /** The route the camera was last fitted to, so an arm change redraws the corridor without moving it. */
  const fittedRef = useRef<CorridorRoute | null>(null);
  /** Set once the basemap is given up on, so a late `importLibrary` cannot build over the fallback. */
  const failedRef = useRef(false);
  /** What the build reads at the moment it happens; the effects below keep the layer current afterwards. */
  const latest = useRef({ route, arm, onSelect });
  latest.current = { route, arm, onSelect };

  const [status, setStatus] = useState<MapStatus>(() =>
    isMapsConfigured() ? 'loading' : 'fallback',
  );
  const [ink, setInk] = useState<Ink | null>(null);

  const fail = useCallback(() => {
    failedRef.current = true;
    layerRef.current?.destroy();
    layerRef.current = null;
    mapRef.current = null;
    setStatus('fallback');
  }, []);

  // Google reports a refused key AFTER the map is built, by painting its own
  // white panel into the container. That is a fallback, not a ready map.
  useEffect(() => onMapsAuthFailure(fail), [fail]);

  useEffect(() => {
    if (!isMapsConfigured()) return;
    let cancelled = false;

    getMapsLoader()
      .importLibrary('maps')
      .then(({ Map }) => {
        const container = containerRef.current;
        if (cancelled || failedRef.current || !container) return;
        try {
          const resolved = resolveInk(container);
          const { route: initialRoute, arm: initialArm } = latest.current;
          const map = new Map(container, {
            center: { lat: initialRoute.centre.latitude, lng: initialRoute.centre.longitude },
            zoom: initialRoute.zoom,
            ...MAP_THEME.dark,
            disableDefaultUI: true,
            gestureHandling: 'greedy',
            clickableIcons: false,
            keyboardShortcuts: false,
          });
          mapRef.current = map;
          layerRef.current = createFleetLayer<ReplayMark>(
            map,
            (mark) => latest.current.onSelect(mark.id),
            paletteFor(initialArm, resolved),
          );
          setInk(resolved);
          setStatus('ready');
        } catch {
          fail();
        }
      })
      .catch(() => {
        if (!cancelled) fail();
      });

    return () => {
      cancelled = true;
      layerRef.current?.destroy();
      layerRef.current = null;
      mapRef.current = null;
    };
  }, [fail]);

  // The corridor itself. Redrawn when the route or the arm changes; the
  // camera follows only the route. The cleanup is what disposes the previous
  // drawing, whether the cause is a new route, the fallback, or unmount.
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !ink || !map) return;
    const drawing = drawCorridor(map, route, armInk(arm, ink), ink);
    if (fittedRef.current !== route) {
      fitRoute(map, route);
      fittedRef.current = route;
    }
    return () => drawing.dispose();
  }, [route, arm, ink, status]);

  // Memoised by the frame, so a re-render that changes nothing on the road
  // hands the layer the same arrays and no redraw is scheduled for it.
  const marks = useMemo(() => replayMarks(frame), [frame]);
  const overlays = useMemo(
    () => (ink ? replayOverlays(frame, followedId, ink) : NO_OVERLAYS),
    [frame, followedId, ink],
  );
  const palette = useMemo(() => (ink ? paletteFor(arm, ink) : null), [arm, ink]);

  useEffect(() => {
    if (status === 'ready') layerRef.current?.setVehicles(marks);
  }, [marks, status]);
  useEffect(() => {
    if (status === 'ready') layerRef.current?.setSelected(followedId);
  }, [followedId, status]);
  useEffect(() => {
    if (status === 'ready') layerRef.current?.setOverlays(overlays);
  }, [overlays, status]);
  useEffect(() => {
    if (status === 'ready' && palette) layerRef.current?.setPalette(palette);
  }, [palette, status]);

  if (status === 'fallback') {
    return (
      <TacticalMap
        route={route}
        frame={frame}
        arm={arm}
        followedId={followedId}
        onSelect={onSelect}
        className={className}
      />
    );
  }

  const label = `${ARM_LABEL[arm]}: ${frame.busesLive} buses on ${route.name}, ${frame.bunchedPairs} bunched pairs, ${frame.holds.length} holds in progress`;

  return (
    <div className={cn('absolute inset-0 bg-background', className)}>
      <div ref={containerRef} role="application" aria-label={label} className="absolute inset-0" />
      {status === 'ready' ? (
        // The arm, named in text, with the route's ends beneath it - the
        // same corner the plot uses, so colour is never the only encoding
        // on this renderer either.
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-border/60 bg-background/75 px-2.5 py-1.5">
          <div className="sc-label">{ARM_LABEL[arm]}</div>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {route.origin} → {route.destination}
          </div>
        </div>
      ) : (
        <MapFallback status="loading" onRetry={noop} />
      )}
    </div>
  );
}
