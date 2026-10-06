'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, MAP_DARK_STYLE } from '@/lib/constants';
import { onMapsAuthFailure } from '@/lib/maps/authFailure';
import { getMapsLoader, isMapsConfigured } from '@/lib/maps/loader';
import { zoomControlOptions } from '@/lib/depot/map/overviewMapView';

export type DepotMapStatus = 'loading' | 'ready' | 'error';

/** A stalled script request never rejects; after this long it counts as a failure. */
export const MAP_LOAD_TIMEOUT_MS = 15_000;

const STILL_AVAILABLE =
  'Every depot figure on this page is still available in the ranked lists and the table below.';
const NOT_CONFIGURED = `The basemap is not configured for this environment. ${STILL_AVAILABLE}`;
const REFUSED = `The basemap refused this request for this domain. ${STILL_AVAILABLE}`;
const NOT_LOADED = `The basemap could not be loaded. ${STILL_AVAILABLE}`;

export interface DepotMapHandle {
  readonly mapRef: RefObject<google.maps.Map | null>;
  readonly status: DepotMapStatus;
  readonly errorMessage: string;
}

/**
 * Creates the depot map once inside `containerRef`, through the shared loader.
 * Ends in `error` when Maps is unconfigured, refuses the key (even if the
 * refusal beats the library), rejects, or has not become ready in time.
 */
export function useDepotMap(containerRef: RefObject<HTMLDivElement | null>): DepotMapHandle {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [status, setStatus] = useState<DepotMapStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const fail = (message: string): void => {
      setStatus('error');
      setErrorMessage(message);
    };
    if (!isMapsConfigured()) {
      fail(NOT_CONFIGURED);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      fail(NOT_LOADED);
    }, MAP_LOAD_TIMEOUT_MS);
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const unsubscribe = onMapsAuthFailure(() => {
      // A refusal after the map is ready still replaces it with the fallback.
      settled = true;
      clearTimeout(timer);
      fail(REFUSED);
    });

    getMapsLoader()
      .importLibrary('maps')
      .then(async ({ Map }) => {
        const { ControlPosition } = (await getMapsLoader().importLibrary(
          'core',
        )) as google.maps.CoreLibrary;
        await getMapsLoader().importLibrary('marker');
        if (settled || !containerRef.current) return;
        mapRef.current = new Map(containerRef.current, {
          center: DEFAULT_MAP_CENTER,
          zoom: DEFAULT_MAP_ZOOM,
          styles: MAP_DARK_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          // Top right: the frame's bottom can fall below the fold at 1440 x 900.
          zoomControlOptions: zoomControlOptions(ControlPosition),
          // fitBounds may then stop between whole zoom levels, so the units fill the frame.
          isFractionalZoomEnabled: true,
          gestureHandling: 'cooperative',
          backgroundColor: '#02040a',
          clickableIcons: false,
        });
        settle(() => setStatus('ready'));
      })
      .catch(() => settle(() => fail(NOT_LOADED)));

    return () => {
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      mapRef.current = null;
    };
  }, [containerRef]);

  return { mapRef, status, errorMessage };
}
