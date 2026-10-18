import { haversineKm } from '../../../simulation/seededRandom';
import type { FleetBus } from '../fleetIndex';

/**
 * Possible bunching from the GPS feed: buses moving on the same route closer together than
 * a threshold. The feed carries no heading and no route geometry, so a close pair may be
 * two buses passing in opposite directions; every pair is "possible" until the operations
 * bunching module, which knows the stops and the direction, confirms it.
 */

export const BUNCH_KM = 1;

export interface BunchedPair {
  readonly a: string;
  readonly b: string;
  readonly km: number;
}

export interface RouteHeadway {
  readonly routeName: string;
  readonly moving: number;
  readonly depots: readonly string[];
  readonly pairs: readonly BunchedPair[];
  /** Closest gap between two moving buses on the route, km. */
  readonly closestKm: number | null;
  /** Share of moving buses that are in a close pair. */
  readonly bunchedShare: number;
}

const MOVING = new Set(['in_service', 'on_road']);

export function routeHeadways(fleet: readonly FleetBus[]): RouteHeadway[] {
  const byRoute = new Map<string, FleetBus[]>();
  for (const b of fleet) {
    if (!b.routeName || !MOVING.has(b.state) || b.lat === null || b.lng === null) continue;
    const held = byRoute.get(b.routeName);
    if (held) held.push(b);
    else byRoute.set(b.routeName, [b]);
  }
  const out: RouteHeadway[] = [];
  for (const [routeName, buses] of byRoute) {
    if (buses.length < 2) continue;
    const pairs: BunchedPair[] = [];
    let closest: number | null = null;
    for (let i = 0; i < buses.length; i += 1) {
      for (let j = i + 1; j < buses.length; j += 1) {
        const p = buses[i]!;
        const q = buses[j]!;
        const km = haversineKm(p.lat!, p.lng!, q.lat!, q.lng!);
        if (closest === null || km < closest) closest = km;
        if (km <= BUNCH_KM) pairs.push({ a: p.registration, b: q.registration, km: Math.round(km * 100) / 100 });
      }
    }
    const inPair = new Set(pairs.flatMap((p) => [p.a, p.b]));
    out.push({
      routeName,
      moving: buses.length,
      depots: [...new Set(buses.map((b) => b.depotId).filter((d): d is string => d !== null))],
      pairs: pairs.sort((x, y) => x.km - y.km),
      closestKm: closest === null ? null : Math.round(closest * 100) / 100,
      bunchedShare: inPair.size / buses.length,
    });
  }
  return out.sort((x, y) => y.pairs.length - x.pairs.length || (x.closestKm ?? 1e9) - (y.closestKm ?? 1e9) || x.routeName.localeCompare(y.routeName));
}
