'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, MAP_DARK_STYLE } from '@/lib/constants';
import { onMapsAuthFailure } from '@/lib/maps/authFailure';
import { removeMapListeners } from '@/lib/maps/listeners';
import { getMapsLoader, isMapsConfigured } from '@/lib/maps/loader';
import type { Overlay } from './transferMapOverlays';

export type Status = 'loading' | 'ready' | 'error';
const LOAD_TIMEOUT_MS = 15_000;
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
 * Loads the basemap once with the house pattern: shared loader, a timeout,
 * the auth-failure hook, and full cleanup of overlays and listeners on unmount.
 */
export function useTransferMap(): TransferMapHandle {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const nodesRef = useRef(new Map<string, Overlay<google.maps.Marker>>());
  const arcsRef = useRef(new Map<string, Overlay<google.maps.Polyline>>());
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');

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
      .then(async ({ Map }) => {
        // Markers live in the marker library, as in the network map.
        await getMapsLoader().importLibrary('marker');
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

  return { containerRef, mapRef, nodesRef, arcsRef, status, message };
}
