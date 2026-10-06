'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, MAP_DARK_STYLE } from '@/lib/constants';
import { onMapsAuthFailure } from '@/lib/maps/authFailure';
import { getMapsLoader, isMapsConfigured } from '@/lib/maps/loader';
import { DEPOT_PALETTE } from '@/lib/depot/palette';

export type BaseMapStatus = 'loading' | 'ready' | 'error';

/** How long the basemap may take before the page says so. */
export const BASE_MAP_LOAD_TIMEOUT_MS = 15_000;

/** The page's own canvas colour, so the map area never flashes white. */
const MAP_BACKGROUND = DEPOT_PALETTE.page;

export interface BaseMapOptions {
  /** The sentence after every failure: where the map's content is also shown. */
  readonly stillAvailable: string;
  /** What the timeout says before `stillAvailable`; each map keeps its own sentence. */
  readonly timeoutText?: string;
  /** Map options beyond the house defaults, resolved once the libraries have loaded. */
  readonly extraOptions?: () => Promise<google.maps.MapOptions>;
  /** Removes the page's own overlays and listeners when the map goes away. */
  readonly onCleanup?: () => void;
}

export interface BaseMapHandle {
  readonly mapRef: RefObject<google.maps.Map | null>;
  readonly status: BaseMapStatus;
  readonly message: string;
}

/**
 * The basemap every depot map starts from: the shared loader, a load timeout, the
 * refusal hook and clean-up. Each map adds only its own overlays once `status` is ready.
 *
 * The race rule: a refusal from the map service (an authorisation failure) is final, even
 * after the map was drawn, since the service then disables the map. A timeout is not
 * final: if the library arrives after it, the map is built and the status becomes ready.
 */
export function useBaseMap(
  containerRef: RefObject<HTMLDivElement | null>,
  options: BaseMapOptions,
): BaseMapHandle {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [status, setStatus] = useState<BaseMapStatus>('loading');
  const [message, setMessage] = useState('');
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const { stillAvailable, extraOptions } = optionsRef.current;
    const timeoutText = optionsRef.current.timeoutText ?? 'The basemap took too long to load.';
    if (!isMapsConfigured()) {
      setStatus('error');
      setMessage(`The basemap is not configured for this environment. ${stillAvailable}`);
      return undefined;
    }
    let refused = false;
    let unmounted = false;
    const showError = (text: string): void => {
      if (unmounted) return;
      setStatus('error');
      setMessage(`${text} ${stillAvailable}`);
    };
    const timer = setTimeout(() => {
      if (!refused && mapRef.current === null) showError(timeoutText);
    }, BASE_MAP_LOAD_TIMEOUT_MS);
    const unsubscribe = onMapsAuthFailure(() => {
      refused = true;
      showError('The basemap refused this request for this domain.');
    });

    getMapsLoader()
      .importLibrary('maps')
      .then(async ({ Map }) => {
        await getMapsLoader().importLibrary('marker');
        const extra = extraOptions ? await extraOptions() : {};
        if (unmounted || refused || !containerRef.current) return;
        clearTimeout(timer);
        mapRef.current = new Map(containerRef.current, {
          center: DEFAULT_MAP_CENTER,
          zoom: DEFAULT_MAP_ZOOM,
          styles: MAP_DARK_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'cooperative',
          backgroundColor: MAP_BACKGROUND,
          clickableIcons: false,
          ...extra,
        });
        setStatus('ready');
        setMessage('');
      })
      .catch(() => {
        if (!refused) showError('The basemap could not be loaded.');
      });

    return () => {
      unmounted = true;
      clearTimeout(timer);
      unsubscribe();
      optionsRef.current.onCleanup?.();
      mapRef.current = null;
    };
  }, [containerRef]);

  return { mapRef, status, message };
}
