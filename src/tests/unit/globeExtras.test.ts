import { describe, it, expect } from 'vitest';
import { orbitPoint, orbitRing } from '@/three/globe/orbits';
import { greatCircleArc, sampleArc, pickRoutes } from '@/three/globe/arcs';

const mag = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

describe('orbits', () => {
  it('keeps every orbit point at the orbit radius', () => {
    for (const inc of [0, 0.4, -0.9, 1.2]) {
      for (const ang of [0, 1, 2.5, 4.2, 6]) {
        const [x, y, z] = orbitPoint(2.3, inc, 0.7, ang);
        expect(mag(x, y, z)).toBeCloseTo(2.3, 5);
      }
    }
  });

  it('lies in the equatorial plane when inclination is zero', () => {
    for (const ang of [0, 1.1, 3.3, 5.5]) {
      expect(orbitPoint(2, 0, 1.0, ang)[1]).toBeCloseTo(0, 6);
    }
  });

  it('builds a closed-ring buffer with all points at radius', () => {
    const seg = 64;
    const r = 2.6;
    const ring = orbitRing(r, 0.5, 1.2, seg);
    expect(ring.length).toBe(seg * 3);
    for (let i = 0; i < ring.length; i += 3) {
      expect(mag(ring[i]!, ring[i + 1]!, ring[i + 2]!)).toBeCloseTo(r, 4);
    }
  });
});

describe('great-circle arcs', () => {
  it('has the expected packed length', () => {
    expect(greatCircleArc(0, -100, 40, 20, 1.5, 0.5, 48).length).toBe((48 + 1) * 3);
  });

  it('anchors endpoints on the sphere and lifts the middle above it', () => {
    const radius = 1.5;
    const lift = 0.4;
    const arc = greatCircleArc(10, -80, -20, 30, radius, lift, 40);
    const first = mag(arc[0]!, arc[1]!, arc[2]!);
    const lastI = arc.length - 3;
    const last = mag(arc[lastI]!, arc[lastI + 1]!, arc[lastI + 2]!);
    const midI = Math.floor(arc.length / 2 / 3) * 3;
    const mid = mag(arc[midI]!, arc[midI + 1]!, arc[midI + 2]!);
    expect(first).toBeCloseTo(radius, 4);
    expect(last).toBeCloseTo(radius, 4);
    expect(mid).toBeGreaterThan(radius); // lifted above the surface
    expect(mid).toBeLessThanOrEqual(radius * (1 + lift) + 1e-6);
  });

  it('sampleArc returns the endpoints at t=0 and t=1', () => {
    const arc = greatCircleArc(0, 0, 0, 60, 1.5, 0.3, 24);
    const s0 = sampleArc(arc, 0);
    const s1 = sampleArc(arc, 1);
    expect(s0[0]).toBeCloseTo(arc[0]!, 5);
    const lastI = arc.length - 3;
    expect(s1[0]).toBeCloseTo(arc[lastI]!, 5);
    expect(mag(...s0)).toBeCloseTo(1.5, 4);
  });
});

describe('pickRoutes', () => {
  const samples: Array<[number, number]> = [
    [-100, 40],
    [-55, -10],
    [20, 0],
    [100, 60],
    [140, -30],
    [-3, 51],
  ];

  it('is deterministic for a given seed', () => {
    expect(pickRoutes(samples, 4, 7)).toEqual(pickRoutes(samples, 4, 7));
  });

  it('returns distinct, separated endpoint pairs', () => {
    const routes = pickRoutes(samples, 4, 3);
    expect(routes.length).toBeLessThanOrEqual(4);
    for (const [i, j] of routes) {
      expect(i).not.toBe(j);
      const a = samples[i]!;
      const b = samples[j]!;
      expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBeGreaterThanOrEqual(45);
    }
  });

  it('returns nothing when there are too few samples', () => {
    expect(pickRoutes([[0, 0]], 3)).toEqual([]);
  });
});
