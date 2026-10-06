'use client';

import { useCallback, useRef, type RefObject } from 'react';
import { useBaseMap, type BaseMapStatus } from '@/components/depot/shell/useBaseMap';
import { removeMapListeners } from '@/lib/maps/listeners';
import type { Overlay } from './transferMapOverlays';

export type Status = BaseMapStatus;

const STILL_AVAILABLE = 'Every transfer and depot on this map is also in the tables below.';

export interface TransferMapHandle {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly mapRef: RefObject<google.maps.Map | null>;
  readonly nodesRef: RefObject<Map<string, Overlay<google.maps.Marker>>>;
  readonly arcsRef: RefObject<Map<string, Overlay<google.maps.Polyline>>>;
  readonly status: Status;
  readonly message: string;
}

/**
 * The transfer map's basemap (the shared `useBaseMap`) and its own overlays: depot nodes
 * and transfer arcs, whose listeners and map attachments are removed on unmount.
 */
export function useTransferMap(): TransferMapHandle {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(new Map<string, Overlay<google.maps.Marker>>());
  const arcsRef = useRef(new Map<string, Overlay<google.maps.Polyline>>());

  const removeOverlays = useCallback((): void => {
    const nodes = nodesRef.current;
    const arcs = arcsRef.current;
    for (const o of [...nodes.values(), ...arcs.values()]) {
      removeMapListeners(o.listeners);
      o.item.setMap(null);
    }
    nodes.clear();
    arcs.clear();
  }, []);

  const { mapRef, status, message } = useBaseMap(containerRef, {
    stillAvailable: STILL_AVAILABLE,
    onCleanup: removeOverlays,
  });

  return { containerRef, mapRef, nodesRef, arcsRef, status, message };
}
