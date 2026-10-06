import type { WindowedOnRoadShares } from '../sim/requirement';
import {
  createDailyMaximaStore,
  holdDailyMaxima,
  resetDailyMaximaStore,
  type DailyMaximaStore,
} from './dailyMaxima';

/*
 * The holder of each depot's busiest on-road share so far in the operating
 * date: the share the modelled requirement reads.
 *
 * The on-road share over the rolling score window drifts all day: it climbs to
 * the morning peak and falls as buses come home. A requirement read off it made
 * the modelled day (duties, crew, fuel, revenue, economics) and the transfer
 * plan shrink through the evening with no bus taken off the road. So the
 * requirement reads, per depot, the HIGHEST windowed share seen so far in the
 * operating date, and the peer median of those: "peak requirement" is
 * the depot's busiest window so far today. The day can still change until the
 * morning peak has passed (a depot rises with its own busiest window and can
 * dip a little when its peers' median rises) and then holds. `available` (fleet
 * less off-road) is not held here, so the day still follows a bus that really
 * goes off the road.
 *
 * What each snapshot does (`holdPeakShares`, once per snapshot analysis) is the
 * daily-maximum rule in `dailyMaxima.ts`. A depot with no finite windowed share
 * keeps its held value where it has one; with neither, the requirement falls
 * back as before (the single-snapshot share, then the peer median).
 *
 * The state is per process: two server instances hold different maxima until
 * each has seen the peak, and a process that has just started holds nothing.
 * It never reads the wall clock. Bounds: one number per depot for one date, and
 * never more than PEAK_SHARE_MAX_DEPOTS depots; a depot past the cap is not
 * held and reads its own windowed share.
 */

export const PEAK_SHARE_MAX_DEPOTS = 1000;

export type PeakShareStore = DailyMaximaStore;

export function createPeakShareStore(): PeakShareStore {
  return createDailyMaximaStore();
}

const GLOBAL_KEY = '__depotPeakShareStore';
type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: PeakShareStore };

/** The one process-wide store; on `globalThis` so a dev reload does not fork it. */
export function defaultPeakShareStore(): PeakShareStore {
  const holder = globalThis as GlobalWithStore;
  holder[GLOBAL_KEY] ??= createPeakShareStore();
  return holder[GLOBAL_KEY];
}

/** Test seam: empty a store (the process-wide one by default). */
export function resetPeakShareStore(store: PeakShareStore = defaultPeakShareStore()): void {
  resetDailyMaximaStore(store);
}

/**
 * Offers one snapshot's windowed on-road shares to the store and returns the
 * shares the requirement reads for it: a new map, so the store may move on
 * while a memoised analysis keeps what it was given. Call it once per snapshot.
 */
export function holdPeakShares(
  store: PeakShareStore,
  windowed: WindowedOnRoadShares,
  operatingDate: string | null,
): WindowedOnRoadShares {
  return holdDailyMaxima(store, windowed, operatingDate, PEAK_SHARE_MAX_DEPOTS);
}
