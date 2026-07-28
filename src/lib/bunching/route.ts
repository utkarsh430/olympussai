/**
 * The corridor the simulation runs on: a Lucknow city-terminal departure.
 *
 * Provenance, stated precisely because the two halves differ:
 *
 * • The origin is real, and comes from this project's own data. In
 *   `src/fixtures/upsrtc-live-sample.json` six stationary buses of the
 *   KAISERBAGH depot sit within ~60 m of each other on the Kaiserbagh Bus
 *   Station apron; their centroid (26.860344, 80.928463) is the coordinate used
 *   below. That also puts the simulator right on the dashboard's existing map
 *   centre (`DEFAULT_MAP_CENTER`, the Lucknow area).
 *
 * • The route identity is real too: `KSG_166_ORD_OUT` — "KAISERBAGH TO MALLAWAN
 *   VIA HARDOI" — appears in the same live fixture, operated out of Kaiserbagh.
 *
 * • The intermediate points are corridor waypoints along the Lucknow–Hardoi road
 *   (NH-731) that the service follows, NOT surveyed UPSRTC stop coordinates. The
 *   project's schedule fixture only carries stop geometry for the two Bareilly
 *   routes, so there is no published Lucknow stop survey to draw on. They are
 *   therefore labelled as a simulation corridor rather than presented as
 *   operational stop data.
 *
 * The demo uses the first ~49 km of the service, as far as Sandila, which keeps
 * all four buses on the drawn polyline for the full run. No Directions or Routes
 * API is involved: the polyline is the waypoint sequence, exactly as the
 * dashboard already draws live schedule geometry.
 */

import { buildRouteGeometry, type RouteGeometry, type RouteStop } from './routeInterpolation';

export const SIMULATION_ROUTE_NAME = 'KSG_166_ORD_OUT';
export const SIMULATION_ROUTE_LABEL = 'Lucknow Kaiserbagh → Sandila';
export const SIMULATION_ROUTE_DESCRIPTION =
  'Simulation corridor — UPSRTC route KSG_166_ORD_OUT (Kaiserbagh to Mallawan via Hardoi), outbound as far as Sandila. Kaiserbagh Bus Station is positioned from live UPSRTC GPS in the project fixture; intermediate points are corridor waypoints on the Lucknow–Hardoi road, not surveyed stop coordinates.';

/** Waypoints in service order, Lucknow city terminal first. */
export const SIMULATION_ROUTE_STOPS: readonly RouteStop[] = [
  { sequence: 1, name: 'Kaiserbagh Bus Station, Lucknow', latitude: 26.860344, longitude: 80.928463 },
  { sequence: 2, name: 'Balaganj', latitude: 26.8686, longitude: 80.899 },
  { sequence: 3, name: 'Dubagga', latitude: 26.8863, longitude: 80.8617 },
  { sequence: 4, name: 'Kakori', latitude: 26.8842, longitude: 80.8003 },
  { sequence: 5, name: 'Malihabad', latitude: 26.9236, longitude: 80.7093 },
  { sequence: 6, name: 'Rahimabad', latitude: 26.9646, longitude: 80.6706 },
  { sequence: 7, name: 'Mall', latitude: 26.9853, longitude: 80.6178 },
  { sequence: 8, name: 'Sandila', latitude: 27.0722, longitude: 80.5124 },
];

/** Cumulative-distance table for the corridor, built once at module load. */
export const SIMULATION_ROUTE_GEOMETRY: RouteGeometry = buildRouteGeometry(SIMULATION_ROUTE_STOPS);
