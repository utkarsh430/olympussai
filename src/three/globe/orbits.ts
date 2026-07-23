/**
 * Pure orbital-mechanics helpers for the globe's satellite ecosystem
 * (Phase 2, enhancement stage). No `three`, no side effects — unit-tested.
 *
 * An orbit is a circle of `radius`, tilted by `inclination` about the X axis,
 * then rotated by `node` (ascending node) about the Y axis. A satellite is a
 * single point travelling that circle at a given `angle`.
 */
import type { Vec3 } from './geo';

/** A point on an inclined circular orbit. `angle` sweeps the orbit (radians). */
export function orbitPoint(
  radius: number,
  inclination: number,
  node: number,
  angle: number,
): Vec3 {
  // Base circle in the XZ plane.
  const bx = Math.cos(angle) * radius;
  const bz = Math.sin(angle) * radius;
  // Incline about the X axis.
  const ci = Math.cos(inclination);
  const si = Math.sin(inclination);
  const y1 = -bz * si;
  const z1 = bz * ci;
  // Rotate the ascending node about the Y axis.
  const cn = Math.cos(node);
  const sn = Math.sin(node);
  const x2 = bx * cn + z1 * sn;
  const z2 = -bx * sn + z1 * cn;
  return [x2, y1, z2];
}

/** Packed XYZ points tracing one full orbit — suitable for a `THREE.LineLoop`. */
export function orbitRing(
  radius: number,
  inclination: number,
  node: number,
  segments: number,
): Float32Array {
  const arr = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const [x, y, z] = orbitPoint(radius, inclination, node, a);
    arr[i * 3] = x;
    arr[i * 3 + 1] = y;
    arr[i * 3 + 2] = z;
  }
  return arr;
}
