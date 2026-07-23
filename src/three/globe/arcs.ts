/**
 * Pure great-circle arc helpers for the globe's geographic network
 * (Phase 2, enhancement stage). No `three`, no side effects — unit-tested.
 *
 * `greatCircleArc` slerps between two surface points and lifts the path above
 * the sphere (longer routes rise higher), producing the graceful "flight-path"
 * curve. `pickRoutes` deterministically chooses a modest set of land→land
 * endpoints that are far enough apart to arc nicely.
 */
import { latLngToVec3, type Vec3 } from './geo';

function normalize([x, y, z]: Vec3): Vec3 {
  const m = Math.hypot(x, y, z) || 1;
  return [x / m, y / m, z / m];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * A great-circle arc between two geographic points, lifted above the surface.
 * Returns `segments + 1` packed XYZ points. Endpoints sit exactly on `radius`;
 * the maximum lift is `radius * (1 + liftFactor * span/π)` at the midpoint.
 */
export function greatCircleArc(
  latA: number,
  lngA: number,
  latB: number,
  lngB: number,
  radius: number,
  liftFactor: number,
  segments: number,
): Float32Array {
  const a = normalize(latLngToVec3(latA, lngA, 1));
  const b = normalize(latLngToVec3(latB, lngB, 1));
  const omega = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  const sinO = Math.sin(omega);
  const arr = new Float32Array((segments + 1) * 3);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    let px: number;
    let py: number;
    let pz: number;
    if (sinO < 1e-6) {
      px = a[0];
      py = a[1];
      pz = a[2];
    } else {
      const s0 = Math.sin((1 - t) * omega) / sinO;
      const s1 = Math.sin(t * omega) / sinO;
      px = a[0] * s0 + b[0] * s1;
      py = a[1] * s0 + b[1] * s1;
      pz = a[2] * s0 + b[2] * s1;
    }
    const m = Math.hypot(px, py, pz) || 1;
    const lift = 1 + liftFactor * (omega / Math.PI) * Math.sin(t * Math.PI);
    const r = (radius * lift) / m;
    arr[i * 3] = px * r;
    arr[i * 3 + 1] = py * r;
    arr[i * 3 + 2] = pz * r;
  }
  return arr;
}

/** Sample a packed arc buffer at parameter `t` (0..1) → an interpolated point. */
export function sampleArc(arc: Float32Array, t: number): Vec3 {
  const segments = arc.length / 3 - 1;
  const f = Math.max(0, Math.min(1, t)) * segments;
  const i = Math.min(segments - 1, Math.floor(f));
  const frac = f - i;
  const a0 = i * 3;
  const a1 = (i + 1) * 3;
  return [
    arc[a0]! + (arc[a1]! - arc[a0]!) * frac,
    arc[a0 + 1]! + (arc[a1 + 1]! - arc[a0 + 1]!) * frac,
    arc[a0 + 2]! + (arc[a1 + 2]! - arc[a0 + 2]!) * frac,
  ];
}

/**
 * Deterministically choose `count` land→land routes (as index pairs into
 * `samples`) whose endpoints are far enough apart to arc gracefully.
 */
export function pickRoutes(
  samples: ReadonlyArray<readonly [number, number]>,
  count: number,
  seed = 1,
): Array<[number, number]> {
  const routes: Array<[number, number]> = [];
  const n = samples.length;
  if (n < 2) return routes;
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  let attempts = 0;
  while (routes.length < count && attempts < count * 60) {
    attempts++;
    const i = Math.floor(rnd() * n);
    const j = Math.floor(rnd() * n);
    if (i === j) continue;
    const A = samples[i]!;
    const B = samples[j]!;
    // Require some geographic separation for a graceful sweep.
    if (Math.abs(A[0] - B[0]) + Math.abs(A[1] - B[1]) < 45) continue;
    routes.push([i, j]);
  }
  return routes;
}
