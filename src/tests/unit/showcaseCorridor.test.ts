// @vitest-environment node
//
// The Lucknow corridor the live trial is drawn on.
//
// The corridor is a presentation geometry, hand-authored through real
// localities; these tests pin the properties the map and the lanes rely on
// rather than any coordinate. A stop out of order, a heading outside the
// compass or a projection that leaves the box would each draw a bus off the
// road without any other test noticing.

import { describe, expect, it } from 'vitest';
import {
  CORRIDOR_ROUTES,
  INTERCITY_CORRIDOR,
  LUCKNOW_CORRIDOR,
  SUBURBAN_CORRIDOR,
  nearestStop,
  positionAlongRoute,
  positionAtFraction,
  projectToBox,
} from '@/lib/showcase/corridor';

describe('LUCKNOW_CORRIDOR', () => {
  it('has twenty-five stops with strictly increasing distances', () => {
    expect(LUCKNOW_CORRIDOR.stops).toHaveLength(25);
    for (let index = 1; index < LUCKNOW_CORRIDOR.stops.length; index += 1) {
      const previous = LUCKNOW_CORRIDOR.stops[index - 1];
      const stop = LUCKNOW_CORRIDOR.stops[index];
      expect(stop?.cumulativeMeters ?? 0).toBeGreaterThan(previous?.cumulativeMeters ?? 0);
      expect(stop?.sequence).toBe(index + 1);
    }
    expect(LUCKNOW_CORRIDOR.stops[0]?.cumulativeMeters).toBe(0);
  });

  it('is a city-scale corridor', () => {
    expect(LUCKNOW_CORRIDOR.lengthMeters).toBeGreaterThan(15_000);
    expect(LUCKNOW_CORRIDOR.lengthMeters).toBeLessThan(30_000);
    const last = LUCKNOW_CORRIDOR.stops[LUCKNOW_CORRIDOR.stops.length - 1];
    expect(last?.cumulativeMeters).toBe(LUCKNOW_CORRIDOR.lengthMeters);
  });

  it('names its ends after its first and last stops', () => {
    expect(LUCKNOW_CORRIDOR.origin).toBe(LUCKNOW_CORRIDOR.stops[0]?.name);
    expect(LUCKNOW_CORRIDOR.destination).toBe(
      LUCKNOW_CORRIDOR.stops[LUCKNOW_CORRIDOR.stops.length - 1]?.name,
    );
  });
});

describe('positionAtFraction', () => {
  it('starts on the first stop and ends on the last', () => {
    const first = LUCKNOW_CORRIDOR.stops[0];
    const last = LUCKNOW_CORRIDOR.stops[LUCKNOW_CORRIDOR.stops.length - 1];
    const start = positionAtFraction(LUCKNOW_CORRIDOR, 0);
    const end = positionAtFraction(LUCKNOW_CORRIDOR, 1);
    expect(start.latitude).toBe(first?.latitude);
    expect(start.longitude).toBe(first?.longitude);
    expect(end.latitude).toBe(last?.latitude);
    expect(end.longitude).toBe(last?.longitude);
  });

  it('clamps outside 0..1', () => {
    expect(positionAtFraction(LUCKNOW_CORRIDOR, -0.5)).toEqual(
      positionAtFraction(LUCKNOW_CORRIDOR, 0),
    );
    expect(positionAtFraction(LUCKNOW_CORRIDOR, 1.5)).toEqual(
      positionAtFraction(LUCKNOW_CORRIDOR, 1),
    );
  });

  it('reports a compass heading in [0, 360) everywhere along the route', () => {
    for (let step = 0; step <= 100; step += 1) {
      const heading = positionAtFraction(LUCKNOW_CORRIDOR, step / 100).headingDegrees;
      expect(heading).toBeGreaterThanOrEqual(0);
      expect(heading).toBeLessThan(360);
      expect(Number.isFinite(heading)).toBe(true);
    }
  });

  it('runs north-east overall, the way the route is authored', () => {
    const heading = positionAtFraction(LUCKNOW_CORRIDOR, 0.3).headingDegrees;
    expect(heading).toBeGreaterThan(0);
    expect(heading).toBeLessThan(90);
  });
});

describe('positionAlongRoute', () => {
  it('maps the trial distance onto the map corridor by fraction', () => {
    expect(positionAlongRoute(LUCKNOW_CORRIDOR, 12_000, 24_000)).toEqual(
      positionAtFraction(LUCKNOW_CORRIDOR, 0.5),
    );
    expect(positionAlongRoute(LUCKNOW_CORRIDOR, 0, 24_000)).toEqual(
      positionAtFraction(LUCKNOW_CORRIDOR, 0),
    );
    expect(positionAlongRoute(LUCKNOW_CORRIDOR, 24_000, 24_000)).toEqual(
      positionAtFraction(LUCKNOW_CORRIDOR, 1),
    );
  });

  it('treats a zero-length trial corridor as the origin rather than dividing by it', () => {
    expect(positionAlongRoute(LUCKNOW_CORRIDOR, 500, 0).fraction).toBe(0);
  });
});

