import { describe, expect, it } from 'vitest';
import {
  PEAK_SHARE_MAX_DEPOTS,
  createPeakShareStore,
  holdPeakShares,
  resetPeakShareStore,
} from '@/lib/depot/live/peakShareHold';

/*
 * The holder of each depot's busiest windowed on-road share so far in the
 * operating date: one number per depot for one date.
 */

const DAY = '2026-10-07';
const NEXT = '2026-10-08';

describe('the held on-road shares', () => {
  it('keeps the larger share within one operating date', () => {
    const store = createPeakShareStore();
    expect(holdPeakShares(store, new Map([['1', 0.8], ['2', 0.5]]), DAY)).toEqual(
      new Map([['1', 0.8], ['2', 0.5]]),
    );
    expect(holdPeakShares(store, new Map([['1', 0.6], ['2', 0.7]]), DAY)).toEqual(
      new Map([['1', 0.8], ['2', 0.7]]),
    );
  });

  it('starts afresh on a later operating date', () => {
    const store = createPeakShareStore();
    holdPeakShares(store, new Map([['1', 0.9]]), DAY);
    expect(holdPeakShares(store, new Map([['1', 0.4]]), NEXT)).toEqual(new Map([['1', 0.4]]));
    expect(store.operatingDate).toBe(NEXT);
  });

  it('neither reads nor writes for an earlier date or none', () => {
    const store = createPeakShareStore();
    holdPeakShares(store, new Map([['1', 0.9]]), NEXT);
    expect(holdPeakShares(store, new Map([['1', 0.3]]), DAY)).toEqual(new Map([['1', 0.3]]));
    expect(holdPeakShares(store, new Map([['1', 0.2]]), null)).toEqual(new Map([['1', 0.2]]));
    expect(store.operatingDate).toBe(NEXT);
    expect(store.maxima).toEqual(new Map([['1', 0.9]]));
  });

  it('keeps a held value when the window has none, and leaves out a depot with neither', () => {
    const store = createPeakShareStore();
    holdPeakShares(store, new Map([['1', 0.7]]), DAY);
    const shares = holdPeakShares(store, new Map([['1', null], ['2', Number.NaN]]), DAY);
    expect(shares).toEqual(new Map([['1', 0.7], ['2', null]]));
    expect(store.maxima.has('2')).toBe(false);
  });

  it('returns a new map that does not move with the store', () => {
    const store = createPeakShareStore();
    const input = new Map([['1', 0.5]]);
    const first = holdPeakShares(store, input, DAY);
    holdPeakShares(store, new Map([['1', 0.9]]), DAY);
    expect(first.get('1')).toBe(0.5);
    expect(input).toEqual(new Map([['1', 0.5]]));
  });

  it('holds at most its cap of depots; one past it reads its own share', () => {
    const store = createPeakShareStore();
    const many = new Map(
      Array.from({ length: PEAK_SHARE_MAX_DEPOTS + 1 }, (_, i) => [`d${i}`, 0.9] as const),
    );
    holdPeakShares(store, many, DAY);
    expect(store.maxima.size).toBe(PEAK_SHARE_MAX_DEPOTS);
    const last = `d${PEAK_SHARE_MAX_DEPOTS}`;
    expect(holdPeakShares(store, new Map([[last, 0.1]]), DAY).get(last)).toBe(0.1);
  });

  it('is emptied by the reset', () => {
    const store = createPeakShareStore();
    holdPeakShares(store, new Map([['1', 0.9]]), DAY);
    resetPeakShareStore(store);
    expect(store.operatingDate).toBeNull();
    expect(store.maxima.size).toBe(0);
  });
});
