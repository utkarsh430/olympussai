/**
 * Deterministic seeded randomness.
 *
 * Every simulated scenario is seeded from the selected bus's registration
 * number, so the same bus always produces the same demonstration. This makes
 * the pitch repeatable — the Director sees identical figures on a re-run.
 */

/** FNV-1a string hash → 32-bit unsigned seed. */
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32 PRNG — small, fast, good enough for presentation jitter. */
export function createRandom(seed: string | number): () => number {
  let state = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SeededRandom {
  private readonly next: () => number;

  constructor(seed: string | number) {
    this.next = createRandom(seed);
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  /** Rounded to `decimals` places. */
  fixed(min: number, max: number, decimals = 1): number {
    const factor = 10 ** decimals;
    return Math.round(this.float(min, max) * factor) / factor;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('SeededRandom.pick called with an empty array');
    return items[this.int(0, items.length - 1)] as T;
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }
}

/** Offset a lat/lng by a distance and bearing — used to place simulated markers. */
export function offsetCoordinate(
  latitude: number,
  longitude: number,
  distanceKm: number,
  bearingDegrees: number,
): { latitude: number; longitude: number } {
  const EARTH_RADIUS_KM = 6371;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const lat1 = (latitude * Math.PI) / 180;
  const lng1 = (longitude * Math.PI) / 180;
  const angular = distanceKm / EARTH_RADIUS_KM;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (((lng2 * 180) / Math.PI + 540) % 360) - 180,
  };
}

/** Great-circle distance in km. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