describe('nearestStop', () => {
  it('returns the stop whose distance is closest to the fraction', () => {
    for (const stop of LUCKNOW_CORRIDOR.stops) {
      const fraction = stop.cumulativeMeters / LUCKNOW_CORRIDOR.lengthMeters;
      expect(nearestStop(LUCKNOW_CORRIDOR, fraction)?.sequence).toBe(stop.sequence);
    }
  });

  it('snaps a point just short of a stop to that stop', () => {
    const target = LUCKNOW_CORRIDOR.stops[9];
    const fraction = ((target?.cumulativeMeters ?? 0) - 30) / LUCKNOW_CORRIDOR.lengthMeters;
    expect(nearestStop(LUCKNOW_CORRIDOR, fraction)?.sequence).toBe(target?.sequence);
  });
});

describe('projectToBox', () => {
  it('keeps every stop inside the padded box', () => {
    const width = 1200;
    const height = 640;
    const padding = 40;
    for (const stop of LUCKNOW_CORRIDOR.stops) {
      const { x, y } = projectToBox(stop, LUCKNOW_CORRIDOR.bounds, width, height, padding);
      expect(x).toBeGreaterThanOrEqual(padding - 1e-6);
      expect(x).toBeLessThanOrEqual(width - padding + 1e-6);
      expect(y).toBeGreaterThanOrEqual(padding - 1e-6);
      expect(y).toBeLessThanOrEqual(height - padding + 1e-6);
    }
  });

  it('puts north at the top and east on the right', () => {
    const first = LUCKNOW_CORRIDOR.stops[0];
    const last = LUCKNOW_CORRIDOR.stops[LUCKNOW_CORRIDOR.stops.length - 1];
    if (!first || !last) throw new Error('fixture has no stops');
    const a = projectToBox(first, LUCKNOW_CORRIDOR.bounds, 800, 600, 20);
    const b = projectToBox(last, LUCKNOW_CORRIDOR.bounds, 800, 600, 20);
    // Alambagh is south-west of Chinhat.
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeLessThan(a.y);
  });

  it('preserves aspect: the corridor fills the limiting axis exactly', () => {
    const width = 1000;
    const height = 300;
    const padding = 10;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const stop of LUCKNOW_CORRIDOR.stops) {
      const { x, y } = projectToBox(stop, LUCKNOW_CORRIDOR.bounds, width, height, padding);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const drawnWidth = maxX - minX;
    const drawnHeight = maxY - minY;
    const fillsWidth = Math.abs(drawnWidth - (width - padding * 2)) < 1e-6;
    const fillsHeight = Math.abs(drawnHeight - (height - padding * 2)) < 1e-6;
    expect(fillsWidth || fillsHeight).toBe(true);
  });
});

describe('the three routes', () => {
  it('maps every trial preset to a route anchored on Lucknow', () => {
    expect(Object.keys(CORRIDOR_ROUTES).sort()).toEqual(['intercity', 'suburban', 'urban']);
    for (const route of Object.values(CORRIDOR_ROUTES)) {
      const first = route.stops[0];
      expect(first?.latitude).toBeCloseTo(26.81, 1);
      expect(first?.longitude).toBeCloseTo(80.906, 2);
    }
  });

  it('gives the suburban radial about sixty kilometres over fifteen stops', () => {
    expect(SUBURBAN_CORRIDOR.stops).toHaveLength(15);
    expect(SUBURBAN_CORRIDOR.lengthMeters).toBeGreaterThan(40_000);
    expect(SUBURBAN_CORRIDOR.lengthMeters).toBeLessThan(75_000);
  });

  it('gives the inter-city trunk about three hundred kilometres over ten stations, Lucknow to Varanasi', () => {
    expect(INTERCITY_CORRIDOR.stops).toHaveLength(10);
    expect(INTERCITY_CORRIDOR.stops[0]?.name).toMatch(/Lucknow/);
    expect(INTERCITY_CORRIDOR.stops[9]?.name).toMatch(/Varanasi/);
    expect(INTERCITY_CORRIDOR.lengthMeters).toBeGreaterThan(250_000);
    expect(INTERCITY_CORRIDOR.lengthMeters).toBeLessThan(350_000);
    const sequences = INTERCITY_CORRIDOR.stops.map((stop) => stop.cumulativeMeters);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
  });
});
