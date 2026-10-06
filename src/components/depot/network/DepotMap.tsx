'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapUnavailable } from '@/components/depot/shell/MapUnavailable';
import { formatCount } from '@/lib/depot/format';
import { diffMarkers } from '@/lib/depot/map/diffMarkers';
import { nodeStyle, type NodeStyle } from '@/lib/depot/map/nodeStyle';
import {
  formatIndex,
  rankedIndex,
  unrankedReason,
  type DepotRow,
} from '@/lib/depot/network/overviewModel';
import { markerLabel } from '@/lib/depot/network/mapWords';
import { FIT_PADDING_PX, SINGLE_NODE_ZOOM, refitOnResize } from '@/lib/depot/map/overviewMapView';
import { removeMapListeners } from '@/lib/maps/listeners';
import { useDepotMap, type DepotMapStatus } from './useDepotMap';

/** One drawn depot. Not `Node`, which would shadow the DOM type. */
interface DepotMarker {
  row: DepotRow;
  style: NodeStyle;
  readonly marker: google.maps.Marker;
  readonly listeners: ReadonlyArray<google.maps.MapsEventListener | undefined>;
}

const SELECTED_STROKE = '#3ff0ff';
const SELECTED_STROKE_WEIGHT = 2.5;
const SELECTED_Z = 5000;

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

function styleFor(row: DepotRow, maxFleet: number): NodeStyle {
  const index = rankedIndex(row);
  return nodeStyle({ fleet: row.depot.fleet, index, ranked: index !== null }, maxFleet);
}

/**
 * Frames the map on the units' own bounds (a single unit is centred instead). `fitting`
 * is held until the map settles, so the zoom change the fit causes is not taken for a
 * person moving the map.
 */
function fitToUnits(
  map: google.maps.Map,
  markers: ReadonlyMap<string, DepotMarker>,
  fitting: { current: boolean },
): void {
  if (markers.size === 0) return;
  const bounds = new google.maps.LatLngBounds();
  markers.forEach((entry) => {
    if (entry.row.depot.centroid) bounds.extend(entry.row.depot.centroid);
  });
  fitting.current = true;
  google.maps.event.addListenerOnce(map, 'idle', () => {
    fitting.current = false;
  });
  if (markers.size === 1) {
    map.setCenter(bounds.getCenter());
    map.setZoom(SINGLE_NODE_ZOOM);
  } else {
    map.fitBounds(bounds, FIT_PADDING_PX);
  }
}

function paint(entry: DepotMarker, selectedId: string | null): void {
  const selected = entry.row.depot.id === selectedId;
  // The title is the marker's accessible name when it takes keyboard focus.
  entry.marker.setTitle(selected ? `${markerLabel(entry.row)}, selected` : markerLabel(entry.row));
  entry.marker.setIcon(iconFor(entry.style, selected));
  entry.marker.setZIndex(zIndexFor(entry.style, selected));
}

export interface DepotMapProps {
  readonly rows: readonly DepotRow[];
  /** Fleet of the largest positioned depot; the largest circle stands for it. */
  readonly maxFleet: number;
  readonly selectedId: string | null;
  readonly onSelect: (depotId: string) => void;
  /** Reports the basemap's state, so the page can drop what describes a missing map. */
  readonly onStatusChange?: (status: DepotMapStatus) => void;
}

/**
 * One circle per depot at the median position of its buses: size from fleet,
 * colour from the efficiency index. Plain `google.maps.Marker` symbols, so no
 * map id is needed. Polls move and restyle markers in place, keyed by depot
 * id; the camera is framed on the units' bounds, framed again when the frame changes size
 * until a person moves the map, and never moved by a poll. The zoom control sits top
 * right (`overviewMapView.ts`), so it is on the first screen at 1440 x 900.
 */
