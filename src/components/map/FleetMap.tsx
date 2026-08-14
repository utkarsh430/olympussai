'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createFleetLayer,
  FLEET_PALETTE_DARK,
  FLEET_PALETTE_LIGHT,
  type FleetLayerHandle,
} from './fleetCanvasLayer';
import type { CanonicalLiveBus } from '@/models/canonical';
import { useCopilotStore, useSelectedBus } from '@/stores/copilotStore';
import {
  MAP_THEME,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  SELECTED_BUS_ZOOM,
} from '@/lib/constants';
import { useTheme } from '@/components/theme/ThemeProvider';
import { getMapsLoader, isMapsConfigured, onMapsAuthFailure } from '@/lib/maps/loader';
import { MapFallback } from './MapFallback';
import { RadarSweep } from './RadarSweep';
import { useScenarioOverlays } from './useScenarioOverlays';

export function FleetMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  /**
   * Single canvas overlay replaces ~9.5k individual map markers. The renderer
   * is shared with the ops dashboards' OpsFleetMap and is generic over the
   * vehicle record, so this surface keeps its full CanonicalLiveBus in the
   * click callback with no cast.
   */
  const layerRef = useRef<FleetLayerHandle<CanonicalLiveBus> | null>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);

  const buses = useCopilotStore((state) => state.buses);
  const selectedBusId = useCopilotStore((state) => state.selectedBusId);
  const selectBus = useCopilotStore((state) => state.selectBus);
  const logAudit = useCopilotStore((state) => state.logAudit);
  const isPitchMode = useCopilotStore((state) => state.isPitchMode);
  const selectedBus = useSelectedBus();

  /**
   * THE BASEMAP AND THE MARKS ARE THE TWO THINGS ON THIS PAGE CSS CANNOT
   * REACH, and they are also the two largest.
   *
   * The basemap is a JavaScript style array handed to the Map constructor;
   * the fleet marks are colour strings painted into a canvas. Neither
   * resolves a CSS custom property, so neither follows `.dark`. Left alone,
   * a light command centre would render a white console over a black map
   * with nine thousand invisible buses on it.
   *
   * `resolved`, not `preference`: an operator on "follow my machine" must
   * get the day map in the day, and the swap has to happen without a reload
   * when their machine flips at dusk — which is exactly what the provider
   * re-resolves for.
   */
  const { resolved } = useTheme();
  const mapThemeRef = useRef(resolved);
  mapThemeRef.current = resolved;

  // Projected scenario geometry (corridors, congestion, assistance links, heatmap).
  useScenarioOverlays(mapInstance);

  /**
   * AN API-KEY REJECTION IS NOT A LOAD FAILURE, AND THIS SURFACE WAS NOT
   * CATCHING IT.
   *
   * Seen in a real browser while reviewing this redesign, not reasoned about:
   * with a referrer-restricted key, the SDK loads, `importLibrary` resolves,
   * `new Map()` succeeds — and Google then paints its own full-bleed white
   * "Oops! Something went wrong" panel inside the container while logging
   * `RefererNotAllowedMapError`. Every other failure path here keys off a
   * REJECTED import, so this component believed the map was fine and showed a
   * white rectangle in the middle of the command centre. In dark it is the
   * brightest thing on the screen.
   *
   * The ops dashboards' OpsFleetMap has handled this since it was written;
   * the command centre's map never did, on the same key, in the same product.
   * `onMapsAuthFailure` is the shared subscription to Google's documented
   * `gm_authFailure` hook (src/lib/maps/loader.ts), so this is the same fix in
   * the same words — and it puts MapFallback on screen, which says which half
   * is down and which half still works.
   */
  useEffect(
    () =>
      onMapsAuthFailure(() => {
        setStatus('error');
        setErrorMessage(
          'The map service refused this deployment’s key, so the map cannot be drawn. Bus positions are still arriving — check the key’s allowed web addresses.',
        );
      }),
    [],
  );

  // ---- Map bootstrap -------------------------------------------------------
  useEffect(() => {
    if (!isMapsConfigured()) {
      setStatus('error');
      setErrorMessage('Google Maps API key is not configured (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).');
      return;
    }

    let cancelled = false;

    getMapsLoader()
      .importLibrary('maps')
      .then(({ Map }) => {
        if (cancelled || !containerRef.current) return;

        // Read from the ref rather than the closed-over value: this effect
        // deliberately runs once, so an operator who arrives on light must not
        // get a map built dark and corrected a frame later.
        const initialTheme = mapThemeRef.current;

        const map = new Map(containerRef.current, {
          center: DEFAULT_MAP_CENTER,
          zoom: DEFAULT_MAP_ZOOM,
          ...MAP_THEME[initialTheme],
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
          // Explicitly NOT enabling TrafficLayer — all traffic here is simulated.
        });

        mapRef.current = map;

        layerRef.current = createFleetLayer<CanonicalLiveBus>(
          map,
          (bus) => {
            selectBus(bus.id);
            logAudit(
              'bus-selected',
              `Operator selected live bus ${bus.registrationNumber} from map`,
              {
                registrationNumber: bus.registrationNumber,
                simulated: false,
              },
            );
          },
          initialTheme === 'dark' ? FLEET_PALETTE_DARK : FLEET_PALETTE_LIGHT,
        );
        // Seed with whatever has already arrived from the feed.
        layerRef.current.setVehicles(useCopilotStore.getState().buses);
        layerRef.current.setSelected(useCopilotStore.getState().selectedBusId);

        setMapInstance(map);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(
          error instanceof Error ? error.message : 'Google Maps failed to initialise.',
        );
      });

    return () => {
      cancelled = true;
      layerRef.current?.destroy();
      layerRef.current = null;
    };
    // selectBus/logAudit are stable Zustand actions; the map must build once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Fleet layer sync ---------------------------------------------------
  // Handing the layer a new array is O(1); the redraw it schedules is
  // O(visible vehicles) on the next animation frame.
  useEffect(() => {
    layerRef.current?.setVehicles(buses);
  }, [buses]);

  useEffect(() => {
    layerRef.current?.setSelected(selectedBusId);
  }, [selectedBusId]);

  // ---- Theme sync ---------------------------------------------------------
  // Both halves in one effect, because they must never disagree: a light
  // basemap under night-neon chevrons is worse than either mismatch alone.
  useEffect(() => {
    if (status !== 'ready') return;
    mapRef.current?.setOptions(MAP_THEME[resolved]);
    layerRef.current?.setPalette(resolved === 'dark' ? FLEET_PALETTE_DARK : FLEET_PALETTE_LIGHT);
  }, [resolved, status]);

  // ---- Camera fly-to on selection -----------------------------------------
  // Runs on selection change only, so 15s polling never yanks the camera back.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedBus || status !== 'ready') return;
    map.panTo({ lat: selectedBus.latitude, lng: selectedBus.longitude });
    if ((map.getZoom() ?? 0) < SELECTED_BUS_ZOOM) map.setZoom(SELECTED_BUS_ZOOM);
    // Intentionally keyed on id alone: position updates must not re-pan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusId, status]);

  // Entering Pitch Mode returns the camera to the statewide view — the opening
  // caption claims network-wide visibility, so a city-level zoom undercuts it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;

    // The zoom control sits under the caption letterbox and shows through the
    // blur as a bright artefact; hide it for the duration of the presentation.
    map.setOptions({ zoomControl: !isPitchMode });

    if (!isPitchMode) return;
    map.panTo(DEFAULT_MAP_CENTER);
    map.setZoom(DEFAULT_MAP_ZOOM);
  }, [isPitchMode, status]);

  const handleRetry = useCallback(() => window.location.reload(), []);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg">
      <div
        ref={containerRef}
        className="absolute inset-0"
        aria-label="Live UPSRTC fleet map"
        role="application"
      />

      {status !== 'ready' && (
        <MapFallback status={status} message={errorMessage} onRetry={handleRetry} />
      )}

      {/* HUD framing over the basemap */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
        <div className="absolute inset-0 rounded-lg border border-holo-glow/20" />
        <div className="absolute left-0 top-0 h-6 w-6 border-l-2 border-t-2 border-holo-glow/60" />
        <div className="absolute right-0 top-0 h-6 w-6 border-r-2 border-t-2 border-holo-glow/60" />
        <div className="absolute bottom-0 left-0 h-6 w-6 border-b-2 border-l-2 border-holo-glow/60" />
        <div className="absolute bottom-0 right-0 h-6 w-6 border-b-2 border-r-2 border-holo-glow/60" />
        <div className="scanline-overlay absolute inset-0 opacity-30" />
      </div>

      {selectedBus && mapInstance && <RadarSweep map={mapInstance} bus={selectedBus} />}
    </div>
  );
}
