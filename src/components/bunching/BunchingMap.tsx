'use client';

import { useEffect, useRef, useState } from 'react';
import {
  SIMULATION_MAP_BACKGROUND,
  SIMULATION_MAP_COLORS,
  SIMULATION_MAP_LIGHT_STYLE,
} from '@/lib/bunching/mapStyle';
import { getMapsLoader, isMapsConfigured } from '@/lib/maps/loader';
import { onMapsAuthFailure } from '@/lib/maps/authFailure';
import { MARKER_TRANSITION_MS, BUS_COLORS } from '@/lib/bunching/config';
import {
  SIMULATION_ROUTE_GEOMETRY,
  SIMULATION_ROUTE_LABEL,
  SIMULATION_ROUTE_STOPS,
} from '@/lib/bunching/route';
import { pointAtFraction } from '@/lib/bunching/routeInterpolation';
import { BUS_IDS, type BusId, type BusProgress, type SimulationIteration } from '@/lib/bunching/types';
import { MapFallback } from '@/components/map/MapFallback';
import { busMarkerIcon, labelPlaqueIcon } from './busMarkers';

type Overlay = google.maps.Polyline | google.maps.Marker | google.maps.Circle;

/**
 * Incident overlay radii as a fraction of the corridor's length rather than in
 * fixed metres, so the geometry stays proportionate whenever the demo corridor
 * changes and a circle never swamps or disappears against the route.
 */
const INCIDENT_RADIUS = {
  stop: 0.042,
  bus: 0.061,
  stationary: 0.051,
  clusterPad: 0.014,
  clusterMin: 0.022,
} as const;

/**
 * One basemap for one control policy.
 *
 * The map instance, the corridor polyline, the stop markers and the four bus
 * markers are created exactly once and then mutated in place — an iteration
 * change moves markers, it never rebuilds the map. Marker positions come
 * entirely from the iteration's `progress` values, which are themselves derived
 * from the headway vector, so the picture on the map and the numbers in the
 * panels cannot disagree.
 */
