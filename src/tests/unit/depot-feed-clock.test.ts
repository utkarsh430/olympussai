import { describe, expect, it } from 'vitest';
import {
  FEED_CLOCK_MAX_LEAD_MIN,
  deriveFeedNow,
  normalizeDepotRows,
} from '@/lib/upsrtc/depotNormalizer';
import type { DepotBusRow } from '@/models/depotLive';

/*
 * Ruling S50a: one row stamped in the future must not move the whole module's
 * clock. The feed clock is the newest receive time no more than
 * FEED_CLOCK_MAX_LEAD_MIN ahead of the snapshot's 99th-percentile receive time.
 */

const BASE_MS = Date.parse('2026-10-06T14:40:00Z');

function rowsAt(times: readonly (string | null)[]): readonly DepotBusRow[] {
  return normalizeDepotRows(
    times.map((t, i) => ({ regNum: `UP${String(i).padStart(6, '0')}`, receivedTime: t ?? 'None' })),
  ).rows;
}

/** `n` receive times spread over the minute before BASE, the newest exactly at BASE. */
function ordinaryTimes(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    new Date(BASE_MS - Math.floor(((n - 1 - i) * 60_000) / n)).toISOString(),
  );
}

describe('deriveFeedNow (S50a)', () => {
  it('ignores one future row among many for the clock', () => {
    const plusIst = new Date(BASE_MS + 330 * 60_000).toISOString();
    const rows = rowsAt([...ordinaryTimes(500), plusIst]);
    expect(deriveFeedNow(rows)).toBe(new Date(BASE_MS).toISOString());
  });

  it('ignores a garbage year', () => {
    const rows = rowsAt([...ordinaryTimes(300), '2099-01-01T00:00:00Z', '9999-12-31T00:00:00Z']);
    expect(deriveFeedNow(rows)).toBe(new Date(BASE_MS).toISOString());
  });

  it('keeps a newest row that leads by no more than the named lead', () => {
    const lead = new Date(BASE_MS + FEED_CLOCK_MAX_LEAD_MIN * 60_000).toISOString();
    expect(deriveFeedNow(rowsAt([...ordinaryTimes(300), lead]))).toBe(lead);
    const past = new Date(BASE_MS + FEED_CLOCK_MAX_LEAD_MIN * 60_000 + 1000).toISOString();
    expect(deriveFeedNow(rowsAt([...ordinaryTimes(300), past]))).toBe(
      new Date(BASE_MS).toISOString(),
    );
  });

  it('with fewer than 100 rows the newest row is the clock, as before', () => {
    const far = new Date(BASE_MS + 330 * 60_000).toISOString();
    expect(deriveFeedNow(rowsAt([...ordinaryTimes(98), far]))).toBe(far);
  });

  it('all rows equal, one row, and none', () => {
    const same = new Date(BASE_MS).toISOString();
    expect(deriveFeedNow(rowsAt(Array.from({ length: 250 }, () => same)))).toBe(same);
    expect(deriveFeedNow(rowsAt([same]))).toBe(same);
    expect(deriveFeedNow(rowsAt([null, null]))).toBeNull();
    expect(deriveFeedNow([])).toBeNull();
  });
});
