import { describe, it, expect } from 'vitest';
import {
  latLngToVec3,
  polygonContainsPoint,
  landContainsPoint,
  sampleLandGrid,
  sampleSphereGrid,
  landPointsToPositions,
  buildGraticule,
  type LandPolygon,
} from '@/three/globe/geo';
import { LAND_POLYGONS } from '@/three/globe/landData';

const mag = ([x, y, z]: [number, number, number]) => Math.sqrt(x * x + y * y + z * z);

/** A 20°×20° square of "land" centred on (lat 0, lng 0) with a small hole. */
const square: LandPolygon = {
  rings: [
    [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
      [-10, -10],
    ],
    // hole: a 2°×2° square around the origin
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ],
  ],
  bbox: [-10, -10, 10, 10],
};

describe('latLngToVec3', () => {
  it('maps the poles to ±Y', () => {
    const north = latLngToVec3(90, 0, 1);
    const south = latLngToVec3(-90, 0, 1);
    expect(north[1]).toBeCloseTo(1, 5);
    expect(south[1]).toBeCloseTo(-1, 5);
    expect(Math.hypot(north[0], north[2])).toBeCloseTo(0, 5);
    expect(Math.hypot(south[0], south[2])).toBeCloseTo(0, 5);
  });

  it('keeps the equator on the y=0 plane at the sphere radius', () => {
    for (const lng of [-180, -90, 0, 45, 90, 179]) {
      const v = latLngToVec3(0, lng, 2);
      expect(v[1]).toBeCloseTo(0, 5);
      expect(Math.hypot(v[0], v[2])).toBeCloseTo(2, 5);
    }
  });

  it('preserves radius for arbitrary coordinates', () => {
    for (const [lat, lng] of [
      [12, -77],
      [-33, 151],
      [64, -21],
      [-54, -70],
    ]) {
      expect(mag(latLngToVec3(lat!, lng!, 1.5))).toBeCloseTo(1.5, 5);
    }
  });

  it('is periodic in longitude (lng ≡ lng + 360)', () => {
    const a = latLngToVec3(30, -120, 1);
    const b = latLngToVec3(30, 240, 1);
    expect(a[0]).toBeCloseTo(b[0], 5);
    expect(a[1]).toBeCloseTo(b[1], 5);
    expect(a[2]).toBeCloseTo(b[2], 5);
  });

  it('faces the Americas toward the camera (+Z) and Asia away (−Z)', () => {
    // lng −90 (central Americas) should point at the camera.
    expect(latLngToVec3(0, -90, 1)[2]).toBeCloseTo(1, 5);
    // lng +90 (East Asia / Indian Ocean) should point away.
    expect(latLngToVec3(0, 90, 1)[2]).toBeCloseTo(-1, 5);
    // Greenwich sits on screen-right (+X).
    expect(latLngToVec3(0, 0, 1)[0]).toBeCloseTo(1, 5);
  });
});

describe('point-in-polygon', () => {
  it('detects interior points and rejects exterior points', () => {
    expect(polygonContainsPoint(square, 5, 5)).toBe(true);
    expect(polygonContainsPoint(square, -8, 3)).toBe(true);
    expect(polygonContainsPoint(square, 15, 0)).toBe(false);
    expect(polygonContainsPoint(square, 0, 20)).toBe(false);
  });

  it('excludes points inside a hole', () => {
    expect(polygonContainsPoint(square, 0, 0)).toBe(false); // inside the hole
    expect(polygonContainsPoint(square, 3, 0)).toBe(true); // outside the hole, inside land
  });

  it('fast-rejects points outside the bounding box', () => {
    expect(polygonContainsPoint(square, 1000, 1000)).toBe(false);
    expect(polygonContainsPoint(square, -1000, 5)).toBe(false);
  });

  it('landContainsPoint aggregates across polygons', () => {
    expect(landContainsPoint([square], 5, 5)).toBe(true);
    expect(landContainsPoint([square], 50, 50)).toBe(false);
  });
});

