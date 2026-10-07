import { SeededRandom } from '../../simulation/seededRandom';
import type { Duty, ModelledDuties } from '../duties/types';
import type { DepotSummary } from '../types';
import { seedFor } from './seed';
import { classFromRoute } from './fleetMaster';

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
 * Start minute: with probability PEAK_SHARE a triangular morning peak (the mean
 * of two uniforms over 04:00-10:00, so it clusters near 07:00), otherwise
 * uniform over 04:00-22:00. Both draws are always taken so the stream stays
 * aligned whichever branch is used. Exported so a route's own buses start
 * their day by exactly the depot roll's rule.
 */
export function drawDutyStart(rng: SeededRandom): number {
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

/** One duty's start and end minute of the operating day. */
export interface DutySpan {
  readonly startMin: number;
  readonly endMin: number;
}

/**
 * Draws one duty from the stream: its start (see drawDutyStart), then its length.
 * A route with a known scheduled duration runs out and back plus a layover;
 * otherwise a seeded 4-10 hours; never more than 16 hours. The unknown length
 * is always drawn so the stream stays aligned whichever is used.
 */
function drawDutySpan(rng: SeededRandom, scheduledDurationMin: number | null): DutySpan {
  const startMin = drawDutyStart(rng);
  const unknown = roundToFive(rng.float(UNKNOWN_DURATION_MIN.from, UNKNOWN_DURATION_MIN.to));
  const duration = Math.min(
    MAX_DURATION_MIN,
    isKnown(scheduledDurationMin) ? roundToFive(scheduledDurationMin * 2 + LAYOVER_MIN) : unknown,
  );
  return { startMin, endMin: startMin + duration };
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
 *
 * When the requirement is smaller than the number of routes, duties go to routes in
 * alphabetical order, so the last routes get none; `routesWithoutDuty` lists them
 * (alphabetical) so a screen can say so.
 */
export function modelDuties(
  depot: DepotSummary,
  routes: readonly { readonly routeName: string; readonly scheduledDurationMin: number | null }[],
  peakRequirement: number,
  operatingDate: string,
): ModelledDuties {
  if (!Number.isInteger(peakRequirement) || peakRequirement < 0) {
    throw new RangeError(`peakRequirement must be a non-negative integer, got ${peakRequirement}`);
  }
  const byName = new Map<string, number | null>();
  for (const route of routes) {
    if (!byName.has(route.routeName)) byName.set(route.routeName, route.scheduledDurationMin);
  }
  const names = [...byName.keys()].sort();
  if (peakRequirement === 0 || names.length === 0) {
    return { duties: [], routesWithoutDuty: names };
  }

  const rng = new SeededRandom(seedFor(depot.id, operatingDate, 'duties'));
  const duties: Duty[] = [];
  for (let index = 0; index < peakRequirement; index += 1) {
    const routeName = names[index % names.length] as string;
    const { startMin, endMin } = drawDutySpan(rng, byName.get(routeName) ?? null);
    duties.push({
      id: `${depot.id}-${operatingDate}-${String(index).padStart(3, '0')}`,
      depotId: depot.id,
      routeName,
      startMin,
      endMin,
      serviceClass: classFromRoute(routeName) ?? 'ordinary',
      provenance: 'modelled',
    });
  }
  duties.sort((x, y) => x.startMin - y.startMin || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return { duties, routesWithoutDuty: names.slice(peakRequirement) };
}
