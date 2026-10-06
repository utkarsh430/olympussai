import type { PeakFloors } from '../sim/requirement';
import {
  createDailyMaximaStore,
  holdDailyMaxima,
  resetDailyMaximaStore,
  type DailyMaximaStore,
} from './dailyMaxima';

/*
 * The holder of each depot's highest modelled peak requirement so far in the
 * operating date: the floor the requirement does not fall below.
 *
 * Holding the on-road shares (`peakShareHold.ts`) stopped the evening shrink,
 * but the computed peak, round(available x utilisation), still moved by one in
 * both directions between snapshots a minute apart: the feed's list for a depot
 * can gain or lose a row (so `available` moves by one), and a peer's rising
 * share lifts the peer median and lowers this depot's utilisation. So each
 * snapshot's computed peak is floored by the highest computed for the depot
 * earlier in the date, the floor capped at what is available now
 * (`modelBalances`): the peak, and with it the day's duty total, does not fall
 * during the day unless fewer buses are available than it needs.
 *
 * What each snapshot does (`holdPeakRequirements`, once per snapshot analysis)
 * is the daily-maximum rule in `dailyMaxima.ts`; the recorded fixture never
 * reads or writes it. The state is per process, like the shares': a process
 * that has just started holds nothing. It never reads the wall clock. Bounds:
 * one number per depot for one date, and never more than
 * PEAK_REQUIREMENT_MAX_DEPOTS depots; a depot past the cap is not floored.
 */

export const PEAK_REQUIREMENT_MAX_DEPOTS = 1000;

export type PeakRequirementStore = DailyMaximaStore;

export function createPeakRequirementStore(): PeakRequirementStore {
  return createDailyMaximaStore();
}

const GLOBAL_KEY = '__depotPeakRequirementStore';
type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: PeakRequirementStore };

/** The one process-wide store; on `globalThis` so a dev reload does not fork it. */
export function defaultPeakRequirementStore(): PeakRequirementStore {
  const holder = globalThis as GlobalWithStore;
  holder[GLOBAL_KEY] ??= createPeakRequirementStore();
  return holder[GLOBAL_KEY];
}

/** Test seam: empty a store (the process-wide one by default). */
export function resetPeakRequirementStore(
  store: PeakRequirementStore = defaultPeakRequirementStore(),
): void {
  resetDailyMaximaStore(store);
}

/**
 * Offers one snapshot's computed peak requirements to the store and returns
 * the floors the requirement reads for it: per depot, the highest peak so far
 * in the date, this snapshot's included. A new map, so the store may move on
 * while a memoised analysis keeps what it was given. Call it once per snapshot.
 */
export function holdPeakRequirements(
  store: PeakRequirementStore,
  peaks: ReadonlyMap<string, number>,
  operatingDate: string | null,
): PeakFloors {
  const held = holdDailyMaxima(store, peaks, operatingDate, PEAK_REQUIREMENT_MAX_DEPOTS);
  return new Map([...held].flatMap(([id, peak]) => (peak === null ? [] : [[id, peak] as const])));
}
