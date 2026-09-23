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