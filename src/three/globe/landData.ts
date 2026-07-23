/**
 * Build-time import of the vendored Natural Earth 110m land polygons.
 *
 * The JSON is bundled (see ./data/land-110m.json and its README) and imported
 * here — never fetched at runtime — so the production Content-Security-Policy
 * (`default-src 'self'`) is untouched. Each polygon is normalized once into the
 * `LandPolygon` shape used by geo.ts, with a precomputed exterior bbox for fast
 * point-in-polygon rejection.
 */
import type { LandPolygon, Ring } from './geo';
import rawLand from './data/land-110m.json';

interface RawFeatureCollection {
  type: string;
  features: Array<{ geometry: { type: string; coordinates: number[][][] } }>;
}

function toPolygon(coordinates: number[][][]): LandPolygon {
  const rings: Ring[] = coordinates.map((ring) =>
    ring.map((p) => [p[0] as number, p[1] as number] as [number, number]),
  );
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const exterior = rings[0] ?? [];
  for (const [lng, lat] of exterior) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { rings, bbox: [minLng, minLat, maxLng, maxLat] };
}

const fc = rawLand as unknown as RawFeatureCollection;

/** Normalized land polygons, ready for `landContainsPoint` / `sampleLandGrid`. */
export const LAND_POLYGONS: ReadonlyArray<LandPolygon> = fc.features.map((f) =>
  toPolygon(f.geometry.coordinates),
);
