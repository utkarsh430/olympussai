'use client';

import { useEffect, useRef, useState } from 'react';
import { MapFallback } from '@/components/map/MapFallback';
import { MAP_DARK_STYLE } from '@/lib/constants';
import { BUS_STATE_LABEL } from '@/lib/depot/labels';
import { onMapsAuthFailure } from '@/lib/maps/authFailure';
import { getMapsLoader, isMapsConfigured } from '@/lib/maps/loader';
import { removeMapListeners } from '@/lib/maps/listeners';
import {
  BUS_STATE_COLOUR,
  type YardMapPoint,
  type YardModel,
} from '@/lib/depot/yard/yardModel';

type Status = 'loading' | 'ready' | 'error';
type Handle = google.maps.MapsEventListener | undefined;

interface Entry {
  readonly marker: google.maps.Marker;
  readonly handles: readonly Handle[];
  readonly state: YardMapPoint['state'];
  readonly relation: YardMapPoint['relation'];
}

const LOAD_TIMEOUT_MS = 15_000;
const FIT_PADDING_PX = 24;
const FALLBACK_ZOOM = 17;
const YARD_STROKE = '#6b84a0';
const YARD_FILL_OPACITY = 0.06;
const DOT_SCALE = 5;
const VISITOR_STROKE_WEIGHT = 2;
const HOME_STROKE_WEIGHT = 1;
const STILL_AVAILABLE =
  'Every bus the map shows is also listed in the roll below, grouped by state.';

function iconFor(point: Pick<YardMapPoint, 'state' | 'relation'>): google.maps.Symbol {
  const colour = BUS_STATE_COLOUR[point.state];
  const visiting = point.relation === 'visiting';
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: DOT_SCALE,
    fillColor: colour,
    fillOpacity: visiting ? 0 : 0.95,
    strokeColor: visiting ? colour : '#02040a',
    strokeWeight: visiting ? VISITOR_STROKE_WEIGHT : HOME_STROKE_WEIGHT,
  };
}

function describe(point: YardMapPoint): string {
  const who = point.relation === 'visiting' ? 'visiting' : 'home';
  return `${point.registration}, ${BUS_STATE_LABEL[point.state]}, ${who} bus`;
}

export interface YardMapProps {
  readonly model: YardModel;
}

/**
 * The yard as an inferred circle with this depot's buses as dots. The camera fits the
 * circle once; later polls move markers in place, keyed by registration, and never the
 * camera. Plain `google.maps.Marker` symbols, so no map id is needed.
 */
export function YardMap({ model }: YardMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const entriesRef = useRef<Map<string, Entry>>(new Map());
  const fittedRef = useRef(false);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [hovered, setHovered] = useState<YardMapPoint | null>(null);

  // ---- One-time bootstrap ---------------------------------------------------
  useEffect(() => {
    if (!isMapsConfigured()) {
      setStatus('error');
      setErrorMessage(`The basemap is not configured for this environment. ${STILL_AVAILABLE}`);
      return;
    }
    let cancelled = false;
    let refused = false;
    const fail = (message: string): void => {
      if (cancelled) return;
      setStatus('error');
      setErrorMessage(`${message} ${STILL_AVAILABLE}`);
    };
    const unsubscribe = onMapsAuthFailure(() => {
      refused = true;
      fail('The basemap refused this request for this domain.');
    });
    const timer = window.setTimeout(() => fail('The basemap took too long to load.'), LOAD_TIMEOUT_MS);

    getMapsLoader()
      .importLibrary('maps')
      .then(async ({ Map }) => {
        await getMapsLoader().importLibrary('marker');
        // A refusal can arrive before the library resolves; it must win.
        if (cancelled || refused || !containerRef.current) return;
        window.clearTimeout(timer);
        mapRef.current = new Map(containerRef.current, {
          center: { lat: 0, lng: 0 },
          zoom: FALLBACK_ZOOM,
          styles: MAP_DARK_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'cooperative',
          backgroundColor: '#02040a',
          clickableIcons: false,
        });
        setStatus('ready');
      })
      .catch(() => {
        window.clearTimeout(timer);
        fail('The basemap could not be loaded.');
      });

    const entries = entriesRef.current;
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      unsubscribe();
      entries.forEach((entry) => {
        removeMapListeners(entry.handles);
        entry.marker.setMap(null);
      });
      entries.clear();
      circleRef.current?.setMap(null);
      circleRef.current = null;
      mapRef.current = null;
    };
  }, []);

  // ---- Yard circle: moved in place, camera fitted once ----------------------
  const yard = model.yard;
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map || !yard) return;
    const center = { lat: yard.lat, lng: yard.lng };
    if (circleRef.current) {
      circleRef.current.setCenter(center);
      circleRef.current.setRadius(yard.radiusM);
    } else {
      circleRef.current = new google.maps.Circle({
        map,
        center,
        radius: yard.radiusM,
        strokeColor: YARD_STROKE,
        strokeWeight: 1,
        strokeOpacity: 1,
        fillColor: YARD_STROKE,
        fillOpacity: YARD_FILL_OPACITY,
        clickable: false,
      });
    }
    if (!fittedRef.current) {
      fittedRef.current = true;
      const bounds = circleRef.current.getBounds();
      if (bounds) map.fitBounds(bounds, FIT_PADDING_PX);
      else map.setCenter(center);
    }
  }, [status, yard]);

  // ---- Markers: created, moved and removed by registration ------------------
  const points = model.points;
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;
    const entries = entriesRef.current;
    const live = new Set(points.map((point) => point.registration));

    entries.forEach((entry, registration) => {
      if (live.has(registration)) return;
      removeMapListeners(entry.handles);
      entry.marker.setMap(null);
      entries.delete(registration);
      setHovered((current) => (current?.registration === registration ? null : current));
    });

    points.forEach((point) => {
      const position = { lat: point.lat, lng: point.lng };
      const existing = entries.get(point.registration);
      if (existing) {
        existing.marker.setPosition(position);
        if (existing.state !== point.state || existing.relation !== point.relation) {
          existing.marker.setIcon(iconFor(point));
          existing.marker.setTitle(describe(point));
          entries.set(point.registration, {
            ...existing,
            state: point.state,
            relation: point.relation,
          });
        }
        return;
      }
      const marker = new google.maps.Marker({
        map,
        position,
        icon: iconFor(point),
        title: describe(point),
        optimized: true,
      });
      const handles: Handle[] = [
        marker.addListener('mouseover', () => setHovered(point)) as Handle,
        marker.addListener('mouseout', () => setHovered(null)) as Handle,
      ];
      entries.set(point.registration, {
        marker,
        handles,
        state: point.state,
        relation: point.relation,
      });
    });
  }, [points, status]);

  return (
    <div className="depot-map-frame" data-testid="yard-map">
      <div
        ref={containerRef}
        className="absolute inset-0"
        role="region"
        aria-label="Map of the inferred yard. Every bus shown is also listed in the roll below the map."
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
        <MapFallback
          status="error"
          message={errorMessage}
          onRetry={() => window.location.reload()}
        />
      ) : null}
      {status === 'ready' && hovered ? (
        <div
          aria-hidden
          data-testid="yard-map-hover"
          className="pointer-events-none absolute left-3 top-3 z-20 rounded-[3px] border border-depot-line bg-depot-surface px-3 py-2"
        >
          <p className="font-mono text-[13px] text-depot-ink">{hovered.registration}</p>
          <p className="mt-0.5 text-[11px] text-depot-muted">
            {BUS_STATE_LABEL[hovered.state]}
            {hovered.relation === 'visiting' ? ' · visiting' : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}
