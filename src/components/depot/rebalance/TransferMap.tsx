'use client';

import { useEffect, useRef, useState } from 'react';
import { MapUnavailable } from '@/components/depot/shell/MapUnavailable';
import type { MapGeometry } from '@/lib/depot/rebalance/mapGeometry';
import { busesWord } from '@/lib/depot/rebalance/rebalanceModel';
import { MapHoverCard } from './MapHoverCard';
import { arcOptions, nodeIcon, sync, type Handle } from './transferMapOverlays';
import { useTransferMap } from './useTransferMap';

const FIT_PADDING_PX = 40;

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
  const { containerRef, mapRef, nodesRef, arcsRef, status, message } = useTransferMap();
  const fittedRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  const [hover, setHover] = useState<string | null>(null);
  const names = new Map(geometry.nodes.map((n) => [n.depotId, n.depotName]));
  const chosenArc = geometry.arcs.find((a) => a.transferId === selectedId);

  useEffect(() => {
    onSelectRef.current = onSelect;
  });

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
  }, [geometry, status, mapRef, nodesRef, arcsRef]);

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
  }, [geometry, selectedId, status, nodesRef, arcsRef]);

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
        <MapUnavailable message={message || undefined} onRetry={() => window.location.reload()} />
      ) : null}
      {status === 'ready' && hover ? <MapHoverCard hover={hover} geometry={geometry} /> : null}
      {status === 'ready' && chosenArc ? (
        <p className="absolute bottom-3 left-3 z-20 max-w-[calc(100%-24px)] truncate rounded-[3px] border border-depot-line bg-depot-surface px-3 py-1.5 text-[11px] text-depot-ink">
          Selected: {busesWord(chosenArc.buses)},{' '}
          {names.get(chosenArc.fromDepotId) ?? chosenArc.fromDepotId} →{' '}
          {names.get(chosenArc.toDepotId) ?? chosenArc.toDepotId} · modelled
        </p>
      ) : null}
    </div>
  );
}
