import { describe, expect, it } from 'vitest';
import {
  buildShape,
  cumulativeDistancesMeters,
  dedupeAdjacent,
  distinctVertexCount,
  EARTH_RADIUS_METERS,
  findCoordinateSpikes,
  haversineMeters,
  maxLegMeters,
  toLineStringWkt,
  MAX_LEG_DISTANCE_METERS,
  MAX_TOTAL_DISTANCE_METERS,
} from '../../src/seed/geometry.js';

const LUCKNOW = { lat: 26.85286, lon: 80.92769 }; // KAISERBAGH
const BARABANKI = { lat: 26.92882, lon: 81.23005 };
const BAHRAICH = { lat: 27.56875, lon: 81.5878 };

describe('haversineMeters', () => {
  it('is zero for a point against itself and symmetric otherwise', () => {
    expect(haversineMeters(LUCKNOW, LUCKNOW)).toBe(0);
    expect(haversineMeters(LUCKNOW, BAHRAICH)).toBeCloseTo(haversineMeters(BAHRAICH, LUCKNOW), 9);
  });

  it('matches a hand-computed quarter meridian', () => {
    // Pole to equator along a meridian is a quarter of the great circle.
    const quarter = (Math.PI / 2) * EARTH_RADIUS_METERS;
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 90, lon: 0 })).toBeCloseTo(quarter, 3);
  });

  it('agrees with the known Kaiserbagh -> Barabanki distance', () => {
    // ~30 km by air; anything wildly off means a lat/lon transposition.
    expect(haversineMeters(LUCKNOW, BARABANKI)).toBeGreaterThan(29_000);
    expect(haversineMeters(LUCKNOW, BARABANKI)).toBeLessThan(32_000);
  });
});

describe('cumulativeDistancesMeters', () => {
  it('starts at 0, is monotonic, and its last entry is the sum of the legs', () => {
    const points = [LUCKNOW, BARABANKI, BAHRAICH];
    const cumulative = cumulativeDistancesMeters(points);
    expect(cumulative).toHaveLength(3);
    expect(cumulative[0]).toBe(0);
    expect(cumulative[1]).toBeCloseTo(haversineMeters(LUCKNOW, BARABANKI), 9);
    expect(cumulative[2]).toBeCloseTo(
      haversineMeters(LUCKNOW, BARABANKI) + haversineMeters(BARABANKI, BAHRAICH),
      9,
    );
  });

  it('agrees with the shape total by construction', () => {
    // This is the whole reason for a JS running sum rather than
    // ST_LineLocatePoint * total: the vertices ARE the stops, so
    // route_direction_stops.cumulative_distance_meters and
    // route_shapes.total_distance_meters can never drift apart.
    // estimator.ts clamps to the total while findNearestStop compares against
    // the cumulative values — a mismatch misclassifies stop state silently.
    const points = [LUCKNOW, BARABANKI, BAHRAICH];
    const shape = buildShape(points);
    if (!shape.ok) throw new Error('expected a valid shape');
    expect(shape.cumulativeDistancesMeters[points.length - 1]).toBe(shape.totalDistanceMeters);
  });

  it('gives a repeated coordinate a zero-length leg rather than collapsing it', () => {
    // Two stops at one coordinate are still two stops at two sequences.
    const cumulative = cumulativeDistancesMeters([LUCKNOW, LUCKNOW, BARABANKI]);
    expect(cumulative[0]).toBe(0);
    expect(cumulative[1]).toBe(0);
    expect(cumulative[2]).toBeGreaterThan(0);
  });

  it('emits one entry per input point, empty in, empty out', () => {
    expect(cumulativeDistancesMeters([])).toEqual([]);
    expect(cumulativeDistancesMeters([LUCKNOW])).toEqual([0]);
  });
});

describe('dedupeAdjacent / distinctVertexCount', () => {
  it('drops only adjacent duplicates, so a genuine revisit survives as a vertex', () => {
    const looped = dedupeAdjacent([LUCKNOW, LUCKNOW, BARABANKI, LUCKNOW]);
    expect(looped).toEqual([LUCKNOW, BARABANKI, LUCKNOW]);
    expect(distinctVertexCount(looped)).toBe(2);
  });
});