export function BunchingMap({
  iteration,
  reduced,
  paneLabel,
}: {
  iteration: SimulationIteration;
  reduced: boolean;
  paneLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Record<BusId, google.maps.Marker> | null>(null);
  const incidentRef = useRef<Overlay[]>([]);
  const frameRef = useRef<number | undefined>(undefined);
  /** Progress values currently painted, so animation resumes from the screen. */
  const paintedRef = useRef<BusProgress>(iteration.progress);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  // ---- One-time bootstrap --------------------------------------------------
  useEffect(() => {
    if (!isMapsConfigured()) {
      setStatus('error');
      setErrorMessage(
        'Google Maps is not configured for this environment (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY). The headway simulation, metrics and calculations below remain fully functional.',
      );
      return;
    }

    let cancelled = false;
    const created: Overlay[] = [];

    // The SDK can load successfully and still be refused for this origin, in
    // which case Google paints its own error panel inside the map div. Catch
    // that and show our own fallback over the top instead.
    const unsubscribe = onMapsAuthFailure(() => {
      if (cancelled) return;
      setStatus('error');
      setErrorMessage(
        'Google Maps refused this request — the API key is not authorised for this domain. The headway simulation, metrics and calculations below are unaffected.',
      );
    });

    getMapsLoader()
      .importLibrary('maps')
      .then(async ({ Map }) => {
        // The marker library owns google.maps.Marker; importing it explicitly
        // keeps this component from depending on load order elsewhere.
        await getMapsLoader().importLibrary('marker');
        if (cancelled || !containerRef.current) return;

        const path = SIMULATION_ROUTE_STOPS.map((stop) => ({
          lat: stop.latitude,
          lng: stop.longitude,
        }));

        const map = new Map(containerRef.current, {
          center: path[0],
          zoom: 9,
          styles: SIMULATION_MAP_LIGHT_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'cooperative',
          backgroundColor: SIMULATION_MAP_BACKGROUND,
          clickableIcons: false,
          keyboardShortcuts: false,
          // No TrafficLayer: congestion in this simulator is a modelled
          // disturbance, and the demo has no traffic-signal capability at all.
        });
        mapRef.current = map;

        // Corridor polyline, with repeating arrows for the direction of travel.
        created.push(
          new google.maps.Polyline({
            path,
            map,
            strokeColor: SIMULATION_MAP_COLORS.corridor,
            strokeOpacity: 0.55,
            strokeWeight: 3.5,
            zIndex: 20,
            icons: [
              {
                icon: {
                  path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                  scale: 2.4,
                  fillColor: SIMULATION_MAP_COLORS.corridor,
                  fillOpacity: 0.85,
                  strokeOpacity: 0,
                },
                offset: '6%',
                repeat: '14%',
              },
            ],
          }),
        );

        SIMULATION_ROUTE_STOPS.forEach((stop, index) => {
          const terminal = index === 0 || index === SIMULATION_ROUTE_STOPS.length - 1;
          created.push(
            new google.maps.Marker({
              position: { lat: stop.latitude, lng: stop.longitude },
              map,
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: terminal ? 5.5 : 3.2,
                fillColor: terminal
                  ? SIMULATION_MAP_COLORS.terminal
                  : SIMULATION_MAP_COLORS.stop,
                fillOpacity: 0.9,
                strokeColor: SIMULATION_MAP_COLORS.stopStroke,
                strokeWeight: 1.4,
              },
              title: `${stop.name} — simulation corridor stop`,
              zIndex: 40,
              clickable: false,
            }),
          );
        });

        const markers = {} as Record<BusId, google.maps.Marker>;
        for (const bus of BUS_IDS) {
          const position = pointAtFraction(SIMULATION_ROUTE_GEOMETRY, paintedRef.current[bus]);
          markers[bus] = new google.maps.Marker({
            position: { lat: position.latitude, lng: position.longitude },
            map,
            icon: busMarkerIcon(bus),
            title: `Bus ${bus} · UPSRTC (simulated)`,
            // A leads the chain, so it must never be hidden behind a follower.
            zIndex: 900 - BUS_IDS.indexOf(bus),
            clickable: false,
            optimized: false,
          });
        }
        markersRef.current = markers;

        // Frame the whole corridor once. The camera then stays still: at this
        // scale a ten-minute headway is a legible gap and a bunch is a visible
        // overlap, so there is nothing to chase.
        const bounds = new google.maps.LatLngBounds();
        path.forEach((point) => bounds.extend(point));
        map.fitBounds(bounds, { top: 28, right: 28, bottom: 28, left: 28 });

        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'The Google basemap could not be initialised for this simulation.',
        );
      });

    return () => {
      cancelled = true;
      unsubscribe();
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      created.forEach((overlay) => overlay.setMap(null));
      incidentRef.current.forEach((overlay) => overlay.setMap(null));
      incidentRef.current = [];
      if (markersRef.current) {
        for (const bus of BUS_IDS) markersRef.current[bus].setMap(null);
        markersRef.current = null;
      }
      mapRef.current = null;
    };
  }, []);

  // ---- Bus movement -------------------------------------------------------
  useEffect(() => {
    if (status !== 'ready') return;
    const markers = markersRef.current;
    if (!markers) return;

    const place = (progress: BusProgress): void => {
      for (const bus of BUS_IDS) {
        const point = pointAtFraction(SIMULATION_ROUTE_GEOMETRY, progress[bus]);
        markers[bus].setPosition({ lat: point.latitude, lng: point.longitude });
      }
      paintedRef.current = progress;
    };

    const from = paintedRef.current;
    const to = iteration.progress;

    if (reduced) {
      place(to);
      return;
    }

    const start = performance.now();
    const tick = (now: number): void => {
      const linear = Math.min(1, (now - start) / MARKER_TRANSITION_MS);
      const eased = 1 - (1 - linear) ** 3;
      const mixed = {} as Record<BusId, number>;
      for (const bus of BUS_IDS) mixed[bus] = from[bus] + (to[bus] - from[bus]) * eased;
      place(mixed);
      if (linear < 1) frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
  }, [iteration.progress, reduced, status]);

  // ---- Scenario incident overlay -----------------------------------------
  useEffect(() => {
    if (status !== 'ready') return;
    const map = mapRef.current;
    if (!map) return;

    incidentRef.current.forEach((overlay) => overlay.setMap(null));
    incidentRef.current = [];

    const overlays: Overlay[] = [];
    const { incident, progress } = iteration;
    const totalMetres = SIMULATION_ROUTE_GEOMETRY.totalKm * 1000;
    const at = (fraction: number) => {
      const point = pointAtFraction(SIMULATION_ROUTE_GEOMETRY, fraction);
      return { lat: point.latitude, lng: point.longitude };
    };

    const tone = incident.active
      ? SIMULATION_MAP_COLORS.incident
      : SIMULATION_MAP_COLORS.inactive;

    if (incident.kind === 'cluster') {
      // Highlight the cluster, then draw the service gap that sits behind it.
      const clusterFrom = progress.C;
      const clusterTo = progress.A;
      const centre = (clusterFrom + clusterTo) / 2;
      overlays.push(
        new google.maps.Circle({
          map,
          center: at(centre),
          radius: Math.max(
            INCIDENT_RADIUS.clusterMin * totalMetres,
            ((clusterTo - clusterFrom) / 2) * totalMetres + INCIDENT_RADIUS.clusterPad * totalMetres,
          ),
          strokeColor: SIMULATION_MAP_COLORS.incident,
          strokeOpacity: 0.5,
          strokeWeight: 1.4,
          fillColor: SIMULATION_MAP_COLORS.incident,
          fillOpacity: 0.08,
          zIndex: 10,
          clickable: false,
        }),
        new google.maps.Polyline({
          path: [at(progress.D), at(progress.C)],
          map,
          strokeOpacity: 0,
          zIndex: 30,
          icons: [
            {
              icon: {
                path: 'M 0,-1 0,1',
                strokeOpacity: 0.9,
                strokeColor: SIMULATION_MAP_COLORS.gap,
                scale: 3,
              },
              offset: '0',
              repeat: '11px',
            },
          ],
        }),
        new google.maps.Marker({
          position: at((progress.C + progress.D) / 2),
          map,
          icon: labelPlaqueIcon(
            `Service gap ${iteration.headways[2].toFixed(1)} min`,
            SIMULATION_MAP_COLORS.gap,
          ),
          zIndex: 950,
          clickable: false,
          optimized: false,
        }),
      );
    } else if (incident.anchorStopIndex !== null) {
      const stop = SIMULATION_ROUTE_STOPS[incident.anchorStopIndex];
      if (stop) {
        const position = { lat: stop.latitude, lng: stop.longitude };
        overlays.push(
          new google.maps.Circle({
            map,
            center: position,
            radius: INCIDENT_RADIUS.stop * totalMetres,
            strokeColor: tone,
            strokeOpacity: 0.55,
            strokeWeight: 1.4,
            fillColor: tone,
            fillOpacity: incident.active ? 0.11 : 0.04,
            zIndex: 10,
            clickable: false,
          }),
          new google.maps.Marker({
            position,
            map,
            icon: labelPlaqueIcon(incident.label, tone),
            zIndex: 950,
            clickable: false,
            optimized: false,
          }),
        );
      }
    } else if (incident.anchorBus) {
      const position = at(progress[incident.anchorBus]);
      const isFastFollower = incident.kind === 'fast-follower';
      const colour = isFastFollower ? BUS_COLORS.B : tone;

      overlays.push(
        new google.maps.Circle({
          map,
          center: position,
          radius:
            (incident.kind === 'stationary' ? INCIDENT_RADIUS.stationary : INCIDENT_RADIUS.bus) *
            totalMetres,
          strokeColor: colour,
          strokeOpacity: 0.5,
          strokeWeight: 1.4,
          fillColor: colour,
          fillOpacity: incident.active ? 0.1 : 0.035,
          zIndex: 10,
          clickable: false,
        }),
        new google.maps.Marker({
          position,
          map,
          icon: labelPlaqueIcon(
            incident.active ? incident.label : `${incident.label} — cleared`,
            colour,
          ),
          zIndex: 950,
          clickable: false,
          optimized: false,
        }),
      );
    }

    incidentRef.current = overlays;
  }, [iteration, status]);

  // ---- Re-fit when the pane becomes visible ------------------------------
  // On small screens the two panes are tabbed. The hidden pane keeps its map
  // instance (never destroy and rebuild it), but it measures 0×0 while hidden,
  // so the basemap needs a nudge once it has real dimensions again.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || status !== 'ready') return;

    let lastWidth = container.clientWidth;
    const observer = new ResizeObserver(() => {
      const map = mapRef.current;
      const width = container.clientWidth;
      if (!map || width === 0 || width === lastWidth) return;
      lastWidth = width;

      const bounds = new google.maps.LatLngBounds();
      SIMULATION_ROUTE_STOPS.forEach((stop) =>
        bounds.extend({ lat: stop.latitude, lng: stop.longitude }),
      );
      map.fitBounds(bounds, { top: 28, right: 28, bottom: 28, left: 28 });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [status]);

  const spacingDescription = BUS_IDS.map(
    (bus, index) =>
      `Bus ${bus}${index < 3 ? `, ${iteration.headways[index]?.toFixed(1)} minutes ahead of Bus ${BUS_IDS[index + 1]}` : ''}`,
  ).join('. ');

  return (
    <div className="relative overflow-hidden rounded-lg border border-sim-line">
      <div
        ref={containerRef}
        className="h-[300px] w-full sm:h-[360px] lg:h-[400px]"
        role="application"
        aria-label={`${paneLabel} — simulated bus positions on the ${SIMULATION_ROUTE_LABEL} corridor`}
      />

      {/* The map is decorative reinforcement of the headway state; the state
          itself is always available to assistive technology as text. */}
      <p className="sr-only" aria-live="polite">
        {paneLabel}, iteration {iteration.index}. {spacingDescription}.
      </p>

      {status !== 'ready' && (
        <MapFallback
          status={status}
          message={errorMessage}
          onRetry={() => window.location.reload()}
          variant="light"
        />
      )}

      <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
        <div className="absolute left-0 top-0 h-5 w-5 border-l-2 border-t-2 border-sim-accent/45" />
        <div className="absolute right-0 top-0 h-5 w-5 border-r-2 border-t-2 border-sim-accent/45" />
        <div className="absolute bottom-0 left-0 h-5 w-5 border-b-2 border-l-2 border-sim-accent/45" />
        <div className="absolute bottom-0 right-0 h-5 w-5 border-b-2 border-r-2 border-sim-accent/45" />
      </div>

      <div className="pointer-events-none absolute bottom-2 left-2 z-20 rounded border border-sim-line bg-sim-surface/90 px-2 py-1">
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-sim-muted">
          {SIMULATION_ROUTE_LABEL}
        </span>
      </div>
    </div>
  );
}
