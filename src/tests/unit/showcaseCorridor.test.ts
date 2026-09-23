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