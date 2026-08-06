/**
 * Pure, server-agnostic view helpers over a fleet snapshot (filtering,
 * grouping). Deliberately has no 'server-only' guard and does no I/O, so it
 * can be imported by both the Server Component dashboard pages and by
 * plain component/unit tests without pulling in next/headers or a fetch
 * call — see src/lib/ops/fleetData.ts for the actual data source, which is
 * server-only.
 */
import type { CanonicalLiveBus } from '@/models/canonical';

/** Case-insensitive substring match against registration, route id/name, or depot. */
export function filterFleet(buses: CanonicalLiveBus[], query: string | null | undefined): CanonicalLiveBus[] {
  const q = query?.trim().toLowerCase();
  if (!q) return buses;
  return buses.filter((bus) =>
    [bus.registrationNumber, bus.routeId, bus.routeName, bus.serviceNumber, bus.depotName]
      .filter((v): v is string => Boolean(v))
      .some((v) => v.toLowerCase().includes(q)),
  );
}

export interface FleetGroup {
  key: string;
  label: string;
  buses: CanonicalLiveBus[];
}

/** Groups buses by depot name for the depot dashboard's vehicle roster. */
export function groupByDepot(buses: CanonicalLiveBus[]): FleetGroup[] {
  const groups = new Map<string, CanonicalLiveBus[]>();
  for (const bus of buses) {
    const key = bus.depotName ?? 'Unassigned depot';
    const bucket = groups.get(key);
    if (bucket) bucket.push(bus);
    else groups.set(key, [bus]);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, label: key, buses: list }))
    .sort((a, b) => b.buses.length - a.buses.length);
}

/** Groups buses by route for the planner dashboard's route/schedule roster. */
export function groupByRoute(buses: CanonicalLiveBus[]): FleetGroup[] {
  const groups = new Map<string, { label: string; buses: CanonicalLiveBus[] }>();
  for (const bus of buses) {
    const key = bus.routeId ?? bus.routeName ?? 'Unassigned route';
    const label = bus.routeName ?? bus.routeId ?? 'Unassigned route';
    const bucket = groups.get(key);
    if (bucket) bucket.buses.push(bus);
    else groups.set(key, { label, buses: [bus] });
  }
  return [...groups.entries()]
    .map(([key, { label, buses: list }]) => ({ key, label, buses: list }))
    .sort((a, b) => b.buses.length - a.buses.length);
}