describe('sampleLandGrid', () => {
  it('is deterministic (identical output across calls)', () => {
    const a = sampleLandGrid([square], { stepDeg: 2 });
    const b = sampleLandGrid([square], { stepDeg: 2 });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('only returns points that fall on land', () => {
    const pts = sampleLandGrid([square], { stepDeg: 2 });
    for (const [lng, lat] of pts) {
      expect(landContainsPoint([square], lng, lat)).toBe(true);
    }
  });

  it('produces more points as the grid gets denser', () => {
    const coarse = sampleLandGrid([square], { stepDeg: 4 });
    const dense = sampleLandGrid([square], { stepDeg: 1 });
    expect(dense.length).toBeGreaterThan(coarse.length);
  });

  it('never samples the hole', () => {
    const pts = sampleLandGrid([square], { stepDeg: 0.5 });
    const inHole = pts.some(([lng, lat]) => Math.abs(lng) < 1 && Math.abs(lat) < 1);
    expect(inHole).toBe(false);
  });
});

describe('sampleSphereGrid', () => {
  it('is deterministic and covers the whole sphere (land + ocean)', () => {
    const a = sampleSphereGrid({ stepDeg: 6 });
    const b = sampleSphereGrid({ stepDeg: 6 });
    expect(a).toEqual(b);
    // Full-sphere grid must exceed the land-only subset at the same step.
    expect(a.length).toBeGreaterThan(sampleLandGrid([square], { stepDeg: 6 }).length);
  });

  it('produces valid, in-range coordinates and densifies with smaller steps', () => {
    const grid = sampleSphereGrid({ stepDeg: 4 });
    for (const [lng, lat] of grid) {
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThan(180);
    }
    expect(sampleSphereGrid({ stepDeg: 3 }).length).toBeGreaterThan(
      sampleSphereGrid({ stepDeg: 6 }).length,
    );
  });

  it('includes open-ocean points that sampleLandGrid rejects', () => {
    const grid = sampleSphereGrid({ stepDeg: 5 });
    const hasOcean = grid.some(([lng, lat]) => !landContainsPoint([square], lng, lat));
    expect(hasOcean).toBe(true);
  });
});

describe('landPointsToPositions', () => {
  it('packs XYZ triples on the sphere surface', () => {
    const pts: Array<[number, number]> = [
      [0, 0],
      [-90, 0],
      [0, 90],
    ];
    const arr = landPointsToPositions(pts, 1.5);
    expect(arr.length).toBe(9);
    for (let i = 0; i < pts.length; i++) {
      const v: [number, number, number] = [arr[i * 3]!, arr[i * 3 + 1]!, arr[i * 3 + 2]!];
      expect(mag(v)).toBeCloseTo(1.5, 4);
    }
  });
});

describe('buildGraticule', () => {
  it('has the expected packed length', () => {
    const parallels = 5;
    const meridians = 8;
    const segments = 16;
    const arr = buildGraticule({ parallels, meridians, segments, radius: 1 });
    expect(arr.length).toBe((parallels + meridians) * segments * 2 * 3);
  });

  it('places every vertex on the sphere radius', () => {
    const arr = buildGraticule({ parallels: 4, meridians: 6, segments: 12, radius: 2 });
    for (let i = 0; i < arr.length; i += 3) {
      expect(Math.sqrt(arr[i]! ** 2 + arr[i + 1]! ** 2 + arr[i + 2]! ** 2)).toBeCloseTo(2, 4);
    }
  });
});

describe('real Natural Earth land data', () => {
  it('loads a plausible number of land polygons', () => {
    expect(LAND_POLYGONS.length).toBeGreaterThan(100);
  });

  it('recognizes major continental landmasses', () => {
    expect(landContainsPoint(LAND_POLYGONS, -100, 40)).toBe(true); // central USA
    expect(landContainsPoint(LAND_POLYGONS, -55, -10)).toBe(true); // Amazon basin, Brazil
    expect(landContainsPoint(LAND_POLYGONS, 20, 0)).toBe(true); // central Africa
    expect(landContainsPoint(LAND_POLYGONS, 100, 60)).toBe(true); // Siberia
  });

  it('rejects open ocean', () => {
    expect(landContainsPoint(LAND_POLYGONS, -30, 0)).toBe(false); // mid-Atlantic
    expect(landContainsPoint(LAND_POLYGONS, -150, 0)).toBe(false); // mid-Pacific
    expect(landContainsPoint(LAND_POLYGONS, -100, -40)).toBe(false); // South Pacific
  });

  it('orients the Americas toward the camera and Asia away from it', () => {
    // Sampled land dots for the Americas should sit on the +Z (camera) side…
    const usa = latLngToVec3(40, -100, 1);
    const brazil = latLngToVec3(-10, -55, 1);
    expect(usa[2]).toBeGreaterThan(0);
    expect(brazil[2]).toBeGreaterThan(0);
    // …while East-Asian land sits on the far (−Z) side.
    const siberia = latLngToVec3(60, 100, 1);
    expect(siberia[2]).toBeLessThan(0);
  });
});
