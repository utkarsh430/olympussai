import type { StateMix } from '../types';
import {
  MIN_SLOTS_FOR_AN_HOUR,
  SLOT_MINUTES,
  type ObservedDepotHour,
  type ObservedRouteHour,
  type RouteSlotSample,
  type SlotSample,
} from './types';

/*
 * One hour of a route or a depot, rolled up from the slot samples observed in
 * it. Every slot observed counts: a route absent from a slot had no bus
 * carrying its name then, so it adds zero. An hour with fewer than
 * MIN_SLOTS_FOR_AN_HOUR slots is not an observed hour (null), so a page falls
 * back to the modelled day rather than state a mean of one or two readings.
 */

const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;
const MEAN_DECIMALS = 100;
const DELAY_DECIMALS = 10;
const SHARE_DECIMALS = 10_000;

const roundTo = (value: number, decimals: number): number =>
  Math.round(value * decimals) / decimals;

const hourOfSlot = (slot: number): number => Math.floor(slot / SLOTS_PER_HOUR);

/** The slot samples of one hour of one date, whatever else the list holds. */
export function slotsOfHour(
  operatingDate: string,
  hour: number,
  slots: readonly SlotSample[],
): SlotSample[] {
  return slots.filter((s) => s.operatingDate === operatingDate && hourOfSlot(s.slot) === hour);
}

const deployedOf = (r: RouteSlotSample | undefined): number =>
  r === undefined ? 0 : r.states.inService + r.states.onRoad + r.states.standing;

function meanStates(samples: readonly (RouteSlotSample | undefined)[], count: number): StateMix {
  const mean = (key: keyof StateMix): number =>
    roundTo(samples.reduce((sum, r) => sum + (r?.states[key] ?? 0), 0) / count, MEAN_DECIMALS);
  return {
    inService: mean('inService'),
    onRoad: mean('onRoad'),
    standing: mean('standing'),
    dark: mean('dark'),
    offRoad: mean('offRoad'),
  };
}

function meanOperators(
  samples: readonly (RouteSlotSample | undefined)[],
  count: number,
): Record<string, number> {
  const sums = new Map<string, number>();
  for (const r of samples) {
    for (const [depotId, buses] of Object.entries(r?.operators ?? {})) {
      sums.set(depotId, (sums.get(depotId) ?? 0) + buses);
    }
  }
  return Object.fromEntries(
    [...sums.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([id, sum]) => [id, roundTo(sum / count, MEAN_DECIMALS)]),
  );
}

/**
 * One route's observed hour. Deployed is in service + on the road + standing
 * with the route name; its mean and max are over the slots. The delay median
 * is the mean of the slots' medians; the late share and the delay coverage
 * are over bus-slots (late of covered, covered of buses).
 */
export function hourFromSlots(
  routeName: string,
  operatingDate: string,
  hour: number,
  slots: readonly SlotSample[],
): ObservedRouteHour | null {
  const own = slotsOfHour(operatingDate, hour, slots);
  if (own.length < MIN_SLOTS_FOR_AN_HOUR) return null;
  const samples = own.map((s) => s.routes.find((r) => r.routeName === routeName));
  const count = own.length;
  const deployed = samples.map(deployedOf);
  const medians = samples.flatMap((r) => (r?.delayMedianMin == null ? [] : [r.delayMedianMin]));
  const late = samples.reduce((sum, r) => sum + (r?.late ?? 0), 0);
  const covered = samples.reduce((sum, r) => sum + (r?.delayCovered ?? 0), 0);
  const buses = samples.reduce((sum, r) => sum + (r?.buses ?? 0), 0);
  const states = meanStates(samples, count);
  return {
    routeName,
    operatingDate,
    hour,
    slotsObserved: count,
    deployedMean: roundTo(deployed.reduce((a, b) => a + b, 0) / count, MEAN_DECIMALS),
    deployedMax: Math.max(...deployed),
    inServiceMean: states.inService,
    states,
    delayMedianMin:
      medians.length === 0
        ? null
        : roundTo(medians.reduce((a, b) => a + b, 0) / medians.length, DELAY_DECIMALS),
    lateShare: covered === 0 ? null : roundTo(late / covered, SHARE_DECIMALS),
    delayCoverage: { n: covered, of: buses },
    operators: meanOperators(samples, count),
  };
}

/**
 * One depot's observed hour: its standing pool averaged over the slots where
 * its yard was established (null when it never was), and its unrouted moving
 * buses averaged over every slot observed (a depot absent from a slot adds zero).
 */
export function depotHourFromSlots(
  depotId: string,
  operatingDate: string,
  hour: number,
  slots: readonly SlotSample[],
): ObservedDepotHour | null {
  const own = slotsOfHour(operatingDate, hour, slots);
  if (own.length < MIN_SLOTS_FOR_AN_HOUR) return null;
  const samples = own.map((s) => s.depots.find((d) => d.depotId === depotId));
  const standing = samples.flatMap((d) =>
    d === undefined || d.standingInYard === null ? [] : [d.standingInYard],
  );
  const unrouted = samples.reduce((sum, d) => sum + (d?.unroutedOnRoad ?? 0), 0);
  return {
    depotId,
    operatingDate,
    hour,
    slotsObserved: own.length,
    standingInYardMean:
      standing.length === 0
        ? null
        : roundTo(standing.reduce((a, b) => a + b, 0) / standing.length, MEAN_DECIMALS),
    unroutedOnRoadMean: roundTo(unrouted / own.length, MEAN_DECIMALS),
  };
}

/** How many hours of the date have enough slots to count as observed. */
export function observedHourCount(operatingDate: string, slots: readonly SlotSample[]): number {
  const perHour = new Map<number, number>();
  for (const s of slots) {
    if (s.operatingDate !== operatingDate) continue;
    const hour = hourOfSlot(s.slot);
    perHour.set(hour, (perHour.get(hour) ?? 0) + 1);
  }
  return [...perHour.values()].filter((n) => n >= MIN_SLOTS_FOR_AN_HOUR).length;
}
