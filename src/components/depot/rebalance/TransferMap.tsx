'use client';

import { useEffect, useRef, useState } from 'react';
import { MapFallback } from '@/components/map/MapFallback';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, MAP_DARK_STYLE } from '@/lib/constants';
import type {
  BalanceClass,
  MapArc,
  MapGeometry,
  MapNode,
} from '@/lib/depot/rebalance/rebalanceModel';
import { onMapsAuthFailure } from '@/lib/maps/authFailure';
import { removeMapListeners } from '@/lib/maps/listeners';
import { getMapsLoader, isMapsConfigured } from '@/lib/maps/loader';
import { describeBalance, BALANCED_COLOUR, DEFICIT_COLOUR, SURPLUS_COLOUR } from './BalanceBar';
import { ARC_COLOUR } from './TransferMapLegend';

type Status = 'loading' | 'ready' | 'error';
type Handle = google.maps.MapsEventListener | undefined;
interface Overlay<T> {
  readonly item: T;
  readonly listeners: Handle[];
}

const LOAD_TIMEOUT_MS = 15_000;
const SELECTED = '#3ff0ff';
const FIT_PADDING_PX = 40;
const STILL_AVAILABLE = 'Every transfer and depot on this map is also in the tables below.';
const SHAPE: Readonly<Record<BalanceClass, { path: string; scale: number; fill: string }>> = {
  surplus: { path: 'M -1 -1 L 1 -1 L 1 1 L -1 1 Z', scale: 6, fill: SURPLUS_COLOUR },
  deficit: { path: 'M -1.2 -1 L 1.2 -1 L 0 1.2 Z', scale: 7, fill: DEFICIT_COLOUR },
  balanced: { path: 'M -1 0 A 1 1 0 1 0 1 0 A 1 1 0 1 0 -1 0 Z', scale: 4, fill: BALANCED_COLOUR },
};

function nodeIcon(cls: BalanceClass, selected: boolean): google.maps.Symbol {
  const s = SHAPE[cls];
  return {
    path: s.path,
    scale: s.scale,
    fillColor: s.fill,
    fillOpacity: 1,
    strokeColor: selected ? SELECTED : '#02040a',
    strokeWeight: selected ? 2.5 : 1,
  };
}

function arcOptions(arc: MapArc, selected: boolean): google.maps.PolylineOptions {
  const colour = selected ? SELECTED : ARC_COLOUR;
  return {
    path: [arc.from, arc.to],
    geodesic: true,
    strokeColor: colour,
    strokeOpacity: selected ? 1 : 0.8,
    strokeWeight: arc.widthPx,
    zIndex: selected ? 50 : 10,
    icons: [
      {
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 3,
          fillOpacity: 1,
          strokeColor: colour,
        },
        offset: '100%',
      },
    ],
  };
}

export interface TransferMapProps {
  readonly geometry: MapGeometry;
  readonly selectedId: string | null;
  readonly onSelect: (transferId: string | null) => void;
}

/**
 * The page's hero: depots as shapes (square spare, triangle short, circle
 * balanced) and each recommended transfer as a geodesic line with an arrow at
 * the receiver. Framed once; later data updates overlays in place by id.
 */
