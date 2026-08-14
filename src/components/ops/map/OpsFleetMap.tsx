'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createFleetLayer, type FleetLayerHandle } from '@/components/map/fleetCanvasLayer';
import { getMapsLoader, isMapsConfigured, onMapsAuthFailure } from '@/lib/maps/loader';
import { MAP_DARK_STYLE, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '@/lib/constants';
import { OpsMapFrame, OpsButton } from '@/components/ops/ui';
import type { FleetMapOverlay } from '@/lib/maps/contract';
import type { OpsMapVehicle } from '@/lib/ops/mapVehicles';

/**
 * The fleet map for the ops dashboards.
 *
 * Shares the proven renderer with the /project command centre
 * (src/components/map/fleetCanvasLayer.ts) rather than reimplementing it: one
 * canvas overlay for the whole fleet, because ~9,170 google.maps.Marker
 * objects plus MarkerClusterer measured 5.1 seconds of main-thread blocking
 * across a handful of zoom steps. This component is the ops-side mount for
 * that renderer, not a second map.
 *
 * What it deliberately does NOT inherit from the command centre is the
 * presentation. No scanline overlay, no radar sweep, no "establishing
 * holographic projection" copy: this is the real operational system, and it
 * speaks in the ops console's own vocabulary - OpsMapFrame for the frame it
 * sits in (which owns the definite-height and no-ancestor-transform rules the
 * canvas projection depends on), ops tokens for everything else.
 *
 * IT DOES NOT FETCH. Vehicles arrive as props, already narrowed to what the
 * caller may see by src/lib/ops/mapData.ts. That is the depot boundary: a map
 * that fetched the statewide feed and filtered in the browser would look
 * identical and would hand the whole fleet to anyone who opened devtools. Use
 * OpsFleetMapPanel for a live-refreshing mount; it polls the scoped endpoint.
 */

export interface OpsFleetMapProps {
  /** Already-scoped vehicles. Everything passed in is drawn; the component performs no filtering of its own. */
  vehicles: readonly OpsMapVehicle[];
  /** Annotations drawn in the same frame. Build them with `buildIncidentOverlay` or any other pure builder. */
  overlays?: readonly FleetMapOverlay[];
  /** Highlighted vehicle. Controlled: the map never selects on its own. */
  selectedVehicleId?: string | null;
  /** Fired when the operator clicks within the hit radius of a drawn vehicle. */
  onSelectVehicle?: (vehicle: OpsMapVehicle) => void;
  /**
   * Fit the camera to the vehicles the first time a non-empty set arrives.
   * On by default, and it is what makes one component work for both a
   * 40-vehicle depot and the statewide fleet. Turned off, the map opens on
   * the state view.
   */
  autoFit?: boolean;
  /** Caption under the map. Say what boundary is in force, e.g. `Ghaziabad depot - 61 vehicles`. */
  caption?: string;
  /** Frame minimum height. Passed to OpsMapFrame; see its note on why a definite height is not optional. */
  minHeight?: string;
  /**
   * Grow to fill a flex parent instead of sitting at `minHeight`.
   *
   * For a console whose page does not scroll (OpsShell `variant="full"`),
   * where the map is the centrepiece and must take whatever height is left
   * over. `minHeight` still applies underneath, so the stacked narrow layout
   * keeps a usable map rather than collapsing to nothing. This adds flex
   * sizing only - deliberately no `transform`, which would slide every
   * chevron off the road (see OpsMapFrame).
   */
  fill?: boolean;
  /** Accessible name for the map region. */
  label?: string;
  /**
   * True while the caller's first fetch is still outstanding, so an empty
   * `vehicles` means "not yet" rather than "none". Only the caller knows
   * which.
   */
  awaitingFirstLoad?: boolean;
}

/** Uttar Pradesh, comfortably. Used when the camera cannot be fitted to anything. */
const FALLBACK_CENTER = DEFAULT_MAP_CENTER;
const FALLBACK_ZOOM = DEFAULT_MAP_ZOOM;

/** Never zoom past this when fitting to a handful of vehicles parked in one yard. */
const MAX_AUTO_FIT_ZOOM = 14;

export function OpsFleetMap({
  vehicles,
  overlays,
  selectedVehicleId = null,
  onSelectVehicle,
  autoFit = true,
  caption,
  minHeight,
  fill = false,
  label = 'Fleet map',
  awaitingFirstLoad = false,
}: OpsFleetMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const layerRef = useRef<FleetLayerHandle<OpsMapVehicle> | null>(null);
  const hasFittedRef = useRef(false);
  // Read through a ref inside the click listener so a changing callback never
  // forces the map to be torn down and rebuilt.
  const onSelectRef = useRef(onSelectVehicle);
  onSelectRef.current = onSelectVehicle;

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  // An API-key rejection is not a load failure: the SDK loads, the map is
  // constructed, and Google then paints its own white error panel over the
  // container. Without this the console shows that panel - a large white
  // rectangle where the fleet should be - instead of its own message. See
  // src/lib/maps/loader.ts.
  useEffect(
    () =>
      onMapsAuthFailure(() => {
        setStatus('error');
        setErrorMessage('The basemap rejected this deployment\u2019s API key (check its allowed referrers).');
      }),
    [],
  );

  useEffect(() => {
    if (!isMapsConfigured()) {
      setStatus('error');
      setErrorMessage('The basemap is not configured for this environment (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).');
      return;
    }

    let cancelled = false;

    getMapsLoader()
      .importLibrary('maps')
      .then(({ Map }) => {
        if (cancelled || !containerRef.current) return;

        const map = new Map(containerRef.current, {
          center: FALLBACK_CENTER,
          zoom: FALLBACK_ZOOM,
          styles: MAP_DARK_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          streetViewControl: false,
          gestureHandling: 'greedy',
          backgroundColor: '#02040a',
          clickableIcons: false,
        });
        mapRef.current = map;

        layerRef.current = createFleetLayer<OpsMapVehicle>(map, (vehicle) => {
          onSelectRef.current?.(vehicle);
        });
        // Never promote an already-failed map back to ready: the auth hook can
        // fire before the constructor resolves.
        setStatus((current) => (current === 'error' ? current : 'ready'));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'The basemap failed to initialise.');
      });

    return () => {
      cancelled = true;
      layerRef.current?.destroy();
      layerRef.current = null;
      mapRef.current = null;
    };
  }, []);

  // Handing the layer a new array is O(1); the redraw it schedules is
  // O(visible vehicles) on the next animation frame. `status` is a dependency
  // because the layer does not exist until the basemap has loaded.
  useEffect(() => {
    layerRef.current?.setVehicles(vehicles);
  }, [vehicles, status]);

  useEffect(() => {
    layerRef.current?.setOverlays(overlays ?? []);
  }, [overlays, status]);

  useEffect(() => {
    layerRef.current?.setSelected(selectedVehicleId);
  }, [selectedVehicleId, status]);

  // Fit ONCE, on the first non-empty set. Refitting on every poll would drag
  // the camera out from under an operator who had zoomed into a corridor,
  // every fifteen seconds, for the whole shift.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || !autoFit || hasFittedRef.current) return;
    if (vehicles.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    for (const vehicle of vehicles) bounds.extend({ lat: vehicle.latitude, lng: vehicle.longitude });
    map.fitBounds(bounds, 48);
    const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
      if ((map.getZoom() ?? 0) > MAX_AUTO_FIT_ZOOM) map.setZoom(MAX_AUTO_FIT_ZOOM);
    });
    hasFittedRef.current = true;
    return () => listener.remove();
  }, [vehicles, status, autoFit]);

  // Pan to a selection made elsewhere on the page (a table row, an incident
  // list). Keyed on the id alone so a position refresh never yanks the camera.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || selectedVehicleId === null) return;
    const vehicle = vehicles.find((candidate) => candidate.id === selectedVehicleId);
    if (!vehicle) return;
    map.panTo({ lat: vehicle.latitude, lng: vehicle.longitude });
    if ((map.getZoom() ?? 0) < 12) map.setZoom(12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicleId, status]);

  const handleRetry = useCallback(() => window.location.reload(), []);

  const legend = useMemo(() => countByQuality(vehicles), [vehicles]);

  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col' : undefined}>
      <OpsMapFrame minHeight={minHeight} className={fill ? 'min-h-0 flex-1' : undefined}>
        <div ref={containerRef} className="absolute inset-0" role="application" aria-label={label} />

        {status !== 'ready' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-ops-bg px-6 text-center">
            {status === 'loading' ? (
              <p className="ops-label">Loading map…</p>
            ) : (
              // Not OpsAlert: this replaces the map rather than sitting above
              // it, and it needs the retry control inside the same block.
              <div role="alert" className="max-w-md">
                <p className="ops-label mb-2 text-ops-danger">Map unavailable</p>
                <p className="mb-4 text-sm text-ops-muted">
                  {errorMessage} Vehicle positions are still listed in the tables on this page.
                </p>
                <OpsButton onClick={handleRetry}>Reload</OpsButton>
              </div>
            )}
          </div>
        )}

        {status === 'ready' && vehicles.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 px-6 text-center">
            {/* "No vehicles" is a claim about the fleet. Before any data has
                arrived the map has no evidence for it, and on a statewide
                console - where the vehicles are polled rather than seeded,
                because 9,170 of them do not belong in a page payload - that
                gap is a real second of screen time. Saying the wrong one of
                these is exactly the fabrication this surface exists to
                remove. */}
            <p className="text-sm text-ops-muted">{awaitingFirstLoad ? 'Loading vehicle positions…' : 'No vehicles to show.'}</p>
          </div>
        )}
      </OpsMapFrame>

      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ops-faint">
        {caption !== undefined && <span className="text-ops-muted">{caption}</span>}
        <LegendSwatch colour="#2bff88" label={`Fresh ${legend.good}`} />
        <LegendSwatch colour="#ffb020" label={`Delayed ${legend.degraded}`} />
        <LegendSwatch colour="#ff4d5e" label={`Stale ${legend.stale}`} />
      </div>
    </div>
  );
}

/**
 * Swatches use the renderer's own literal chevron colours, not ops tokens.
 * A legend whose colour does not match the mark it explains is worse than no
 * legend; these three strings are the ones fleetCanvasLayer.ts fills with.
 */
function LegendSwatch({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono">
      <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: colour }} />
      {label}
    </span>
  );
}

function countByQuality(vehicles: readonly OpsMapVehicle[]) {
  const counts = { good: 0, degraded: 0, stale: 0 };
  for (const vehicle of vehicles) counts[vehicle.dataQuality] += 1;
  return counts;
}
