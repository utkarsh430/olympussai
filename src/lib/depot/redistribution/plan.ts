import { cellCoverage, hoursOf } from './metrics';
import { depotName, routesOf } from './scenario';
import type {
  AvailabilityGrid,
  Feasibility,
  Recommendation,
  RedistributionPlan,
  Scenario,
  ScenarioRoute,
  Selection,
  UnresolvedReason,
  UnresolvedShortage,
} from './types';
import { recommendationReason } from './wording';

/*
 * The redistribution engine: a deterministic, greedy matching of short route-hours to
 * routes holding spare buses in the same hours. Largest passenger impact first; a donor is
 * taken from the same depot before another depot within reach; a bus is committed from the
 * hour it leaves its donor until the end of the hours it serves, so it can never be
 * promised twice; a donor never drops below its own need. Pure.
 */

/** A depot further than this by road cannot lend a bus for the same band of the day. */
export const MAX_CROSS_DEPOT_KM = 100;
/** Repositioning within a depot's city, in minutes: a floor, a ceiling and the per-kilometre cost. */
const SAME_DEPOT_REPOSITION = { base: 10, perKm: 1.5, min: 15, max: 45 } as const;
/** Between depots: terminal-to-terminal at about 48 km/h plus leaving the yard. */
const CROSS_DEPOT_REPOSITION = { base: 20, perKm: 1.25 } as const;
/** A bus arrives this long before the hour it is to serve. */
const ARRIVAL_BUFFER_MIN = 5;
/** Up to this many donors may fill one short route-hour. */
const MAX_DONORS_PER_CELL = 3;
const MINUTES_PER_HOUR = 60;
const FEASIBILITY_HIGH_MIN = 30;
const FEASIBILITY_MEDIUM_MIN = 60;

interface ShortCell {
  readonly route: ScenarioRoute;
  readonly hour: number;
  readonly gap: number;
  readonly unmetPassengers: number;
}

function repositionMinutes(from: ScenarioRoute, to: ScenarioRoute, depotKm: number): number {
  if (from.depotId === to.depotId) {
    const raw = SAME_DEPOT_REPOSITION.base + Math.abs(from.terminalKm - to.terminalKm) * SAME_DEPOT_REPOSITION.perKm;
    return Math.round(Math.min(SAME_DEPOT_REPOSITION.max, Math.max(SAME_DEPOT_REPOSITION.min, raw)));
  }
  return Math.round(CROSS_DEPOT_REPOSITION.base + depotKm * CROSS_DEPOT_REPOSITION.perKm);
}

function feasibilityOf(sameDepot: boolean, repositionMin: number): Feasibility {
  if (sameDepot && repositionMin <= FEASIBILITY_HIGH_MIN) return 'high';
  return repositionMin <= FEASIBILITY_MEDIUM_MIN ? 'medium' : 'low';
}

/** Short route-hours in the window, the largest unmet passenger load first. */
function shortCells(routes: readonly ScenarioRoute[], avail: ReadonlyMap<string, number[]>, selection: Selection): ShortCell[] {
  const cells: ShortCell[] = [];
  for (const route of routes) {
    const have = avail.get(route.id) as number[];
    for (const hour of hoursOf(selection)) {
      const need = route.required[hour] ?? 0;
      const gap = need - (have[hour] ?? 0);
      if (gap <= 0) continue;
      const demand = route.demand[hour] ?? 0;
      cells.push({ route, hour, gap, unmetPassengers: demand * (1 - cellCoverage(need, have[hour] ?? 0)) });
    }
  }
  return cells.sort((a, b) => b.unmetPassengers - a.unmetPassengers || b.gap - a.gap || a.route.id.localeCompare(b.route.id));
}

interface Donor {
  readonly route: ScenarioRoute;
  readonly repositionMin: number;
  readonly donorFromHour: number;
  readonly spare: number;
}

/** The surplus of a route at an hour under the working availability. */
const spareAt = (route: ScenarioRoute, hour: number, avail: ReadonlyMap<string, number[]>): number =>
  ((avail.get(route.id) as number[])[hour] ?? 0) - (route.required[hour] ?? 0);

