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

export interface StandbyCandidate {
  bus: CanonicalLiveBus;
  /** Minutes since this vehicle's last live update, or null if unparseable — surfaced so a dispatcher can judge how current the "standby" read is, not just trust the label. */
  idleMinutes: number | null;
}

/**
 * Best-effort "available for standby injection" read over the live fleet
 * feed (this ticket's AC1: "standby availability"). There is no dedicated
 * standby/duty-roster table anywhere in this system yet (upstream UPSRTC
 * data and control-service's schema both stop short of that) — this is a
 * heuristic over real fields only: ignition on (or unknown) and no active
 * trip assignment, which is the closest a live-GPS feed can say to "this
 * bus is running but not currently on a scheduled service". Sorted most-
 * recently-reporting first, since a stale GPS read is a weaker signal of
 * genuine availability. Always label this as a heuristic in the UI — never
 * present it as an authoritative duty-roster standby designation.
 */
export function deriveStandbyAvailability(buses: CanonicalLiveBus[], now: number = Date.now()): StandbyCandidate[] {
  return buses
    .filter((bus) => bus.tripId === null && bus.ignitionOn !== false)
    .map((bus) => {
      const updatedAtMs = Date.parse(bus.lastUpdatedAt);
      const idleMinutes = Number.isNaN(updatedAtMs) ? null : Math.round((now - updatedAtMs) / 60_000);
      return { bus, idleMinutes };
    })
    .sort((a, b) => (a.idleMinutes ?? Infinity) - (b.idleMinutes ?? Infinity));
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