export function DepotMap({ rows, maxFleet, selectedId, onSelect, onStatusChange }: DepotMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mapRef, status } = useDepotMap(containerRef);
  const markersRef = useRef<Map<string, DepotMarker>>(new Map());
  const fittedRef = useRef(false);
  const fittingRef = useRef(false);
  const userMovedRef = useRef(false);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => onStatusChange?.(status), [status, onStatusChange]);

  // Listeners read the latest selection and callback without being re-registered.
  useEffect(() => {
    selectedRef.current = selectedId;
    onSelectRef.current = onSelect;
  });

  // ---- Nodes: add, update in place, remove -----------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;
    const markers = markersRef.current;
    const { add, update, remove } = diffMarkers([...markers.keys()], rows);
    // A poll that removes the hovered marker never fires its mouseout.
    if (remove.length > 0) {
      const gone = new Set(remove);
      setHoveredId((current) => (current !== null && gone.has(current) ? null : current));
    }

    remove.forEach((id) => {
      const entry = markers.get(id);
      if (!entry) return;
      removeMapListeners(entry.listeners);
      entry.marker.setMap(null);
      markers.delete(id);
    });
    update.forEach((row) => {
      const entry = markers.get(row.depot.id);
      if (!entry || !row.depot.centroid) return;
      entry.row = row;
      entry.style = styleFor(row, maxFleet);
      entry.marker.setPosition(row.depot.centroid);
      paint(entry, selectedRef.current);
    });
    add.forEach((row) => {
      if (!row.depot.centroid) return;
      const id = row.depot.id;
      const marker = new google.maps.Marker({
        map,
        position: row.depot.centroid,
        cursor: 'pointer',
      });
      const listeners = [
        marker.addListener('click', () => onSelectRef.current(id)),
        marker.addListener('mouseover', () => setHoveredId(id)),
        marker.addListener('mouseout', () => setHoveredId(null)),
      ] as ReadonlyArray<google.maps.MapsEventListener | undefined>;
      const entry: DepotMarker = { row, style: styleFor(row, maxFleet), marker, listeners };
      paint(entry, selectedRef.current);
      markers.set(id, entry);
    });

    if (!fittedRef.current && markers.size > 0) {
      fittedRef.current = true;
      fitToUnits(map, markers, fittingRef);
    }
  }, [rows, maxFleet, status, mapRef]);

  // ---- Framing: the frame grows with the panel beside it, so refit on resize ----
  useEffect(() => {
    const map = mapRef.current;
    const frame = containerRef.current;
    if (status !== 'ready' || !map || !frame) return;
    const moved = (): void => {
      if (!fittingRef.current) userMovedRef.current = true;
    };
    const listeners = [map.addListener('dragstart', moved), map.addListener('zoom_changed', moved)];
    if (typeof ResizeObserver === 'undefined') return () => removeMapListeners(listeners);
    const observer = new ResizeObserver(() => {
      if (refitOnResize({ fitted: fittedRef.current, userMoved: userMovedRef.current })) {
        fitToUnits(map, markersRef.current, fittingRef);
      }
    });
    observer.observe(frame);
    return () => {
      observer.disconnect();
      removeMapListeners(listeners);
    };
  }, [status, mapRef]);

  // Remove every marker and listener when the map goes away or fails.
  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      markers.forEach((entry) => {
        removeMapListeners(entry.listeners);
        entry.marker.setMap(null);
      });
      markers.clear();
    };
  }, [status]);

  // ---- Selection: restyle in place ------------------------------------------
  useEffect(() => {
    markersRef.current.forEach((entry) => paint(entry, selectedId));
  }, [selectedId]);

  const hovered = useMemo(
    () => rows.find((row) => row.depot.id === hoveredId) ?? null,
    [rows, hoveredId],
  );
  const hoveredIndex = hovered ? rankedIndex(hovered) : null;

  return (
    // Unavailable, the frame shrinks from the map's 460px to a short panel, so the
    // page does not keep a tall blank box for a picture that is not there.
    <div
      // From `xl` the frame grows with its column, so the map and the panel beside it
      // end on the same line; 460px stays the floor.
      className={`depot-map-frame ${status === 'error' ? '!h-48' : 'xl:h-auto xl:min-h-[460px] xl:flex-1'}`}
      data-testid="depot-map"
    >
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
          <div className="depot-label">Loading the basemap</div>
        </div>
      ) : null}
      {status === 'error' ? (
        // The shared loader cannot be retried in place, so Retry reloads the page.
        <MapUnavailable onRetry={() => window.location.reload()} />
      ) : null}
      {status === 'ready' && hovered ? (
        <div
          aria-hidden
          data-testid="depot-map-hover"
          className="pointer-events-none absolute left-3 top-3 z-20 max-w-[calc(100%-24px)] rounded-[3px] border border-depot-line bg-depot-surface px-3 py-2"
        >
          <div className="truncate text-[13px] text-depot-ink">{hovered.depot.name}</div>
          <div className="mt-0.5 text-[11px] text-depot-muted">
            Fleet {formatCount(hovered.depot.fleet)} ·{' '}
            {hoveredIndex === null
              ? `Not ranked: ${unrankedReason(hovered)}`
              : `Index ${formatIndex(hoveredIndex)}`}
          </div>
        </div>
      ) : null}
    </div>
  );
}
