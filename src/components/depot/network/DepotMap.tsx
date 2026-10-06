'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapFallback } from '@/components/map/MapFallback';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, MAP_DARK_STYLE } from '@/lib/constants';
import { formatCount } from '@/lib/depot/format';
import { nodeStyle, type NodeStyle } from '@/lib/depot/map/nodeStyle';
import { formatIndex, rankedIndex, type DepotRow } from '@/lib/depot/network/overviewModel';
import { onMapsAuthFailure } from '@/lib/maps/authFailure';
import { getMapsLoader, isMapsConfigured } from '@/lib/maps/loader';

type Status = 'loading' | 'ready' | 'error';
/** `addListener` returns nothing once Maps has rejected the key, despite its type. */
type Handle = google.maps.MapsEventListener | undefined;

interface Node {
  readonly row: DepotRow;
  readonly style: NodeStyle;
  readonly marker: google.maps.Marker;
}

const SELECTED_STROKE = '#3ff0ff';
const SELECTED_STROKE_WEIGHT = 2.5;
const SELECTED_Z = 5000;
const FIT_PADDING_PX = 32;
const SINGLE_NODE_ZOOM = 9;
const STILL_AVAILABLE =
  'Every depot figure on this page is still available in the ranked lists and the table below.';

function iconFor(style: NodeStyle, selected: boolean): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: style.radius,
    fillColor: style.fill,
    fillOpacity: style.fillOpacity,
    strokeColor: selected ? SELECTED_STROKE : style.stroke,
    strokeWeight: selected ? SELECTED_STROKE_WEIGHT : style.strokeWeight,
  };
}

/** Small depots draw above large ones so a big node never hides a neighbour. */
function zIndexFor(style: NodeStyle, selected: boolean): number {
  return selected ? SELECTED_Z : Math.round(1000 - style.radius * 10);
}

export interface DepotMapProps {
  readonly rows: readonly DepotRow[];
  readonly selectedId: string | null;
  readonly onSelect: (depotId: string) => void;
}

/**
 * One circle per depot at the median position of its buses: size from fleet,
 * colour from the efficiency index. Plain `google.maps.Marker` symbols, as in
 * the bunching map, so no map id is needed. The camera is framed once; polls
 * redraw the circles without moving it.
 */
export function DepotMap({ rows, selectedId, onSelect }: DepotMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const nodesRef = useRef<readonly Node[]>([]);
  const fittedRef = useRef(false);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Listeners read the latest selection and callback without being re-registered.
  useEffect(() => {
    selectedRef.current = selectedId;
    onSelectRef.current = onSelect;
  });

  // ---- One-time bootstrap ---------------------------------------------------
  useEffect(() => {
    if (!isMapsConfigured()) {
      setStatus('error');
      setErrorMessage(`The basemap is not configured for this environment. ${STILL_AVAILABLE}`);
      return;
    }
    let cancelled = false;
    let refused = false;
    const unsubscribe = onMapsAuthFailure(() => {
      refused = true;
      if (cancelled) return;
      setStatus('error');
      setErrorMessage(`The basemap refused this request for this domain. ${STILL_AVAILABLE}`);
    });

    getMapsLoader()
      .importLibrary('maps')
      .then(async ({ Map }) => {
        await getMapsLoader().importLibrary('marker');
        // A refusal can arrive before the library resolves; it must win.
        if (cancelled || refused || !containerRef.current) return;
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
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(`The basemap could not be loaded. ${STILL_AVAILABLE}`);
      });

    return () => {
      cancelled = true;
      unsubscribe();
      mapRef.current = null;
    };
  }, []);

  // ---- Nodes: rebuilt when the data changes ----------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;

    const positioned = rows.filter((row) => row.depot.centroid !== null);
    const maxFleet = positioned.reduce((max, row) => Math.max(max, row.depot.fleet), 0);
    const handles: Handle[] = [];
    const nodes: Node[] = positioned.map((row) => {
      const style = nodeStyle(
        { fleet: row.depot.fleet, index: rankedIndex(row), ranked: rankedIndex(row) !== null },
        maxFleet,
      );
      const selected = row.depot.id === selectedRef.current;
      const marker = new google.maps.Marker({
        map,
        position: row.depot.centroid ?? DEFAULT_MAP_CENTER,
        icon: iconFor(style, selected),
        zIndex: zIndexFor(style, selected),
        cursor: 'pointer',
      });
      const id = row.depot.id;
      handles.push(
        marker.addListener('click', () => onSelectRef.current(id)) as Handle,
        marker.addListener('mouseover', () => setHoveredId(id)) as Handle,
        marker.addListener('mouseout', () => setHoveredId(null)) as Handle,
      );
      return { row, style, marker };
    });
    nodesRef.current = nodes;

    if (!fittedRef.current && positioned.length > 0) {
      fittedRef.current = true;
      const bounds = new google.maps.LatLngBounds();
      positioned.forEach((row) => {
        if (row.depot.centroid) bounds.extend(row.depot.centroid);
      });
      if (positioned.length === 1) {
        map.setCenter(bounds.getCenter());
        map.setZoom(SINGLE_NODE_ZOOM);
      } else {
        map.fitBounds(bounds, FIT_PADDING_PX);
      }
    }

    return () => {
      handles.forEach((handle) => handle?.remove());
      nodes.forEach((node) => node.marker.setMap(null));
      nodesRef.current = [];
      setHoveredId(null);
    };
  }, [rows, status]);

  // ---- Selection: restyle in place, never rebuild ---------------------------
  useEffect(() => {
    nodesRef.current.forEach((node) => {
      const selected = node.row.depot.id === selectedId;
      node.marker.setIcon(iconFor(node.style, selected));
      node.marker.setZIndex(zIndexFor(node.style, selected));
    });
  }, [selectedId, rows, status]);

  const hovered = useMemo(
    () => rows.find((row) => row.depot.id === hoveredId) ?? null,
    [rows, hoveredId],
  );

  return (
    <div className="depot-map-frame" data-testid="depot-map">
      <div
        ref={containerRef}
        className="absolute inset-0"
        role="region"
        aria-label="Map of depots. Every depot can also be selected from the ranked lists and the table."
      />
      {status === 'loading' ? (
        // Quiet static placeholder: MapFallback's loading face pulses, and nothing here loops.
        <div
          role="status"
          className="absolute inset-0 z-20 flex items-center justify-center bg-depot-surface"
        >
          <p className="depot-label">Loading the basemap</p>
        </div>
      ) : null}
      {status === 'error' ? (
        <MapFallback
          status="error"
          message={errorMessage}
          onRetry={() => window.location.reload()}
        />
      ) : null}
      {status === 'ready' && hovered ? (
        <div
          aria-hidden
          data-testid="depot-map-hover"
          className="pointer-events-none absolute left-3 top-3 z-20 rounded-[3px] border border-depot-line bg-depot-surface px-3 py-2"
        >
          <p className="text-[13px] text-depot-ink">{hovered.depot.name}</p>
          <p className="mt-0.5 text-[11px] text-depot-muted">
            Fleet {formatCount(hovered.depot.fleet)} · Index {formatIndex(rankedIndex(hovered))}
          </p>
        </div>
      ) : null}
    </div>
  );
}
