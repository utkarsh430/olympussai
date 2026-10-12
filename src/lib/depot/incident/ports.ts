import type { Figure, LatLng } from '../types';

/*
 * The seams Incident Response reads through, beside the scheduler's. Each
 * has one adapter today; a ticketing feed or a routing service replaces it
 * in the composition root.
 */

export interface PassengerLoadQuery {
  readonly routeName: string;
  readonly operatingDate: string;
  readonly hour: number;
  readonly busesOnRouteNow: number;
}

/** Passengers aboard a bus of the route at the hour; today a busiest-stretch estimate, later ticketing. */
export interface PassengerLoadPort {
  loadAboard(query: PassengerLoadQuery): Promise<Figure<number>>;
}

/** Road distance and time between two points; today straight line with a detour factor at a reference speed. */
export interface RoadTimePort {
  travel(from: LatLng, to: LatLng): { readonly km: number; readonly minutes: number };
}
