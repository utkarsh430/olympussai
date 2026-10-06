import { SeededRandom } from '../../simulation/seededRandom';
import type { Duty } from '../duties/types';
import type { DepotSummary } from '../types';
import { ROUTE_TOKEN_CLASS, SERVICE_CLASS_PRIORITY } from './config';
import { seedFor } from './seed';
import type { ServiceClass } from './types';

const EARLIEST_START_MIN = 240; // 04:00
const LATEST_START_MIN = 1320; // 22:00
/** The morning peak is a triangle over 04:00-10:00 centred on 07:00. */
const PEAK_WINDOW_MIN = { from: 240, to: 600 } as const;
/** Share of duties drawn from the morning peak; the rest spread evenly across the day. */
const PEAK_SHARE = 0.65;
const ROUND_TO_MIN = 5;
const LAYOVER_MIN = 30;
const UNKNOWN_DURATION_MIN = { from: 240, to: 600 } as const; // 4 to 10 hours
const MAX_DURATION_MIN = 960; // 16 hours

function roundToFive(minutes: number): number {
  return Math.round(minutes / ROUND_TO_MIN) * ROUND_TO_MIN;
}

/**
 * The most specific class named by a whole underscore-separated token of the
 * route name. Mirrors fleetMaster's rule (its helper is not exported) using the
 * shared token table and priority, so a route and its buses agree.
 */
function classOfRoute(routeName: string): ServiceClass {
  const named = new Set<ServiceClass>();
  for (const token of routeName.toUpperCase().split('_')) {
    const found = ROUTE_TOKEN_CLASS[token];
    if (found !== undefined) named.add(found);
  }
  return SERVICE_CLASS_PRIORITY.find((c) => named.has(c)) ?? 'ordinary';
}

/**
 * Start minute: with probability PEAK_SHARE a triangular morning peak (the mean
 * of two uniforms over 04:00-10:00, so it clusters near 07:00), otherwise
 * uniform over 04:00-22:00. Both draws are always taken so the stream stays
 * aligned whichever branch is used.
 */
function drawStart(rng: SeededRandom): number {
  const branch = rng.float(0, 1);
  const a = rng.float(PEAK_WINDOW_MIN.from, PEAK_WINDOW_MIN.to);
  const b = rng.float(PEAK_WINDOW_MIN.from, PEAK_WINDOW_MIN.to);
  const flat = rng.float(EARLIEST_START_MIN, LATEST_START_MIN);
  const raw = branch < PEAK_SHARE ? (a + b) / 2 : flat;
  return Math.min(LATEST_START_MIN, Math.max(EARLIEST_START_MIN, roundToFive(raw)));
}

function isKnown(minutes: number | null): minutes is number {
  return minutes !== null && Number.isFinite(minutes) && minutes > 0;
}

/**
 * The depot's modelled duties for one operating date: exactly
 * `peakRequirement` of them, one per bus the depot needs at peak. Zero when the
 * requirement is zero, and none when the depot has no routes (there is nothing
 * to run a duty on). Routes are dealt round-robin in name order so every route
 * gets a duty before any gets two; duplicate names collapse to the first.
 * A route with a known scheduled duration runs out and back plus a layover,
 * otherwise the duration is a seeded 4-10 hours. Start times depend on the
 * date; the count and route spread do not.
 */
export function modelDuties(
  depot: DepotSummary,
  routes: readonly { routeName: string; scheduledDurationMin: number | null }[],
  peakRequirement: number,
  operatingDate: string,
): Duty[] {
  if (!Number.isInteger(peakRequirement) || peakRequirement < 0) {
    throw new RangeError(`peakRequirement must be a non-negative integer, got ${peakRequirement}`);
  }
  const byName = new Map<string, number | null>();
  for (const route of routes) {
    if (!byName.has(route.routeName)) byName.set(route.routeName, route.scheduledDurationMin);
  }
  const names = [...byName.keys()].sort();
  if (peakRequirement === 0 || names.length === 0) return [];

  const rng = new SeededRandom(seedFor(depot.id, operatingDate, 'duties'));
  const duties: Duty[] = [];
  for (let index = 0; index < peakRequirement; index += 1) {
    const routeName = names[index % names.length];
    const scheduled = byName.get(routeName) ?? null;
    const startMin = drawStart(rng);
    const unknown = roundToFive(rng.float(UNKNOWN_DURATION_MIN.from, UNKNOWN_DURATION_MIN.to));
    const duration = Math.min(
      MAX_DURATION_MIN,
      isKnown(scheduled) ? roundToFive(scheduled * 2 + LAYOVER_MIN) : unknown,
    );
    duties.push({
      id: `${depot.id}-${operatingDate}-${String(index).padStart(3, '0')}`,
      depotId: depot.id,
      routeName,
      startMin,
      endMin: startMin + duration,
      serviceClass: classOfRoute(routeName),
      provenance: 'modelled',
    });
  }
  return duties.sort((x, y) => x.startMin - y.startMin || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}
