import { describe, expect, it } from 'vitest';
import {
  INDEX_BANDS,
  MAX_RADIUS_PX,
  MIN_RADIUS_PX,
  UNRANKED_NODE,
  indexBand,
  nodeRadius,
  nodeStyle,
} from '@/lib/depot/map/nodeStyle';

describe('nodeRadius', () => {
  const MAX_FLEET = 400;

  it('grows monotonically with fleet', () => {
    const fleets = [0, 1, 5, 20, 50, 100, 200, 300, 400];
    const radii = fleets.map((fleet) => nodeRadius(fleet, MAX_FLEET));
    radii.slice(1).forEach((radius, index) => {
      expect(radius).toBeGreaterThanOrEqual(radii[index] ?? Number.POSITIVE_INFINITY);
    });
  });

  it('gives the largest depot the maximum radius', () => {
    expect(nodeRadius(MAX_FLEET, MAX_FLEET)).toBe(MAX_RADIUS_PX);
  });

  it('clamps both ends', () => {
    expect(nodeRadius(0, MAX_FLEET)).toBe(MIN_RADIUS_PX);
    expect(nodeRadius(1, MAX_FLEET)).toBe(MIN_RADIUS_PX);
    expect(nodeRadius(MAX_FLEET * 4, MAX_FLEET)).toBe(MAX_RADIUS_PX);
  });

  it('scales area, not radius, with fleet above the floor', () => {
    const quarter = nodeRadius(100, MAX_FLEET);
    expect(quarter).toBeCloseTo(MAX_RADIUS_PX / 2, 6);
  });

  it('never returns NaN for degenerate input', () => {
    const cases: Array<[number, number]> = [
      [Number.NaN, MAX_FLEET],
      [10, Number.NaN],
      [10, 0],
      [-5, MAX_FLEET],
      [10, -1],
      [Number.POSITIVE_INFINITY, MAX_FLEET],
    ];
    cases.forEach(([fleet, maxFleet]) => {
      const radius = nodeRadius(fleet, maxFleet);
      expect(Number.isFinite(radius)).toBe(true);
      expect(radius).toBeGreaterThanOrEqual(MIN_RADIUS_PX);
      expect(radius).toBeLessThanOrEqual(MAX_RADIUS_PX);
    });
  });
});

describe('indexBand', () => {
  it('has five ordered bands covering 0 to 100', () => {
    expect(INDEX_BANDS).toHaveLength(5);
    expect(INDEX_BANDS[0]?.min).toBe(0);
    expect(INDEX_BANDS[INDEX_BANDS.length - 1]?.max).toBe(100);
    INDEX_BANDS.slice(1).forEach((band, index) => {
      expect(band.min).toBe(INDEX_BANDS[index]?.max);
    });
  });

  it('puts each boundary in the band above it, and 100 in the top band', () => {
    expect(indexBand(0)?.level).toBe(0);
    expect(indexBand(19.9)?.level).toBe(0);
    expect(indexBand(20)?.level).toBe(1);
    expect(indexBand(39.9)?.level).toBe(1);
    expect(indexBand(40)?.level).toBe(2);
    expect(indexBand(60)?.level).toBe(3);
    expect(indexBand(80)?.level).toBe(4);
    expect(indexBand(100)?.level).toBe(4);
  });

  it('clamps out-of-range values into the end bands', () => {
    expect(indexBand(-3)?.level).toBe(0);
    expect(indexBand(140)?.level).toBe(4);
  });

  it('returns null for a null or non-finite index', () => {
    expect(indexBand(null)).toBeNull();
    expect(indexBand(Number.NaN)).toBeNull();
  });

  it('gives every band a distinct colour and a text label', () => {
    const colours = new Set(INDEX_BANDS.map((band) => band.fill));
    expect(colours.size).toBe(INDEX_BANDS.length);
    INDEX_BANDS.forEach((band) => {
      expect(band.label).toMatch(/\d+.\d+/);
    });
  });
});

describe('nodeStyle', () => {
  it('fills a ranked depot with its band colour', () => {
    const style = nodeStyle({ fleet: 200, index: 85, ranked: true }, 400);
    expect(style.hollow).toBe(false);
    expect(style.fill).toBe(INDEX_BANDS[4]?.fill);
    expect(style.fillOpacity).toBeGreaterThan(0);
    expect(style.bandLabel).toBe(INDEX_BANDS[4]?.label);
  });

  it('draws an unranked depot hollow with a neutral stroke', () => {
    const style = nodeStyle({ fleet: 3, index: null, ranked: false }, 400);
    expect(style.hollow).toBe(true);
    expect(style.fillOpacity).toBe(0);
    expect(style.stroke).toBe(UNRANKED_NODE.stroke);
    expect(style.bandLabel).toBe(UNRANKED_NODE.label);
  });

  it('treats a ranked depot with a null index as unranked', () => {
    const style = nodeStyle({ fleet: 30, index: null, ranked: true }, 400);
    expect(style.hollow).toBe(true);
  });

  it('is deterministic', () => {
    const input = { fleet: 120, index: 42.5, ranked: true };
    expect(nodeStyle(input, 400)).toEqual(nodeStyle(input, 400));
  });

  it('never yields NaN anywhere in the style', () => {
    const style = nodeStyle({ fleet: Number.NaN, index: Number.NaN, ranked: true }, 0);
    Object.values(style).forEach((value) => {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    });
  });
});
