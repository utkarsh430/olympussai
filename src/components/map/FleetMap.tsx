'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createFleetLayer, type FleetLayerHandle } from './fleetCanvasLayer';
import type { CanonicalLiveBus } from '@/models/canonical';
import { useCopilotStore, useSelectedBus } from '@/stores/copilotStore';
import { MAP_DARK_STYLE, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, SELECTED_BUS_ZOOM } from '@/lib/constants';
import { getMapsLoader, isMapsConfigured } from '@/lib/maps/loader';
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

  // Projected scenario geometry (corridors, congestion, assistance links, heatmap).
  useScenarioOverlays(mapInstance);

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

        const map = new Map(containerRef.current, {
          center: DEFAULT_MAP_CENTER,
          zoom: DEFAULT_MAP_ZOOM,
          styles: MAP_DARK_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          backgroundColor: '#02040a',
          clickableIcons: false,
          // Explicitly NOT enabling TrafficLayer — all traffic here is simulated.
        });

        mapRef.current = map;

        layerRef.current = createFleetLayer<CanonicalLiveBus>(map, (bus) => {
          selectBus(bus.id);
          logAudit('bus-selected', `Operator selected live bus ${bus.registrationNumber} from map`, {
            registrationNumber: bus.registrationNumber,
            simulated: false,
          });
        });
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
      <div ref={containerRef} className="absolute inset-0" aria-label="Live UPSRTC fleet map" role="application" />

      {status !== 'ready' && (
        <MapFallback status={status} message={errorMessage} onRetry={handleRetry} />
      )}

      {/* HUD framing over the basemap */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
        <div className="absolute inset-0 border border-holo-glow/20 rounded-lg" />
        <div className="absolute left-0 top-0 h-6 w-6 border-l-2 border-t-2 border-holo-glow/60" />
        <div className="absolute right-0 top-0 h-6 w-6 border-r-2 border-t-2 border-holo-glow/60" />
        <div className="absolute bottom-0 left-0 h-6 w-6 border-b-2 border-l-2 border-holo-glow/60" />
        <div className="absolute bottom-0 right-0 h-6 w-6 border-b-2 border-r-2 border-holo-glow/60" />
        <div className="absolute inset-0 scanline-overlay opacity-30" />
      </div>

      {selectedBus && mapInstance && <RadarSweep map={mapInstance} bus={selectedBus} />}
    </div>
  );
}