/** Donors that can lend at least one bus from the hour they leave through the target hour, best first. */
function donorsFor(
  scenario: Scenario,
  target: ShortCell,
  routes: readonly ScenarioRoute[],
  avail: ReadonlyMap<string, number[]>,
  crossDepot: boolean,
): Donor[] {
  const donors: Donor[] = [];
  for (const route of routes) {
    if (route.id === target.route.id) continue;
    const sameDepot = route.depotId === target.route.depotId;
    const depotKm = sameDepot ? 0 : (scenario.depots.find((d) => d.id === route.depotId)?.distanceKm[target.route.depotId] ?? Infinity);
    if (!sameDepot && (!crossDepot || depotKm > MAX_CROSS_DEPOT_KM)) continue;
    const repositionMin = repositionMinutes(route, target.route, depotKm);
    const leaveMin = target.hour * MINUTES_PER_HOUR - ARRIVAL_BUFFER_MIN - repositionMin;
    if (leaveMin < 0) continue;
    const donorFromHour = Math.floor(leaveMin / MINUTES_PER_HOUR);
    let spare = Infinity;
    for (let h = donorFromHour; h <= target.hour; h += 1) spare = Math.min(spare, spareAt(route, h, avail));
    if (spare < 1) continue;
    donors.push({ route, repositionMin, donorFromHour, spare });
  }
  return donors.sort(
    (a, b) =>
      Number(b.route.depotId === target.route.depotId) - Number(a.route.depotId === target.route.depotId) ||
      a.repositionMin - b.repositionMin ||
      b.spare - a.spare ||
      a.route.id.localeCompare(b.route.id),
  );
}

/** The last target hour the move can serve: the destination stays short by `buses` and the donor spare. */
function spanEnd(target: ShortCell, donor: Donor, buses: number, avail: ReadonlyMap<string, number[]>, toHour: number): number {
  let end = target.hour;
  while (end + 1 <= toHour) {
    const next = end + 1;
    const destGap = (target.route.required[next] ?? 0) - ((avail.get(target.route.id) as number[])[next] ?? 0);
    if (destGap < buses || spareAt(donor.route, next, avail) < buses) break;
    end = next;
  }
  return end;
}

function coverageOver(route: ScenarioRoute, have: readonly number[], from: number, to: number): number {
  let demand = 0;
  let covered = 0;
  for (let h = from; h <= to; h += 1) {
    const d = route.demand[h] ?? 0;
    demand += d;
    covered += d * cellCoverage(route.required[h] ?? 0, have[h] ?? 0);
  }
  return demand === 0 ? 1 : covered / demand;
}

function passengersCarried(route: ScenarioRoute, have: readonly number[], buses: number, from: number, to: number): number {
  let pax = 0;
  for (let h = from; h <= to; h += 1) {
    const need = route.required[h] ?? 0;
    if (need <= 0) continue;
    const gap = Math.max(0, need - (have[h] ?? 0));
    pax += Math.min(buses, gap) * ((route.demand[h] ?? 0) / need);
  }
  return Math.round(pax);
}

/** The engine's plan for the selection: every feasible move, and what stays short after all of them. */
export function buildPlan(scenario: Scenario, selection: Selection): RedistributionPlan {
  const routes = routesOf(scenario, selection.depotId);
  const avail = new Map<string, number[]>(routes.map((r) => [r.id, [...r.available]]));
  const crossDepot = selection.depotId === null;
  const recommendations: Recommendation[] = [];

  for (const cell of shortCells(routes, avail, selection)) {
    let donorsUsed = 0;
    for (const donor of donorsFor(scenario, cell, routes, avail, crossDepot)) {
      if (donorsUsed >= MAX_DONORS_PER_CELL) break;
      const destHave = avail.get(cell.route.id) as number[];
      const gapNow = (cell.route.required[cell.hour] ?? 0) - (destHave[cell.hour] ?? 0);
      if (gapNow <= 0) break;
      const buses = Math.min(gapNow, donor.spare);
      if (buses < 1) continue;
      const end = spanEnd(cell, donor, buses, avail, selection.toHour);
      const before = [...destHave];
      const donorHave = avail.get(donor.route.id) as number[];
      for (let h = donor.donorFromHour; h <= end; h += 1) donorHave[h] = (donorHave[h] ?? 0) - buses;
      for (let h = cell.hour; h <= end; h += 1) destHave[h] = (destHave[h] ?? 0) + buses;
      donorsUsed += 1;

      const sameDepot = donor.route.depotId === cell.route.depotId;
      const arriveMin = cell.hour * MINUTES_PER_HOUR - ARRIVAL_BUFFER_MIN;
      const gapBusHours = buses * (end - cell.hour + 1);
      const rec: Recommendation = {
        id: `${donor.route.id}>${cell.route.id}@${cell.hour}`,
        ordinal: 0,
        fromRouteId: donor.route.id,
        toRouteId: cell.route.id,
        fromDepotId: donor.route.depotId,
        toDepotId: cell.route.depotId,
        buses,
        repositionStartMin: arriveMin - donor.repositionMin,
        repositionEndMin: arriveMin,
        repositionMin: donor.repositionMin,
        targetFromHour: cell.hour,
        targetToHour: end,
        gapBusHours,
        passengersServed: passengersCarried(cell.route, before, buses, cell.hour, end),
        coverageBefore: coverageOver(cell.route, before, cell.hour, end),
        coverageAfter: coverageOver(cell.route, destHave, cell.hour, end),
        feasibility: feasibilityOf(sameDepot, donor.repositionMin),
        reason: '',
      };
      recommendations.push({
        ...rec,
        reason: recommendationReason(rec, cell.route, donor.route, sameDepot ? null : depotName(scenario, donor.route.depotId), donor.spare),
      });
    }
  }

  const ordered = [...recommendations]
    .sort((a, b) => b.passengersServed - a.passengersServed || b.gapBusHours - a.gapBusHours || a.id.localeCompare(b.id))
    .map((r, i) => ({ ...r, ordinal: i + 1 }));
  const grid: AvailabilityGrid = new Map([...avail.entries()].map(([id, have]) => [id, [...have]] as const));
  return { selection, recommendations: ordered, unresolved: unresolvedIn(scenario, routes, grid, selection) };
}

