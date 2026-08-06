// Shared fixtures for state-estimation tests: builds simple synthetic
// route-direction shapes using the same flat-earth approximation the
// production code uses at this scale, so distances in assertions are
// self-consistent and easy to reason about.

import type { LatLng, RouteDirectionShape } from "../src/state-estimation/types.js";

const METERS_PER_DEGREE_LAT = 111320;
export const ORIGIN: LatLng = { lat: 12.9716, lon: 77.5946 };

export function offsetEastNorth(origin: LatLng, eastMeters: number, northMeters: number): LatLng {
  const metersPerDegLon = METERS_PER_DEGREE_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return {
    lat: origin.lat + northMeters / METERS_PER_DEGREE_LAT,
    lon: origin.lon + eastMeters / metersPerDegLon,
  };
}

/** A straight, eastward route-direction shape starting at `origin`. */
export function straightLinePoints(origin: LatLng, lengthMeters: number, stepMeters = 100): LatLng[] {
  const points: LatLng[] = [];
  for (let d = 0; d < lengthMeters; d += stepMeters) {
    points.push(offsetEastNorth(origin, d, 0));
  }
  points.push(offsetEastNorth(origin, lengthMeters, 0));
  return points;
}

export function makeShape(overrides: Partial<RouteDirectionShape> & { points: LatLng[] }): RouteDirectionShape {
  return {
    routeDirectionId: "rd-1",
    routeId: "route-1",
    directionCode: "UP",
    corridorId: null,
    isLoop: false,
    corridorOffsetMeters: null,
    corridorDirectionSign: 1,
    totalDistanceMeters: 1000,
    ...overrides,
  };
}
