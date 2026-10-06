import { describe, expect, it, vi } from 'vitest';
import {
  FEED_CLOCK_MAX_LEAD_MIN,
  deriveFeedClock,
  deriveFeedNow,
  normalizeDepotRows,
} from '@/lib/upsrtc/depotNormalizer';
import type { DepotBusRow } from '@/models/depotLive';

/*
 * Ruling S56a: the feed's receive times are Indian-time digits carrying a `Z`;
 * the snapshot's fetch time is a real UTC instant. The feed clock is the newest
 * receive time not later than the fetch time read in Indian time plus
 * FEED_CLOCK_MAX_LEAD_MIN. Later rows are ignored for the clock and counted.
 * Nothing depends on how many buses are reporting.
 */

const MIN = 60_000;
const IST_OFFSET_MIN = 330;
/** The fetch instant (real UTC) and the same instant written in Indian-time digits. */
const FETCH_MS = Date.parse('2026-10-06T09:10:00Z');
const FETCH_IST_MS = FETCH_MS + IST_OFFSET_MIN * MIN;
const iso = (ms: number): string => new Date(ms).toISOString();

function rowsAt(times: readonly (string | null)[]): readonly DepotBusRow[] {
  return normalizeDepotRows(
    times.map((t, i) => ({ regNum: `UP${String(i).padStart(6, '0')}`, receivedTime: t ?? 'None' })),
  ).rows;
}

/** `n` receive times, the newest `newestAgoMin` before the fetch, then one a minute older each. */
function heardAgo(n: number, newestAgoMin: number, spreadMin = 1): string[] {
  return Array.from({ length: n }, (_, i) =>
    iso(FETCH_IST_MS - (newestAgoMin + (i * spreadMin) / Math.max(1, n)) * MIN),
  );
}

describe('deriveFeedClock (S56a)', () => {
  it('ignores one row stamped 5 h 30 ahead, and counts it', () => {
    const rows = rowsAt([...heardAgo(50, 0), iso(FETCH_IST_MS + IST_OFFSET_MIN * MIN)]);
    expect(deriveFeedClock(rows, FETCH_MS)).toEqual({ feedNow: iso(FETCH_IST_MS), aheadRows: 1 });
  });

  it('ignores a garbage year', () => {
    const rows = rowsAt([...heardAgo(30, 2), '2099-01-01T00:00:00Z', '9999-12-31T00:00:00Z']);
    expect(deriveFeedClock(rows, FETCH_MS)).toEqual({
      feedNow: iso(FETCH_IST_MS - 2 * MIN),
      aheadRows: 2,
    });
  });

  it('ignores 200 future rows among 10,000, however many there are', () => {
    const future = Array.from({ length: 200 }, (_, i) => iso(FETCH_IST_MS + (60 + i) * MIN));
    const rows = rowsAt([...heardAgo(9_800, 0, 600), ...future]);
    expect(deriveFeedClock(rows, FETCH_MS)).toEqual({ feedNow: iso(FETCH_IST_MS), aheadRows: 200 });
  });

  it('follows the 60 buses still reporting at night when the other 9,940 went quiet hours ago (N1)', () => {
    const quiet = heardAgo(9_940, 180, 600);
    for (const at of [0, 40, 120, 180]) {
      const fetchMs = FETCH_MS + at * MIN;
      const live = Array.from({ length: 60 }, (_, i) => iso(fetchMs + IST_OFFSET_MIN * MIN - i * 1000));
      const { feedNow, aheadRows } = deriveFeedClock(rowsAt([...quiet, ...live]), fetchMs);
      expect(feedNow).toBe(iso(fetchMs + IST_OFFSET_MIN * MIN));
      expect(aheadRows).toBe(0);
    }
  });

  it('keeps a recorded fixture exactly as before: every old row is accepted', () => {
    const recorded = Date.parse('2026-07-20T12:39:00Z');
    const rows = rowsAt(Array.from({ length: 500 }, (_, i) => iso(recorded - i * 7_000)));
    expect(deriveFeedClock(rows, FETCH_MS)).toEqual({ feedNow: iso(recorded), aheadRows: 0 });
    expect(deriveFeedNow(rows, FETCH_MS)).toBe(iso(recorded));
  });

  it('accepts rows up to the named lead ahead: a server clock 3 minutes slow loses nothing', () => {
    const slowFetch = FETCH_MS - 3 * MIN;
    const rows = rowsAt([...heardAgo(20, 1), iso(FETCH_IST_MS)]);
    expect(deriveFeedClock(rows, slowFetch)).toEqual({ feedNow: iso(FETCH_IST_MS), aheadRows: 0 });
    const edge = iso(FETCH_IST_MS + FEED_CLOCK_MAX_LEAD_MIN * MIN);
    const past = iso(FETCH_IST_MS + FEED_CLOCK_MAX_LEAD_MIN * MIN + 1000);
    expect(deriveFeedClock(rowsAt([edge, past]), FETCH_MS)).toEqual({ feedNow: edge, aheadRows: 1 });
  });

  it('a server clock 10 minutes slow ignores the freshest rows, lags, and the count says so', () => {
    const slowFetch = FETCH_MS - 10 * MIN;
    // A report every 30 s over the last 15 minutes; the cap sits 5 minutes back.
    const recent = Array.from({ length: 31 }, (_, i) => iso(FETCH_IST_MS - i * 30_000));
    const { feedNow, aheadRows } = deriveFeedClock(rowsAt(recent), slowFetch);
    expect(feedNow).toBe(iso(FETCH_IST_MS - 5 * MIN));
    expect(aheadRows).toBe(10);
  });

  it('one row, none, unparseable times and ties', () => {
    const at = iso(FETCH_IST_MS - MIN);
    expect(deriveFeedClock(rowsAt([at]), FETCH_MS)).toEqual({ feedNow: at, aheadRows: 0 });
    expect(deriveFeedClock([], FETCH_MS)).toEqual({ feedNow: null, aheadRows: 0 });
    expect(deriveFeedClock(rowsAt([null, 'not a time']), FETCH_MS)).toEqual({
      feedNow: null,
      aheadRows: 0,
    });
    const tie = rowsAt([at, at, at, iso(FETCH_IST_MS - 2 * MIN)]);
    expect(deriveFeedClock(tie, FETCH_MS)).toEqual({ feedNow: at, aheadRows: 0 });
  });

  it('never depends on the wall clock, and deriveFeedNow is its feedNow', () => {
    const rows = rowsAt([...heardAgo(10, 0), iso(FETCH_IST_MS + 60 * MIN)]);
    const at = (wallMs: number) => {
      vi.useFakeTimers();
      vi.setSystemTime(wallMs);
      try {
        return deriveFeedClock(rows, FETCH_MS);
      } finally {
        vi.useRealTimers();
      }
    };
    // A wall clock a year before the fetch and a day after it give the same clock.
    const early = at(FETCH_MS - 365 * 24 * 60 * MIN);
    expect(at(FETCH_MS + 24 * 60 * MIN)).toEqual(early);
    expect(early.aheadRows).toBe(1);
    expect(deriveFeedNow(rows, FETCH_MS)).toBe(early.feedNow);
  });
});