describe('buildShape', () => {
  it('rejects a single usable stop — ST_MakeLine of one point is not a LineString', () => {
    const result = buildShape([LUCKNOW]);
    expect(result).toMatchObject({ ok: false, reason: 'too_few_stops' });
  });

  it('rejects two stops at the same coordinate', () => {
    const result = buildShape([LUCKNOW, { ...LUCKNOW }]);
    expect(result).toMatchObject({ ok: false, reason: 'too_few_distinct_vertices' });
  });

  it('rejects a leg beyond the plausible limit', () => {
    // total_distance_meters would still look believable; the leg is what gives
    // a residual bad coordinate away.
    const far = { lat: 26.85286, lon: 88.0 };
    const result = buildShape([LUCKNOW, far]);
    expect(result).toMatchObject({ ok: false, reason: 'leg_distance_exceeds_limit' });
    expect(haversineMeters(LUCKNOW, far)).toBeGreaterThan(MAX_LEG_DISTANCE_METERS);
  });

  it('rejects a total beyond the plausible limit while every leg stays legal', () => {
    // 30 legs of ~100 km: each one fine, the route absurd.
    const points = Array.from({ length: 31 }, (_unused, index) => ({
      lat: 10 + index * 0.9,
      lon: 80,
    }));
    expect(maxLegMeters(points)).toBeLessThan(MAX_LEG_DISTANCE_METERS);
    const result = buildShape(points);
    expect(result).toMatchObject({ ok: false, reason: 'total_distance_exceeds_limit' });
    expect(cumulativeDistancesMeters(points).at(-1)).toBeGreaterThan(MAX_TOTAL_DISTANCE_METERS);
  });

  it('accepts a real corridor and reports its vertices and total', () => {
    const result = buildShape([LUCKNOW, BARABANKI, BAHRAICH]);
    if (!result.ok) throw new Error(`expected acceptance, got ${result.reason}`);
    expect(result.vertices).toHaveLength(3);
    expect(result.totalDistanceMeters).toBeGreaterThan(0);
    expect(result.maxLegMeters).toBeLessThan(MAX_LEG_DISTANCE_METERS);
  });
});

describe('findCoordinateSpikes', () => {
  it('finds the mis-surveyed interior point that buildShape cannot see', () => {
    // Reproduces live line 2046: MOHAMMADPUR listed ~97 km off a corridor
    // whose legs and total both stay inside buildShape's limits.
    const corridor = [
      { lat: 26.8957, lon: 81.084 }, // ANAURA
      { lat: 26.7594, lon: 82.05242 }, // MOHAMMADPUR — wrong
      { lat: 26.90379, lon: 81.12145 }, // SAFEDABAD
    ];
    expect(maxLegMeters(corridor)).toBeLessThan(MAX_LEG_DISTANCE_METERS);
    expect(buildShape(corridor).ok).toBe(true);

    const spikes = findCoordinateSpikes(corridor);
    expect(spikes.map((spike) => spike.index)).toEqual([1]);
    expect(spikes[0]!.detourMeters).toBeGreaterThan(150_000);
  });

  it('leaves a normal corridor alone', () => {
    expect(findCoordinateSpikes([LUCKNOW, BARABANKI, BAHRAICH])).toEqual([]);
  });

  it('never touches the endpoints, where a long leg is legitimate', () => {
    // A long first leg on an interurban run is normal; only the max-leg rule
    // is entitled to judge it.
    const points = [{ lat: 20, lon: 80 }, LUCKNOW, BARABANKI];
    expect(findCoordinateSpikes(points).some((spike) => spike.index === 0)).toBe(false);
  });

  it('finds several spikes, ascending by original index', () => {
    const points = [
      { lat: 26.8, lon: 80.9 },
      { lat: 25.0, lon: 82.5 }, // spike
      { lat: 26.85, lon: 80.95 },
      { lat: 28.5, lon: 79.0 }, // spike
      { lat: 26.9, lon: 81.0 },
    ];
    expect(findCoordinateSpikes(points).map((spike) => spike.index)).toEqual([1, 3]);
  });

  it('is disabled by a zero threshold and a no-op below three points', () => {
    const corridor = [
      { lat: 26.8957, lon: 81.084 },
      { lat: 26.7594, lon: 82.05242 },
      { lat: 26.90379, lon: 81.12145 },
    ];
    expect(findCoordinateSpikes(corridor, 0)).toEqual([]);
    expect(findCoordinateSpikes([LUCKNOW, BARABANKI])).toEqual([]);
  });
});

describe('toLineStringWkt', () => {
  it('emits longitude before latitude', () => {
    // The single most common way to seed PostGIS silently wrong.
    expect(toLineStringWkt([LUCKNOW, BARABANKI])).toBe(
      'LINESTRING(80.92769 26.85286,81.23005 26.92882)',
    );
  });
});
