import type { LatLng } from '@/lib/depot/types';
import { distanceM } from '@/lib/depot/infer/geo';
import type { RouteProfile, RouteStop } from './types';

export interface DeadKm {
  readonly outKm: number;
  readonly inKm: number;
  /** Sum of the rounded out and in figures, so the three shown together always add up. */
  readonly perTripKm: number;
  readonly firstStopUsed: string;
  readonly lastStopUsed: string;
  /** True when a nearest located stop stood in for an unlocated terminal. */
  readonly approximated: boolean;
}

export interface Terminals {
  readonly first: LocatedStop;
  readonly last: LocatedStop;
  readonly approximated: boolean;
}

const METRES_PER_TENTH_KM = 100;
const TENTHS_PER_KM = 10;

export type LocatedStop = RouteStop & { readonly lat: number; readonly lng: number };

/** A (0, 0) pair is a device default, not a place: it counts as unlocated. */
function isLocated(stop: RouteStop): stop is LocatedStop {
  const { lat, lng } = stop;
  if (lat === null || lng === null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return !(lat === 0 && lng === 0);
}

/**
 * The stops a bus really drives to. An unlocated end falls back to the nearest
 * located stop inward, and the result says so; two terminals that collapse to
 * one stop mean there is no route to measure.
 */
export function terminalsOf(profile: RouteProfile): Terminals | null {
  const ordered = [...profile.stops].sort((a, b) => a.sequence - b.sequence);
  const located = ordered.filter(isLocated);
  if (located.length < 2) return null;
  const first = located[0]!;
  const last = located[located.length - 1]!;
  const approximated = first !== ordered[0] || last !== ordered[ordered.length - 1];
  return { first, last, approximated };
}

function toTenthsKm(metres: number): number {
  return Math.round(metres / METRES_PER_TENTH_KM) / TENTHS_PER_KM;
}

/**
 * Empty kilometres per trip between a depot yard and a route's terminals.
 * Distances are rounded to whole metres once; every kilometre figure derives
 * from those integers so nothing carries float residue into later sums.
 */
export function deadKmFor(yard: LatLng, profile: RouteProfile, detourFactor: number): DeadKm | null {
  if (!Number.isFinite(yard.lat) || !Number.isFinite(yard.lng)) return null;
  if (!Number.isFinite(detourFactor) || detourFactor <= 0) return null;
  const terminals = terminalsOf(profile);
  if (terminals === null) return null;
  const { first, last } = terminals;
  const road = (stop: LocatedStop): number =>
    Math.round(distanceM(yard.lat, yard.lng, stop.lat, stop.lng) * detourFactor);
  const outM = road(first);
  const inM = road(last);
  if (!Number.isFinite(outM) || !Number.isFinite(inM)) return null;
  return {
    outKm: toTenthsKm(outM),
    inKm: toTenthsKm(inM),
    perTripKm: (Math.round(outM / METRES_PER_TENTH_KM) + Math.round(inM / METRES_PER_TENTH_KM)) / TENTHS_PER_KM,
    firstStopUsed: first.name,
    lastStopUsed: last.name,
    approximated: terminals.approximated,
  };
}
