import type { WindowedOnRoadShares } from '../sim/requirement';

/*
 * The holder of each depot's busiest on-road share so far in the operating
 * date: the share the modelled requirement reads.
 *
 * The on-road share over the rolling score window drifts all day: it climbs to
 * the morning peak and falls as buses come home. A requirement read off it made
 * the modelled day (duties, crew, fuel, revenue, economics) and the transfer
 * plan shrink through the evening with no bus taken off the road. So the
 * requirement reads, per depot, the HIGHEST windowed share seen so far in the
 * operating date, and the peer median of those maxima: "peak requirement" is
 * the depot's busiest window so far today. The day can grow until the morning
 * peak has passed and then holds. `available` (fleet less off-road) is not
 * held here, so the day still follows a bus that really goes off the road.
 *
 * What each snapshot does (`holdPeakShares`, once per snapshot analysis):
 *  - The same operating date as the one held: each depot's held value becomes
 *    the larger of it and this snapshot's windowed share.
 *  - A later operating date: the store starts afresh from this snapshot's own
 *    windowed shares.
 *  - An earlier operating date (a feed clock that stepped back over midnight),
 *    or no operating date: the snapshot reads its own windowed shares; the
 *    store is neither read nor written.
 * A depot with no finite windowed share keeps its held value where it has
 * one; with neither, it is left out, and the requirement falls back as before
 * (the single-snapshot share, then the peer median).
 *
 * The state is per process: two server instances hold different maxima until
 * each has seen the peak, and a process that has just started holds nothing.
 * It never reads the wall clock. Bounds: one number per depot for one date, and
 * never more than PEAK_SHARE_MAX_DEPOTS depots; a depot past the cap is not
 * held and reads its own windowed share.
 */

export const PEAK_SHARE_MAX_DEPOTS = 1000;

export interface PeakShareStore {
  /** The operating date (YYYY-MM-DD) the maxima belong to; null before the first snapshot. */
  operatingDate: string | null;
  readonly maxima: Map<string, number>;
}

export function createPeakShareStore(): PeakShareStore {
  return { operatingDate: null, maxima: new Map() };
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
  store.operatingDate = null;
  store.maxima.clear();
}

const finiteOrNull = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? value : null;

function larger(held: number | undefined, share: number | null): number | null {
  if (held === undefined) return share;
  return share === null ? held : Math.max(held, share);
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
  const held = store.operatingDate;
  if (operatingDate === null || (held !== null && operatingDate < held)) return new Map(windowed);
  if (held !== operatingDate) {
    store.operatingDate = operatingDate;
    store.maxima.clear();
  }
  const out = new Map<string, number | null>();
  for (const [depotId, value] of windowed) {
    const known = store.maxima.has(depotId);
    const share = finiteOrNull(value);
    if (!known && store.maxima.size >= PEAK_SHARE_MAX_DEPOTS) {
      out.set(depotId, share);
      continue;
    }
    const next = larger(store.maxima.get(depotId), share);
    if (next !== null) store.maxima.set(depotId, next);
    out.set(depotId, next);
  }
  return out;
}
