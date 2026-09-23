/**
 * The corridor the live trial is drawn on: a real Lucknow route.
 *
 * The simulator's own corridor is a straight line drawn outward from Lucknow
 * (`control-service/src/fleetTrial/corridor.ts`), which is right for a
 * physics rig and wrong for a map. What the page needs is the trial's
 * kinematics on real streets, so this module hand-authors a polyline through
 * real Lucknow localities - Alambagh, Charbagh, Hazratganj, Nishatganj,
 * Polytechnic, Chinhat - with twenty-five named stops along it, and maps the
 * trial's distance-along-route onto it PROPORTIONALLY. A bus that the
 * simulator puts 40% of the way down its 24 km corridor is drawn 40% of the
 * way along this one.
 *
 * Coordinates are approximate and lie on the major roads the route follows.
 * They are a presentation geometry, not a survey.
 *
 * Pure: no I/O, no browser API, so the map, the tactical fallback and the
 * tests all share one projection.
 */
import { haversineKm } from '@/lib/simulation/seededRandom';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface CorridorStop extends GeoPoint {
  /** 1-based, in route order. Matches the trial's station `sequence`. */
  sequence: number;
  name: string;
  /** Metres from the origin along the polyline, computed from the geometry. */
  cumulativeMeters: number;
}

export interface CorridorRoute {
  id: string;
  name: string;
  city: string;
  origin: string;
  destination: string;
  /** The stops in order; the polyline runs through every one of them. */
  stops: readonly CorridorStop[];
  /** Total polyline length in metres, computed from the geometry. */
  lengthMeters: number;
  /** Where a map should centre and how far in it should be. */
  centre: GeoPoint;
  zoom: number;
  /** The corner the polyline fits inside, for the tactical projection. */
  bounds: { north: number; south: number; east: number; west: number };
}

export interface RoutePosition extends GeoPoint {
  /** Compass heading in degrees, 0 = north, clockwise. */
  headingDegrees: number;
  /** 0..1 along the corridor. */
  fraction: number;
}

interface AuthoredStop {
  name: string;
  latitude: number;
  longitude: number;
}

/** Alambagh to Chinhat, south-west to north-east across the city. */
const LUCKNOW_STOPS: readonly AuthoredStop[] = [
  { name: 'Alambagh Bus Station', latitude: 26.81, longitude: 80.906 },
  { name: 'Singar Nagar', latitude: 26.8145, longitude: 80.91 },
  { name: 'Mawaiya', latitude: 26.819, longitude: 80.9135 },
  { name: 'Kanpur Road Crossing', latitude: 26.825, longitude: 80.917 },
  { name: 'Charbagh Railway Station', latitude: 26.8318, longitude: 80.9215 },
  { name: 'Burlington Crossing', latitude: 26.8395, longitude: 80.929 },
  { name: 'Hussainganj', latitude: 26.844, longitude: 80.935 },
  { name: 'Vidhan Sabha Marg', latitude: 26.847, longitude: 80.94 },
  { name: 'Hazratganj', latitude: 26.8503, longitude: 80.9452 },
  { name: 'Parivartan Chowk', latitude: 26.8555, longitude: 80.9445 },
  { name: 'Sikandar Bagh', latitude: 26.86, longitude: 80.9475 },
  { name: 'Nishatganj', latitude: 26.866, longitude: 80.9565 },
  { name: 'Mahanagar', latitude: 26.871, longitude: 80.96 },
  { name: 'Badshah Nagar', latitude: 26.876, longitude: 80.968 },
  { name: 'Lekhraj Market', latitude: 26.879, longitude: 80.976 },
  { name: 'HAL Gate', latitude: 26.88, longitude: 80.987 },
  { name: 'Polytechnic Crossing', latitude: 26.8792, longitude: 80.9992 },
  { name: 'Gomti Nagar Extension', latitude: 26.88, longitude: 81.008 },
  { name: 'Husaria Crossing', latitude: 26.881, longitude: 81.017 },
  { name: 'Kamta', latitude: 26.884, longitude: 81.026 },
  { name: 'Deva Road Crossing', latitude: 26.886, longitude: 81.034 },
  { name: 'Matiyari', latitude: 26.887, longitude: 81.04 },
  { name: 'Chinhat Tiraha', latitude: 26.888, longitude: 81.044 },
  { name: 'Chinhat Bazar', latitude: 26.8888, longitude: 81.047 },
  { name: 'Chinhat Terminal', latitude: 26.8895, longitude: 81.05 },
];

function buildRoute(id: string, name: string, authored: readonly AuthoredStop[]): CorridorRoute {
  const stops: CorridorStop[] = [];
  let cumulative = 0;
  for (let index = 0; index < authored.length; index += 1) {
    const stop = authored[index];
    if (!stop) continue;
    const previous = index > 0 ? authored[index - 1] : undefined;
    if (previous) {
      cumulative +=
        haversineKm(previous.latitude, previous.longitude, stop.latitude, stop.longitude) * 1000;
    }
    stops.push({
      sequence: index + 1,
      name: stop.name,
      latitude: stop.latitude,
      longitude: stop.longitude,
      cumulativeMeters: cumulative,
    });
  }
  const latitudes = stops.map((stop) => stop.latitude);
  const longitudes = stops.map((stop) => stop.longitude);
  const north = Math.max(...latitudes);
  const south = Math.min(...latitudes);
  const east = Math.max(...longitudes);
  const west = Math.min(...longitudes);
  const first = stops[0];
  const last = stops[stops.length - 1];
  return {
    id,
    name,
    city: 'Lucknow',
    origin: first?.name ?? '',
    destination: last?.name ?? '',
    stops,
    lengthMeters: cumulative,
    centre: { latitude: (north + south) / 2, longitude: (east + west) / 2 },
    zoom: 12,
    bounds: { north, south, east, west },
  };
}

/** The city trunk: Alambagh to Chinhat, across Lucknow. */
export const LUCKNOW_CORRIDOR: CorridorRoute = buildRoute(
  'lko-41',
  'Route 41 · Alambagh – Hazratganj – Chinhat',
  LUCKNOW_STOPS,
);

/** The suburban radial: Alambagh down the Kanpur road to Unnao, about 60 km. */
const SUBURBAN_STOPS: readonly AuthoredStop[] = [
  { name: 'Alambagh Bus Station', latitude: 26.81, longitude: 80.906 },
  { name: 'Krishna Nagar', latitude: 26.795, longitude: 80.895 },
  { name: 'Amausi', latitude: 26.775, longitude: 80.88 },
  { name: 'Transport Nagar', latitude: 26.762, longitude: 80.87 },
  { name: 'Sarojini Nagar', latitude: 26.745, longitude: 80.855 },
  { name: 'Scooter India', latitude: 26.728, longitude: 80.84 },
  { name: 'Banthra', latitude: 26.705, longitude: 80.82 },
  { name: 'Harauni', latitude: 26.68, longitude: 80.795 },
  { name: 'Ajgain', latitude: 26.655, longitude: 80.77 },
  { name: 'Nawabganj', latitude: 26.635, longitude: 80.745 },
  { name: 'Sohramau', latitude: 26.6, longitude: 80.705 },
  { name: 'Kanpur Road Toll', latitude: 26.575, longitude: 80.67 },
  { name: 'Dahi Chowki', latitude: 26.555, longitude: 80.635 },
  { name: 'Unnao Bypass', latitude: 26.54, longitude: 80.6 },
  { name: 'Unnao Bus Station', latitude: 26.53, longitude: 80.58 },
];