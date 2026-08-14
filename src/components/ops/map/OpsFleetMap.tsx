'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createFleetLayer, type FleetLayerHandle } from '@/components/map/fleetCanvasLayer';
import { getMapsLoader, isMapsConfigured, onMapsAuthFailure } from '@/lib/maps/loader';
import { isPlottablePosition, partitionPlottable } from '@/lib/maps/plottable';
import {
  MAP_DARK_STYLE,
  MAP_LIGHT_STYLE,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
} from '@/lib/constants';
import { OpsMapFrame, OpsButton } from '@/components/ops/ui';
import type { FleetMapOverlay, MapPoint } from '@/lib/maps/contract';
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
 *
 * THE ONE THING IT DOES REMOVE is a vehicle whose reported position is not on
 * the network at all - see src/lib/maps/plottable.ts for the reading that made
 * this necessary and for why the test is a bounding box. That is a
 * plausibility judgement about a coordinate, not a scoping decision about a
 * viewer: it removes the same vehicle from every operator's map rather than
 * different vehicles from different ones, so the depot boundary above is
 * untouched. The count is declared under the map, because a console that
 * silently drops a real bus is making the same kind of mistake as one that
 * draws a bus in the sea.
 */

export interface OpsFleetMapProps {
  /**
   * Already-scoped vehicles. Everything passed in is drawn except a vehicle
   * whose position is not on the served network; the component performs no
   * scope filtering of its own.
   */
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
  /**
   * Fit the camera over THESE points instead of over the vehicles.
   *
   * Added for the driver's route screen, which draws one bus and the six stops
   * ahead of it: fitted to the vehicle alone that map opens zoomed onto the
   * bus with every stop off-screen, which is the opposite of what the driver
   * opened it for. The alternative was a second map component, and a second
   * map is how two surfaces end up disagreeing about what a stale fix looks
   * like.
   *
   * Points are still filtered through the same served-network test the
   * vehicles are, so this cannot become a way to smuggle a garbage coordinate
   * into `fitBounds` - which is the one call where a single bad reading
   * decides what every operator sees first. An empty array fits nothing and
   * leaves the map on its fallback view, exactly as an empty fleet does.
   */
  fitPoints?: readonly MapPoint[];
  /**
   * Show the Fresh/Delayed/Stale swatch counts under the map. On by default.
   *
   * Turned OFF for the driver's own route screen, and the reason is a misread
   * rather than clutter. The words describe how old each vehicle's GPS FIX is;
   * on a fleet map, beside hundreds of chevrons, that reads correctly. On a
   * driver's phone, beside their own single bus and their own arrival times,
   * "Delayed 1" reads as "your bus is running late" - which is not what it
   * says, and is a claim this product has no basis for making. That surface
   * states the same fact in words instead ("Position 1 min old").
   */
  showFleetLegend?: boolean;
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
   * Which basemap to paint under the fleet.
   *
   * DEFAULTS TO `dark`, which is what every existing caller gets and what this
   * component has always drawn. The basemap is a JS style array rather than
   * CSS, so no theme class can reach it; a surface that wants the basemap to
   * follow the page has to say so here and re-render when the theme changes.
   *
   * The driver's route screen opts in, because it is the one surface in this
   * product read outdoors, and a dark basemap under a light console in direct
   * sunlight is unreadable rather than merely inconsistent. Other consoles
   * keep the dark basemap until their own lane moves them, so this prop adds a
   * capability without changing a pixel of anything that has not asked for it.
   */
  basemapTheme?: 'dark' | 'light';
  /**
   * True while the caller's first fetch is still outstanding, so an empty
   * `vehicles` means "not yet" rather than "none". Only the caller knows
   * which.
   */
  awaitingFirstLoad?: boolean;
  /**
   * Override the notice shown over an empty map, or `null` to suppress it.
   *
   * Added for the control-strategy rehearsal, which passes NO vehicles on
   * purpose and draws its simulated buses as overlay marks instead (a
   * simulated bus has no GPS fix, so it cannot honestly carry a
   * `dataQuality`, and the renderer colours vehicles by exactly that). On
   * that surface the default notice is a true sentence about the wrong
   * subject: it reports an empty FLEET over a map full of simulated buses.
   *
   * It is an override, not a default change. On every operational surface
   * an empty map still says so, because a console that quietly shows
   * nothing is the failure this notice was written for.
   */
  emptyMessage?: string | null;
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
  fitPoints,
  showFleetLegend = true,
  caption,
  minHeight,
  fill = false,
  label = 'Fleet map',
  basemapTheme = 'dark',
  awaitingFirstLoad = false,
  emptyMessage,
}: OpsFleetMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const layerRef = useRef<FleetLayerHandle<OpsMapVehicle> | null>(null);
  const hasFittedRef = useRef(false);
  // Read through a ref inside the click listener so a changing callback never
  // forces the map to be torn down and rebuilt.
  const onSelectRef = useRef(onSelectVehicle);
  onSelectRef.current = onSelectVehicle;
  // Read through a ref in the constructor for the same reason as onSelect: a
  // theme flip must RESTYLE the existing map (the effect below), never tear it
  // down and rebuild it. Rebuilding would drop the camera, refetch tiles and
  // make every bus jump.
  const basemapThemeRef = useRef(basemapTheme);
  basemapThemeRef.current = basemapTheme;

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  // Split before anything is drawn or measured, so a garbage reading cannot
  // reach the renderer, the camera fit, the selection pan or the legend. Every
  // use of `vehicles` below this line is deliberately `drawable` instead.
  const { plottable: drawable, unplottable } = useMemo(
    () => partitionPlottable(vehicles),
    [vehicles],
  );

  // An API-key rejection is not a load failure: the SDK loads, the map is
  // constructed, and Google then paints its own white error panel over the
  // container. Without this the console shows that panel - a large white
  // rectangle where the fleet should be - instead of its own message. See
  // src/lib/maps/loader.ts.
  useEffect(
    () =>
      onMapsAuthFailure(() => {
        setStatus('error');
        setErrorMessage(
          'The basemap rejected this deployment\u2019s API key (check its allowed referrers).',
        );
      }),
    [],
  );

  useEffect(() => {
    if (!isMapsConfigured()) {
      setStatus('error');
      setErrorMessage(
        'The basemap is not configured for this environment (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).',
      );
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
          styles: basemapThemeRef.current === 'light' ? MAP_LIGHT_STYLE : MAP_DARK_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          streetViewControl: false,
          gestureHandling: 'greedy',
          backgroundColor: basemapThemeRef.current === 'light' ? '#eef2f7' : '#02040a',
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
        setErrorMessage(
          error instanceof Error ? error.message : 'The basemap failed to initialise.',
        );
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
    layerRef.current?.setVehicles(drawable);
  }, [drawable, status]);

  useEffect(() => {
    layerRef.current?.setOverlays(overlays ?? []);
  }, [overlays, status]);

  // Repaint the basemap in place when the page theme changes. `setOptions` is
  // the only way to reach the style array after construction, and it keeps the
  // camera, the tiles and the vehicle layer exactly where they are.
  useEffect(() => {
    mapRef.current?.setOptions({
      styles: basemapTheme === 'light' ? MAP_LIGHT_STYLE : MAP_DARK_STYLE,
      backgroundColor: basemapTheme === 'light' ? '#eef2f7' : '#02040a',
    });
  }, [basemapTheme, status]);

  useEffect(() => {
    layerRef.current?.setSelected(selectedVehicleId);
  }, [selectedVehicleId, status]);

  // Fit ONCE, on the first non-empty set. Refitting on every poll would drag
  // the camera out from under an operator who had zoomed into a corridor,
  // every fifteen seconds, for the whole shift.
  //
  // Fitted over `drawable`, never `vehicles`. This is the line the ocean
  // defect was on: `fitBounds` takes the extremes of whatever it is given, so
  // it is the one place in the app where a single bad reading decides what
  // every operator sees first. A fleet with no plottable vehicle at all is
  // left on the state view rather than fitted to nothing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || !autoFit || hasFittedRef.current) return;

    // Caller-supplied points win when given, so a surface that needs the
    // camera over something other than its vehicles (the driver's route, whose
    // point is the stops ahead) does not need its own map. Filtered through
    // the same plausibility test as the vehicles: this is `fitBounds`, the one
    // call where a single bad coordinate decides the opening view.
    const fitTargets: MapPoint[] = fitPoints
      ? fitPoints.filter((point) => isPlottablePosition(point.latitude, point.longitude))
      : drawable;
    if (fitTargets.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    for (const point of fitTargets) bounds.extend({ lat: point.latitude, lng: point.longitude });
    map.fitBounds(bounds, 48);
    const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
      if ((map.getZoom() ?? 0) > MAX_AUTO_FIT_ZOOM) map.setZoom(MAX_AUTO_FIT_ZOOM);
    });
    hasFittedRef.current = true;
    return () => listener.remove();
  }, [drawable, fitPoints, status, autoFit]);

  // Pan to a selection made elsewhere on the page (a table row, an incident
  // list). Keyed on the id alone so a position refresh never yanks the camera.
  //
  // Searches `drawable` so selecting the unplaceable vehicle in a table leaves
  // the camera where it is, rather than flying the operator out to an empty
  // blue rectangle at zoom 12 with no basemap features and no explanation.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || selectedVehicleId === null) return;
    const vehicle = drawable.find((candidate) => candidate.id === selectedVehicleId);
    if (!vehicle) return;
    map.panTo({ lat: vehicle.latitude, lng: vehicle.longitude });
    if ((map.getZoom() ?? 0) < 12) map.setZoom(12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicleId, status]);

  const handleRetry = useCallback(() => window.location.reload(), []);

  // Counts the DRAWN set. Counting every vehicle here made the legend and the
  // chevrons on the glass disagree by one, with nothing on screen to explain
  // the difference.
  const legend = useMemo(() => countByQuality(drawable), [drawable]);

  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col' : undefined}>
      <OpsMapFrame minHeight={minHeight} className={fill ? 'min-h-0 flex-1' : undefined}>
        <div
          ref={containerRef}
          className="absolute inset-0"
          role="application"
          aria-label={label}
        />

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

        {status === 'ready' && drawable.length === 0 && emptyMessage !== null && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 px-6 text-center">
            {/* "No vehicles" is a claim about the fleet. Before any data has
                arrived the map has no evidence for it, and on a statewide
                console - where the vehicles are polled rather than seeded,
                because 9,170 of them do not belong in a page payload - that
                gap is a real second of screen time. Saying the wrong one of
                these is exactly the fabrication this surface exists to
                remove.

                The third case is its own sentence for the same reason: a
                fleet that reported only unusable positions is not an empty
                fleet, and calling it one would hide a feed problem behind a
                calm, ordinary-looking message. */}
            <p className="text-sm text-ops-muted">
              {emptyMessage ??
                (awaitingFirstLoad
                  ? 'Loading vehicle positions…'
                  : vehicles.length === 0
                    ? 'No vehicles to show.'
                    : 'No vehicle reported a position on the network.')}
            </p>
          </div>
        )}
      </OpsMapFrame>

      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ops-faint">
        {caption !== undefined && <span className="text-ops-muted">{caption}</span>}
        {showFleetLegend && (
          <>
            {/* While the first poll is still out there is nothing to count, and
            "Fresh 0 · Delayed 0 · Stale 0" is the same fabricated zero the
            caption beside it was just taught not to print. The swatches stay -
            they explain the chevron colours, which is a fact about the
            renderer rather than a claim about the fleet. */}
            <LegendSwatch
              colour="#2bff88"
              label={awaitingFirstLoad ? 'Fresh' : `Fresh ${legend.good}`}
            />
            <LegendSwatch
              colour="#ffb020"
              label={awaitingFirstLoad ? 'Delayed' : `Delayed ${legend.degraded}`}
            />
            <LegendSwatch
              colour="#ff4d5e"
              label={awaitingFirstLoad ? 'Stale' : `Stale ${legend.stale}`}
            />
          </>
        )}
      </div>

      {/* The vehicles removed from the picture, declared. These are real buses
          with a broken fix, not phantoms: the operator's own roster still
          lists them, so the map has to account for the difference rather than
          let the count quietly drop by one. */}
      {unplottable.length > 0 && (
        <p role="status" className="mt-1 shrink-0 text-xs text-ops-warn">
          {unplottable.length === 1
            ? '1 vehicle reported a position that is not on the network and is not drawn'
            : `${unplottable.length} vehicles reported positions that are not on the network and are not drawn`}{' '}
          (
          {unplottable
            .slice(0, UNPLOTTABLE_NAMES_SHOWN)
            .map((vehicle) => vehicle.registrationNumber)
            .join(', ')}
          {unplottable.length > UNPLOTTABLE_NAMES_SHOWN
            ? ` and ${unplottable.length - UNPLOTTABLE_NAMES_SHOWN} more`
            : ''}
          ). Their positions are still listed in the tables on this page.
        </p>
      )}
    </div>
  );
}

/**
 * How many registrations to name before summarising.
 *
 * Naming them matters - "1 vehicle is not drawn" is not actionable, and
 * UP78JT5520 is - but a feed-wide GPS outage must not produce a wall of
 * registration numbers under the map.
 */
const UNPLOTTABLE_NAMES_SHOWN = 3;

/**
 * Swatches use the renderer's own literal chevron colours, not ops tokens.
 * A legend whose colour does not match the mark it explains is worse than no
 * legend; these three strings are the ones fleetCanvasLayer.ts fills with.
 */
function LegendSwatch({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-sm"
        style={{ backgroundColor: colour }}
      />
      {label}
    </span>
  );
}

function countByQuality(vehicles: readonly OpsMapVehicle[]) {
  const counts = { good: 0, degraded: 0, stale: 0 };
  for (const vehicle of vehicles) counts[vehicle.dataQuality] += 1;
  return counts;
}
