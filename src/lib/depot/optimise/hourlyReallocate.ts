import { deadKmFor } from '../routes/deadKm';
import type { RouteProfile } from '../routes/types';
import { HOLD_KEEP_MIN } from '../service/proposalConfig';
import type {
  BandReallocation,
  ReallocationMove,
  ReallocationUncovered,
  ServiceBandKey,
} from '../service/types';
import type { LatLng } from '../types';
import { minCostMaxFlow, type FlowEdgeInput } from './minCostFlow';
import { roadDistanceKm } from './rebalance';

/*
 * The hourly reallocation: in one band of the day, each depot's surplus (the buses its
 * over-served routes could release, keeping one bus on each, plus its standing pool) goes
 * to the short routes, by minimum-cost maximum flow. A move within the depot that runs the
 * route costs nothing; a move from another depot costs its dead km there and back, and is
 * not offered beyond `MAX_INTRA_DAY_KM`. Recommendation only; deterministic.
 */

/**
 * The most empty km, there and back, worth driving one bus to another depot's route within
 * the day (REFERENCE): beyond it the band is over before the bus is useful.
 */
export const MAX_INTRA_DAY_KM = 60;

const TENTHS_PER_KM = 10;

export interface ReallocationDepot {
  readonly depotId: string;
  readonly depotName: string;
  /** Yard centre, else the median of its buses; null when neither is known. */
  readonly position: LatLng | null;
  /** Buses standing ready in the band: observed in the yard, else the day plan's idle buses. */
  readonly standing: number;
}

export interface ReallocationRoute {
  readonly routeName: string;
  /** The depot running most of the route's buses; null when none is known. */
  readonly depotId: string | null;
  /** The band's mean gap: positive short, negative over. */
  readonly gap: number;
  /** The band's mean deployed buses. */
  readonly deployed: number;
  /** The route's loaded profile, for the dead km from another depot; null when not loaded. */
  readonly profile: RouteProfile | null;
}