export function TransferMap({ geometry, selectedId, onSelect }: TransferMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const nodesRef = useRef(new Map<string, Overlay<google.maps.Marker>>());
  const arcsRef = useRef(new Map<string, Overlay<google.maps.Polyline>>());
  const fittedRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    if (!isMapsConfigured()) {
      setStatus('error');
      setMessage(`The basemap is not configured for this environment. ${STILL_AVAILABLE}`);
      return;
    }
    // `settled` ends the load race; `unmounted` alone silences everything.
    let settled = false;
    let unmounted = false;
    const showError = (text: string): void => {
      if (unmounted) return;
      settled = true;
      setStatus('error');
      setMessage(`${text} ${STILL_AVAILABLE}`);
    };
    const fail = (text: string): void => {
      if (!settled) showError(text);
    };
    const timer = setTimeout(() => fail('The basemap took too long to load.'), LOAD_TIMEOUT_MS);
    // A refusal can arrive after the map is drawn (Maps then disables it), so it always wins.
    const unsubscribe = onMapsAuthFailure(() =>
      showError('The basemap refused this request for this domain.'),
    );
    getMapsLoader()
      .importLibrary('maps')
      .then(({ Map }) => {
        if (settled || !containerRef.current) return;
        settled = true;
        clearTimeout(timer);
        mapRef.current = new Map(containerRef.current, {
          center: DEFAULT_MAP_CENTER,
          zoom: DEFAULT_MAP_ZOOM,
          styles: MAP_DARK_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'cooperative',
          backgroundColor: '#02040a',
          clickableIcons: false,
        });
        setStatus('ready');
      })
      .catch(() => fail('The basemap could not be loaded.'));
    const nodes = nodesRef.current;
    const arcs = arcsRef.current;
    return () => {
      settled = true;
      unmounted = true;
      clearTimeout(timer);
      unsubscribe();
      for (const o of [...nodes.values(), ...arcs.values()]) {
        removeMapListeners(o.listeners);
        o.item.setMap(null);
      }
      nodes.clear();
      arcs.clear();
      mapRef.current = null;
    };
  }, []);

  // Overlays are added, updated and removed by id, so a poll never redraws the whole map.
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;
    sync(
      nodesRef.current,
      geometry.nodes,
      (n) => n.depotId,
      (n) => {
        const marker = new google.maps.Marker({
          map,
          position: n.position,
          icon: nodeIcon(n.cls, false),
          zIndex: 100,
        });
        return [
          marker,
          [
            marker.addListener('mouseover', () => setHover(`node:${n.depotId}`)) as Handle,
            marker.addListener('mouseout', () => setHover(null)) as Handle,
          ],
        ];
      },
      (marker, n) => marker.setPosition(n.position),
    );
    sync(
      arcsRef.current,
      geometry.arcs,
      (a) => a.transferId,
      (a) => {
        const line = new google.maps.Polyline({ map, ...arcOptions(a, false) });
        return [
          line,
          [
            line.addListener('click', () => onSelectRef.current(a.transferId)) as Handle,
            line.addListener('mouseover', () => setHover(`arc:${a.transferId}`)) as Handle,
            line.addListener('mouseout', () => setHover(null)) as Handle,
          ],
        ];
      },
      () => undefined,
    );
    if (!fittedRef.current && geometry.nodes.length > 0) {
      fittedRef.current = true;
      const bounds = new google.maps.LatLngBounds();
      geometry.nodes.forEach((n) => bounds.extend(n.position));
      map.fitBounds(bounds, FIT_PADDING_PX);
    }
  }, [geometry, status]);

  // Selection and data restyle in place.
  useEffect(() => {
    const chosen = geometry.arcs.find((a) => a.transferId === selectedId);
    for (const n of geometry.nodes) {
      const on =
        chosen !== undefined &&
        (n.depotId === chosen.fromDepotId || n.depotId === chosen.toDepotId);
      nodesRef.current.get(n.depotId)?.item.setIcon(nodeIcon(n.cls, on));
      nodesRef.current.get(n.depotId)?.item.setZIndex(on ? 200 : 100);
    }
    for (const a of geometry.arcs) {
      arcsRef.current
        .get(a.transferId)
        ?.item.setOptions(arcOptions(a, a.transferId === selectedId));
    }
  }, [geometry, selectedId, status]);

  return (
    <div className="depot-map-frame" data-testid="rebalance-map">
      <div
        ref={containerRef}
        className="absolute inset-0"
        role="region"
        aria-label="Map of recommended transfers. Every transfer can also be selected in the transfer table."
      />
      {status === 'loading' ? (
        <div
          role="status"
          className="absolute inset-0 z-20 flex items-center justify-center bg-depot-surface"
        >
          <p className="depot-label">Loading the basemap</p>
        </div>
      ) : null}
      {status === 'error' ? (
        <MapFallback status="error" message={message} onRetry={() => window.location.reload()} />
      ) : null}
      {status === 'ready' && hover ? <HoverCard hover={hover} geometry={geometry} /> : null}
    </div>
  );
}

function sync<T, O extends google.maps.Marker | google.maps.Polyline>(
  overlays: Map<string, Overlay<O>>,
  items: readonly T[],
  idOf: (item: T) => string,
  create: (item: T) => [O, Handle[]],
  update: (overlay: O, item: T) => void,
): void {
  const wanted = new Set(items.map(idOf));
  for (const [id, o] of [...overlays]) {
    if (wanted.has(id)) continue;
    removeMapListeners(o.listeners);
    o.item.setMap(null);
    overlays.delete(id);
  }
  for (const item of items) {
    const existing = overlays.get(idOf(item));
    if (existing) update(existing.item, item);
    else {
      const [created, listeners] = create(item);
      overlays.set(idOf(item), { item: created, listeners });
    }
  }
}

function HoverCard({
  hover,
  geometry,
}: {
  readonly hover: string;
  readonly geometry: MapGeometry;
}) {
  const names = new Map<string, MapNode>(geometry.nodes.map((n) => [n.depotId, n]));
  const [kind, id] = [hover.slice(0, hover.indexOf(':')), hover.slice(hover.indexOf(':') + 1)];
  const node = kind === 'node' ? names.get(id) : undefined;
  const arc = kind === 'arc' ? geometry.arcs.find((a) => a.transferId === id) : undefined;
  const title = node
    ? node.depotName
    : arc
      ? `${names.get(arc.fromDepotId)?.depotName ?? arc.fromDepotId} → ${names.get(arc.toDepotId)?.depotName ?? arc.toDepotId}`
      : null;
  if (!title) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-3 top-3 z-20 rounded-[3px] border border-depot-line bg-depot-surface px-3 py-2"
    >
      <p className="text-[13px] text-depot-ink">{title}</p>
      <p className="mt-0.5 text-[11px] text-depot-muted">
        {node
          ? `${describeBalance(node.balance)} (modelled)`
          : `${arc?.buses ?? 0} buses recommended`}
      </p>
    </div>
  );
}