/** Availability after only the given moves: a subset of the plan is always feasible, since the plan never promised a bus twice. */
export function projectedAvailability(
  scenario: Scenario,
  recommendations: readonly Recommendation[],
  includedIds: ReadonlySet<string>,
): AvailabilityGrid {
  const avail = new Map<string, number[]>(scenario.routes.map((r) => [r.id, [...r.available]]));
  for (const rec of recommendations) {
    if (!includedIds.has(rec.id)) continue;
    const donor = avail.get(rec.fromRouteId);
    const dest = avail.get(rec.toRouteId);
    if (!donor || !dest) continue;
    const donorFrom = Math.floor(rec.repositionStartMin / MINUTES_PER_HOUR);
    for (let h = donorFrom; h <= rec.targetToHour; h += 1) donor[h] = (donor[h] ?? 0) - rec.buses;
    for (let h = rec.targetFromHour; h <= rec.targetToHour; h += 1) dest[h] = (dest[h] ?? 0) + rec.buses;
  }
  return avail;
}

/** Why a short route-hour stays short, from where spare buses stood before any move. */
function reasonFor(scenario: Scenario, route: ScenarioRoute, hour: number, crossDepot: boolean): UnresolvedReason {
  const sameDepotSpare = scenario.routes.some(
    (r) => r.id !== route.id && r.depotId === route.depotId && (r.available[hour] ?? 0) > (r.required[hour] ?? 0),
  );
  if (sameDepotSpare) return 'surplus_exhausted';
  const depot = scenario.depots.find((d) => d.id === route.depotId);
  const elsewhere = scenario.routes.filter((r) => r.depotId !== route.depotId && (r.available[hour] ?? 0) > (r.required[hour] ?? 0));
  if (elsewhere.length === 0) return 'no_surplus';
  const inReach = crossDepot && elsewhere.some((r) => (depot?.distanceKm[r.depotId] ?? Infinity) <= MAX_CROSS_DEPOT_KM);
  return inReach ? 'surplus_exhausted' : 'out_of_reach';
}

/** The routes still short under a grid, each with its hours and the commonest reason. */
export function unresolvedIn(
  scenario: Scenario,
  routes: readonly ScenarioRoute[],
  grid: AvailabilityGrid,
  selection: Selection,
): readonly UnresolvedShortage[] {
  const crossDepot = selection.depotId === null;
  const out: UnresolvedShortage[] = [];
  for (const route of routes) {
    const have = grid.get(route.id) ?? route.available;
    const hours = hoursOf(selection).filter((h) => (route.required[h] ?? 0) - (have[h] ?? 0) > 0);
    if (hours.length === 0) continue;
    const gaps = hours.map((h) => (route.required[h] ?? 0) - (have[h] ?? 0));
    const reasons = hours.map((h) => reasonFor(scenario, route, h, crossDepot));
    const commonest = (['surplus_exhausted', 'out_of_reach', 'no_surplus'] as const)
      .map((r) => ({ r, n: reasons.filter((x) => x === r).length }))
      .sort((a, b) => b.n - a.n)[0]?.r ?? 'no_surplus';
    out.push({
      routeId: route.id,
      depotId: route.depotId,
      hours,
      peakShortage: Math.max(...gaps),
      busHours: gaps.reduce((s, g) => s + g, 0),
      reason: commonest,
    });
  }
  return out.sort((a, b) => b.busHours - a.busHours || a.routeId.localeCompare(b.routeId));
}