export interface HourlyReallocationInput {
  readonly band: ServiceBandKey;
  readonly depots: readonly ReallocationDepot[];
  readonly routes: readonly ReallocationRoute[];
  readonly detourFactor: number;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Buses an over route can release in the band while keeping its minimum on the road. */
export function releasableBuses(route: Pick<ReallocationRoute, 'gap' | 'deployed'>): number {
  const over = Math.round(-route.gap);
  return Math.max(0, Math.min(over, Math.floor(route.deployed) - HOLD_KEEP_MIN));
}

interface Giver {
  readonly depotId: string;
  readonly depotName: string;
  readonly position: LatLng | null;
  readonly surplus: number;
}

function giversOf(input: HourlyReallocationInput): Giver[] {
  const held = new Map<string, number>();
  for (const r of input.routes) {
    if (r.depotId !== null) held.set(r.depotId, (held.get(r.depotId) ?? 0) + releasableBuses(r));
  }
  const known = new Map(input.depots.map((d) => [d.depotId, d] as const));
  const ids = [...new Set([...known.keys(), ...held.keys()])].sort(byText);
  return ids
    .map((id) => {
      const d = known.get(id);
      const surplus = Math.max(0, Math.floor(d?.standing ?? 0)) + (held.get(id) ?? 0);
      return { depotId: id, depotName: d?.depotName ?? id, position: d?.position ?? null, surplus };
    })
    .filter((g) => g.surplus > 0);
}

/** Dead km in tenths, there and back, from a giver to the route; null when it cannot be measured. */
function deadTenths(giver: Giver, route: ReallocationRoute, home: LatLng | null, detour: number): number | null {
  if (giver.position === null) return null;
  const viaProfile = route.profile === null ? null : deadKmFor(giver.position, route.profile, detour)?.perTripKm;
  const km = viaProfile ?? (home === null ? null : 2 * roadDistanceKm(giver.position, home, detour));
  return km === null || km === undefined ? null : Math.round(km * TENTHS_PER_KM);
}

/** The band's moves and what is left uncovered, each with the first reason that applies. */
export function planHourlyReallocation(input: HourlyReallocationInput): BandReallocation {
  const givers = giversOf(input);
  const positions = new Map(input.depots.map((d) => [d.depotId, d.position] as const));
  const short = input.routes
    .map((r) => ({ route: r, buses: Math.round(r.gap) }))
    .filter((s) => s.buses > 0)
    .sort((a, b) => byText(a.route.routeName, b.route.routeName));
  const sink = 1 + givers.length + short.length;
  const edges: FlowEdgeInput[] = givers.map((g, i) => ({ from: 0, to: 1 + i, capacity: g.surplus, cost: 0 }));
  const pairs: { edge: number; giver: number; route: number; tenths: number }[] = [];
  const measurable = new Set<number>();
  short.forEach((s, j) => {
    const home = s.route.depotId === null ? null : (positions.get(s.route.depotId) ?? null);
    givers.forEach((g, i) => {
      const within = g.depotId === s.route.depotId;
      const tenths = within ? 0 : deadTenths(g, s.route, home, input.detourFactor);
      if (tenths === null) return;
      measurable.add(j);
      if (tenths > MAX_INTRA_DAY_KM * TENTHS_PER_KM) return;
      pairs.push({ edge: edges.length, giver: i, route: j, tenths });
      edges.push({ from: 1 + i, to: 1 + givers.length + j, capacity: Math.min(g.surplus, s.buses), cost: tenths });
    });
    edges.push({ from: 1 + givers.length + j, to: sink, capacity: s.buses, cost: 0 });
  });
  const result = minCostMaxFlow(sink + 1, edges, 0, sink);

  const received = new Array<number>(short.length).fill(0);
  const reachable = new Set(pairs.map((p) => p.route));
  const moves: ReallocationMove[] = [];
  for (const p of pairs) {
    const buses = result.edgeFlows[p.edge] ?? 0;
    if (buses <= 0) continue;
    const g = givers[p.giver] as Giver;
    const r = (short[p.route] as (typeof short)[number]).route;
    received[p.route] = (received[p.route] ?? 0) + buses;
    const toName = input.depots.find((d) => d.depotId === r.depotId)?.depotName ?? r.depotId;
    moves.push({
      fromDepotId: g.depotId,
      fromDepotName: g.depotName,
      toDepotId: r.depotId,
      toDepotName: toName,
      routeName: r.routeName,
      buses,
      withinDepot: p.tenths === 0 && g.depotId === r.depotId,
      deadKmPerBus: p.tenths / TENTHS_PER_KM,
    });
  }
  moves.sort(
    (a, b) =>
      Number(b.withinDepot) - Number(a.withinDepot) ||
      b.buses - a.buses ||
      byText(a.fromDepotId, b.fromDepotId) ||
      byText(a.routeName, b.routeName),
  );

  const uncovered: ReallocationUncovered[] = short.flatMap((s, j) => {
    const buses = s.buses - (received[j] ?? 0);
    if (buses <= 0) return [];
    const reason: ReallocationUncovered['reason'] = reachable.has(j)
      ? 'insufficient_surplus'
      : measurable.has(j) || givers.length === 0
        ? 'no_surplus_in_range'
        : 'no_position';
    return [{ routeName: s.route.routeName, depotId: s.route.depotId, buses, reason }];
  });
  const sum = (ms: readonly ReallocationMove[]): number => ms.reduce((t, m) => t + m.buses, 0);
  const deadTenthsTotal = moves.reduce((t, m) => t + m.buses * Math.round(m.deadKmPerBus * TENTHS_PER_KM), 0);
  return {
    band: input.band,
    moves,
    uncovered,
    busesWithin: sum(moves.filter((m) => m.withinDepot)),
    busesBetween: sum(moves.filter((m) => !m.withinDepot)),
    deadKm: deadTenthsTotal / TENTHS_PER_KM,
  };
}
